import Foundation
import Capacitor
import AVFoundation
import Darwin

@objc(OfflineAsrPlugin)
public class OfflineAsrPlugin: CAPPlugin {
    
    // MARK: - Constants
    
    private enum Constants {
        static let targetSampleRate: Double = 16000.0
        static let targetChannels: AVAudioChannelCount = 1
        static let recognizerThreads = 1  // Уменьшено для снижения нагрузки на CPU
        static let silenceAutoStopMs: Double = 1500.0
        static let maxRecordingMs: Double = 6000.0
        static let minAudioMsBeforeAutoStop: Double = 350.0
        static let silencePeakThreshold: Float = 0.004
        static let voicePeakThreshold: Float = 0.010
        static let maxSamplesInMemory = 16000 * 10  // Максимум 10 секунд в памяти
    }
    
    // MARK: - Properties
    
    // КРИТИЧНО: QoS должен быть .utility или .background, чтобы не конкурировать с UI
    private let processingQueue = DispatchQueue(label: "com.englishv2.asr.processing", qos: .utility)
    private let audioQueue = DispatchQueue(label: "com.englishv2.asr.audio", qos: .utility)
    
    private var whisperContext: OpaquePointer?
    private var recordedSamples: [Float] = []
    private var audioEngine: AVAudioEngine?
    private var audioConverter: AVAudioConverter?
    
    private var isRecording = false
    private var isFinalizing = false
    private var lastTranscript = ""
    private var stats = RecognitionStats()
    private var lastResult: [String: Any]? = nil
    private var pendingStopCalls: [CAPPluginCall] = []
    private var lastVoiceSampleCount: Int = 0
    
    // MARK: - Recognition Stats
    
    private struct RecognitionStats {
        var samplesCount: Int = 0
        var peakLevel: Float = 0.0
        var bufferCount: Int = 0
        var sumSquares: Double = 0.0
    }
    
    // MARK: - Performance Metrics
    
    private struct PerformanceMetrics {
        var modelLoadTime: TimeInterval = 0
        var totalInferenceTime: TimeInterval = 0
        var inferenceCount: Int = 0
        var totalAudioProcessingTime: TimeInterval = 0
        var audioBufferCount: Int = 0
        var maxMemoryUsage: Int = 0
        var recordingStartTime: Date?
        var firstBufferTime: Date?
        var lastInferenceTime: TimeInterval = 0
    }
    
    private var performanceMetrics = PerformanceMetrics()
    
    // MARK: - Plugin Methods
    
    @objc func isAvailable(_ call: CAPPluginCall) {
        let available = modelFilesExist()
        call.resolve(["available": available])
    }
    
    @objc func start(_ call: CAPPluginCall) {
        let expectedText = call.getString("expectedText") ?? ""
        
        // Check microphone permission
        let session = AVAudioSession.sharedInstance()
        switch session.recordPermission {
        case .granted:
            startRecording(call, expectedText: expectedText)
        case .denied:
            call.resolve(["started": false, "reason": "mic_permission_denied"])
        case .undetermined:
            session.requestRecordPermission { [weak self] granted in
                DispatchQueue.main.async {
                    if granted {
                        self?.startRecording(call, expectedText: expectedText)
                    } else {
                        call.resolve(["started": false, "reason": "mic_permission_denied"])
                    }
                }
            }
        @unknown default:
            call.resolve(["started": false, "reason": "unknown_permission_state"])
        }
    }
    
    @objc func stop(_ call: CAPPluginCall) {
        if isFinalizing {
            pendingStopCalls.append(call)
            return
        }

        guard isRecording else {
            if let last = lastResult {
                call.resolve(last)
            } else if !lastTranscript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                call.resolve(["transcript": lastTranscript.trimmingCharacters(in: .whitespacesAndNewlines)])
            } else {
                call.resolve(["transcript": ""])
            }
            return
        }

        isRecording = false
        stopAudioEngine()
        finalizeAndEmitResult(resolving: call, notify: false)
    }
    
    @objc func cancel(_ call: CAPPluginCall) {
        isRecording = false
        stopAudioEngine()
        
        processingQueue.async { [weak self] in
            self?.cleanupStream()
            DispatchQueue.main.async {
                call.resolve()
            }
        }
    }
    
    // Явная очистка для выгрузки модели при выходе из урока
    @objc func cleanup(_ call: CAPPluginCall) {
        isRecording = false
        stopAudioEngine()
        
        let memoryBefore = getMemoryUsage()
        NSLog("[OfflineASR] 🧹 CLEANUP: Starting model unload, memory before: \(String(format: "%.1f", memoryBefore)) MB")
        
        processingQueue.async { [weak self] in
            guard let self = self else {
                DispatchQueue.main.async {
                    call.resolve()
                }
                return
            }
            
            let unloadStart = Date()
            self.unloadWhisperContext()
            let unloadTime = Date().timeIntervalSince(unloadStart)
            let memoryAfter = self.getMemoryUsage()
            
            NSLog("[OfflineASR] 🧹 CLEANUP: Model unloaded in \(String(format: "%.3f", unloadTime))s")
            NSLog("[OfflineASR] 💾 MEMORY: Before: \(String(format: "%.1f", memoryBefore)) MB, After: \(String(format: "%.1f", memoryAfter)) MB, Freed: \(String(format: "%.1f", memoryBefore - memoryAfter)) MB")
            
            // Логируем статистику перед выгрузкой
            self.logPerformanceSummary()
            
            DispatchQueue.main.async {
                call.resolve()
            }
        }
    }
    
    // MARK: - Whisper Model Management

    private func whisperModelPath() -> String? {
        return Bundle.main.path(
            forResource: "ggml-tiny.en",
            ofType: "bin",
            inDirectory: "public/asr-models/whisper"
        )
    }

    private func modelFilesExist() -> Bool {
        return whisperModelPath() != nil
    }

    private func ensureWhisperContext() -> Bool {
        // КРИТИЧНО: Проверяем, что мы НЕ на Main Thread
        assert(!Thread.isMainThread, "[OfflineASR] ensureWhisperContext called on main thread - это блокирует UI!")
        
        if whisperContext != nil { return true }
        guard let model = whisperModelPath() else { return false }

        NSLog("[OfflineASR] Loading whisper model from: \(model)")
        let loadStart = Date()
        
        // Логируем использование памяти до загрузки
        let memoryBefore = getMemoryUsage()
        NSLog("[OfflineASR] Memory before model load: \(memoryBefore) MB")
        
        var ctxParams = whisper_context_default_params()
        // Попытка использовать GPU если доступно (CoreML/Metal на iOS)
        ctxParams.use_gpu = true  // Включено для использования GPU если доступно
        ctxParams.flash_attn = false

        guard let ctx = whisper_init_from_file_with_params(model, ctxParams) else {
            // Fallback на CPU если GPU недоступно
            NSLog("[OfflineASR] GPU init failed, falling back to CPU")
            var cpuParams = whisper_context_default_params()
            cpuParams.use_gpu = false
            cpuParams.flash_attn = false
            guard let cpuCtx = whisper_init_from_file_with_params(model, cpuParams) else {
                NSLog("[OfflineASR] CPU init also failed")
                return false
            }
            whisperContext = cpuCtx
            let loadTime = Date().timeIntervalSince(loadStart)
            performanceMetrics.modelLoadTime = loadTime
            let memoryAfter = getMemoryUsage()
            NSLog("[OfflineASR] ⏱️ PERFORMANCE: Model loaded (CPU) in \(String(format: "%.3f", loadTime))s")
            NSLog("[OfflineASR] 💾 MEMORY: Before: \(memoryBefore) MB, After: \(memoryAfter) MB, Delta: \(String(format: "%.1f", memoryAfter - memoryBefore)) MB")
            return true
        }
        whisperContext = ctx
        let loadTime = Date().timeIntervalSince(loadStart)
        performanceMetrics.modelLoadTime = loadTime
        let memoryAfter = getMemoryUsage()
        NSLog("[OfflineASR] ⏱️ PERFORMANCE: Model loaded (GPU) in \(String(format: "%.3f", loadTime))s")
        NSLog("[OfflineASR] 💾 MEMORY: Before: \(memoryBefore) MB, After: \(memoryAfter) MB, Delta: \(String(format: "%.1f", memoryAfter - memoryBefore)) MB")
        return true
    }
    
    // Выгрузка модели когда не используется для освобождения памяти
    private func unloadWhisperContext() {
        if let ctx = whisperContext {
            NSLog("[OfflineASR] 🧹 CLEANUP: Freeing whisper context...")
            whisper_free(ctx)
            whisperContext = nil
            NSLog("[OfflineASR] 🧹 CLEANUP: Whisper context freed successfully")
        } else {
            NSLog("[OfflineASR] 🧹 CLEANUP: No whisper context to unload (already unloaded)")
        }
    }
    
    // MARK: - Recording
    
    private func startRecording(_ call: CAPPluginCall, expectedText: String) {
        guard !isRecording else {
            call.resolve(["started": true])
            return
        }

        // КРИТИЧНО: Инициализация модели должна быть в фоновом потоке, не на Main Thread
        processingQueue.async { [weak self] in
            guard let self = self else {
                call.resolve(["started": false, "reason": "plugin_deallocated"])
                return
            }
            
            guard self.ensureWhisperContext() else {
                NSLog("[OfflineASR] whisper context init failed (model missing?)")
                DispatchQueue.main.async {
                    call.resolve(["started": false, "reason": "recognizer_init_failed"])
                }
                return
            }
            
            // Продолжаем настройку аудио на main thread (AVAudioEngine требует main)
            DispatchQueue.main.async {
                self.setupAudioAndStart(call: call)
            }
        }
    }
    
    private func setupAudioAndStart(call: CAPPluginCall) {
        
        // Configure audio session
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP])
            try session.setPreferredSampleRate(Constants.targetSampleRate)
            try session.setPreferredIOBufferDuration(0.01)
            try session.setActive(true)
        } catch {
            call.resolve(["started": false, "reason": "audio_session_error"])
            return
        }
        
        // Reset state
        lastTranscript = ""
        stats = RecognitionStats()
        recordedSamples = []
        lastResult = nil
        pendingStopCalls = []
        lastVoiceSampleCount = 0
        isFinalizing = false
        
        // Setup audio engine
        let engine = AVAudioEngine()
        audioEngine = engine
        
        let inputNode = engine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)
        let outputFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: Constants.targetSampleRate,
            channels: Constants.targetChannels,
            interleaved: false
        )!
        
        // Create converter
        guard let converter = AVAudioConverter(from: inputFormat, to: outputFormat) else {
            call.resolve(["started": false, "reason": "converter_create_failed"])
            return
        }
        audioConverter = converter
        
        // Install tap с уменьшенным размером буфера для снижения нагрузки
        inputNode.installTap(onBus: 0, bufferSize: 2400, format: inputFormat) { [weak self] buffer, _ in
            self?.processAudioBuffer(buffer, converter: converter, outputFormat: outputFormat)
        }
        
        // Start engine
        do {
            performanceMetrics.recordingStartTime = Date()
            performanceMetrics.firstBufferTime = nil
            try engine.start()
            isRecording = true
            NSLog("[OfflineASR] ⏱️ PERFORMANCE: Audio engine started, waiting for first buffer...")
            call.resolve(["started": true])
        } catch {
            stopAudioEngine()
            call.resolve(["started": false, "reason": "engine_start_failed"])
        }
    }
    
    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer, converter: AVAudioConverter, outputFormat: AVAudioFormat) {
        // КРИТИЧНО: Проверяем флаги ДО обработки, чтобы не обрабатывать аудио после остановки
        guard isRecording, !isFinalizing else { return }
        
        let bufferStartTime = Date()
        
        // Отслеживаем время первого буфера
        if performanceMetrics.firstBufferTime == nil {
            performanceMetrics.firstBufferTime = bufferStartTime
            if let recordingStart = performanceMetrics.recordingStartTime {
                let firstBufferLatency = bufferStartTime.timeIntervalSince(recordingStart)
                NSLog("[OfflineASR] ⏱️ PERFORMANCE: First audio buffer received in \(String(format: "%.3f", firstBufferLatency))s after recording start")
            }
        }
        
        let outputFrameCount = AVAudioFrameCount(Double(buffer.frameLength) * (Constants.targetSampleRate / buffer.format.sampleRate))
        guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: outputFrameCount) else { return }
        
        var error: NSError?
        let inputBlock: AVAudioConverterInputBlock = { _, outStatus in
            outStatus.pointee = .haveData
            return buffer
        }
        
        let status = converter.convert(to: outputBuffer, error: &error, withInputFrom: inputBlock)
        
        guard status != .error, error == nil else { return }
        guard let channelData = outputBuffer.floatChannelData else { return }
        
        let frameCount = Int(outputBuffer.frameLength)
        guard frameCount > 0 else { return }
        
        let samples = Array(UnsafeBufferPointer(start: channelData[0], count: frameCount))
        
        let processingTime = Date().timeIntervalSince(bufferStartTime)
        performanceMetrics.totalAudioProcessingTime += processingTime
        performanceMetrics.audioBufferCount += 1
        
        processingQueue.async { [weak self] in
            guard let self = self else { return }
            
            self.stats.bufferCount += 1
            self.stats.samplesCount += frameCount
            
            // Update peak level
            let peak = samples.map { abs($0) }.max() ?? 0
            if peak > self.stats.peakLevel {
                self.stats.peakLevel = peak
            }
            // Accumulate squared samples to compute RMS later
            let sumSquares = samples.reduce(0.0) { $0 + Double($1 * $1) }
            self.stats.sumSquares += sumSquares

            // Ограничение размера буфера для предотвращения переполнения памяти
            let maxSamples = Constants.maxSamplesInMemory
            if self.recordedSamples.count + samples.count > maxSamples {
                let keepCount = max(0, maxSamples - samples.count)
                self.recordedSamples = Array(self.recordedSamples.suffix(keepCount))
            }
            
            self.recordedSamples.append(contentsOf: samples)

            // Track recent voice activity and auto-stop on silence.
            if peak >= Constants.voicePeakThreshold {
                self.lastVoiceSampleCount = self.stats.samplesCount
            } else if peak >= Constants.silencePeakThreshold && self.lastVoiceSampleCount == 0 {
                // If we start with low but non-zero input, treat it as voice so we don't auto-stop immediately.
                self.lastVoiceSampleCount = self.stats.samplesCount
            }

            self.maybeAutoStopFromVAD()
        }
    }

    private func maybeAutoStopFromVAD() {
        guard isRecording else { return }
        guard !isFinalizing else { return }

        let samplesPerMs = Constants.targetSampleRate / 1000.0
        let totalMs = Double(stats.samplesCount) / samplesPerMs
        if totalMs < Constants.minAudioMsBeforeAutoStop {
            return
        }

        let maxSamples = Int(Constants.maxRecordingMs * samplesPerMs)
        if stats.samplesCount >= maxSamples {
            triggerAutoStop(reason: "max_duration")
            return
        }

        // If we haven't seen any voice yet, do not auto-stop from silence.
        if lastVoiceSampleCount <= 0 { return }

        let silenceSamples = stats.samplesCount - lastVoiceSampleCount
        let silenceMs = Double(silenceSamples) / samplesPerMs
        if silenceMs >= Constants.silenceAutoStopMs {
            triggerAutoStop(reason: "silence")
        }
    }

    private func triggerAutoStop(reason: String) {
        guard isRecording else { return }
        guard !isFinalizing else { return }

        isRecording = false
        // КРИТИЧНО: Останавливаем микрофон НЕМЕДЛЕННО, без задержек
        // AVAudioEngine операции должны быть на main thread, но делаем синхронно если уже на main
        if Thread.isMainThread {
            stopAudioEngine()
        } else {
            DispatchQueue.main.sync { [weak self] in
                self?.stopAudioEngine()
            }
        }
        // Финализацию делаем в фоновом потоке
        finalizeAndEmitResult(resolving: nil, notify: true, reason: reason)
    }

    private func finalizeAndEmitResult(resolving call: CAPPluginCall?, notify: Bool, reason: String? = nil) {
        isFinalizing = true
        if let call = call {
            pendingStopCalls.append(call)
        }

        processingQueue.async { [weak self] in
            guard let self = self else { return }

            let transcript = self.finalizeRecognition()
            let rms: Double
            if self.stats.samplesCount > 0 {
                rms = sqrt(self.stats.sumSquares / Double(self.stats.samplesCount))
            } else {
                rms = 0.0
            }

            NSLog("[OfflineASR] finalize: samples=\(self.stats.samplesCount) buffers=\(self.stats.bufferCount) peak=\(self.stats.peakLevel) reason=\(reason ?? "manual")")

            var result: [String: Any] = [
                "transcript": transcript,
                "acceptedSamplesTotal": self.stats.samplesCount,
                "peakAbs": self.stats.peakLevel,
                "rms": rms
            ]
            if let reason = reason {
                result["reason"] = reason
            }
            self.lastResult = result
            self.isFinalizing = false

            let callsToResolve = self.pendingStopCalls
            self.pendingStopCalls = []

            DispatchQueue.main.async {
                for c in callsToResolve {
                    c.resolve(result)
                }
                if notify {
                    self.notifyListeners("autoStop", data: result)
                }
            }
        }
    }
    
    private func finalizeRecognition() -> String {
        // КРИТИЧНО: Проверяем, что мы НЕ на Main Thread
        assert(!Thread.isMainThread, "[OfflineASR] finalizeRecognition called on main thread - это блокирует UI!")
        
        defer { recordedSamples = [] }
        guard whisperContext != nil, let ctx = whisperContext else {
            NSLog("[OfflineASR] whisper context unavailable at finalize")
            return ""
        }
        guard !recordedSamples.isEmpty else {
            NSLog("[OfflineASR] no audio samples collected")
            return ""
        }

        let inferenceStart = Date()
        let sampleCount = recordedSamples.count
        let audioDuration = Double(sampleCount) / Constants.targetSampleRate
        NSLog("[OfflineASR] Starting inference for \(sampleCount) samples (\(String(format: "%.2f", audioDuration))s audio)")

        var params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY)
        params.n_threads = Int32(Constants.recognizerThreads)
        params.print_realtime = false
        params.print_progress = false
        params.translate = false
        params.no_context = true
        params.single_segment = true
        let langCString = ("en" as NSString).utf8String
        params.language = langCString
        params.detect_language = false

        let memoryBefore = getMemoryUsage()
        let resultCode = recordedSamples.withUnsafeBufferPointer { ptr -> Int32 in
            guard let base = ptr.baseAddress else { return -1 }
            return whisper_full(ctx, params, base, Int32(ptr.count))
        }
        let memoryAfter = getMemoryUsage()

        let inferenceTime = Date().timeIntervalSince(inferenceStart)
        performanceMetrics.totalInferenceTime += inferenceTime
        performanceMetrics.inferenceCount += 1
        performanceMetrics.lastInferenceTime = inferenceTime
        
        // Обновляем максимальное использование памяти
        let currentMemory = Int(memoryAfter)
        if currentMemory > performanceMetrics.maxMemoryUsage {
            performanceMetrics.maxMemoryUsage = currentMemory
        }
        
        let realtimeFactor = audioDuration / inferenceTime
        NSLog("[OfflineASR] ⏱️ PERFORMANCE: Inference completed in \(String(format: "%.3f", inferenceTime))s")
        NSLog("[OfflineASR] 📊 STATS: Audio duration: \(String(format: "%.2f", audioDuration))s, Realtime factor: \(String(format: "%.2f", realtimeFactor))x")
        NSLog("[OfflineASR] 💾 MEMORY: Before: \(String(format: "%.1f", memoryBefore)) MB, After: \(String(format: "%.1f", memoryAfter)) MB, Delta: \(String(format: "%.1f", memoryAfter - memoryBefore)) MB")
        NSLog("[OfflineASR] Result code: \(resultCode)")

        guard resultCode == 0 else {
            NSLog("[OfflineASR] whisper_full returned error code \(resultCode)")
            return ""
        }

        var transcript = ""
        let segments = whisper_full_n_segments(ctx)
        for i in 0..<segments {
            if let cText = whisper_full_get_segment_text(ctx, i) {
                transcript += String(cString: cText)
            }
        }
        lastTranscript = transcript
        return transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    
    // MARK: - Cleanup
    
    private func stopAudioEngine() {
        // КРИТИЧНО: Немедленно останавливаем микрофон и освобождаем аудио сессию
        if let engine = audioEngine {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
        audioEngine = nil
        audioConverter = nil
        
        // Немедленно деактивируем аудио сессию для освобождения микрофона
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setActive(false, options: .notifyOthersOnDeactivation)
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
        } catch {
            NSLog("[OfflineASR] Error deactivating audio session: \(error)")
        }
        
        NSLog("[OfflineASR] Audio engine stopped, microphone released")
        
        // НЕ выгружаем модель здесь - она нужна пока пользователь в уроке
        // Модель будет выгружена только при явном вызове cleanup() или deinit
    }
    
    private func cleanupStream() {
    }
    
    deinit {
        cleanupStream()
        if let ctx = whisperContext {
            whisper_free(ctx)
        }
        // Логируем финальную статистику производительности
        logPerformanceSummary()
    }
    
    // MARK: - Performance Logging
    
    private func getMemoryUsage() -> Double {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size)/4
        
        let kerr: kern_return_t = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: 1) {
                task_info(mach_task_self_,
                         task_flavor_t(MACH_TASK_BASIC_INFO),
                         $0,
                         &count)
            }
        }
        
        if kerr == KERN_SUCCESS {
            return Double(info.resident_size) / 1024.0 / 1024.0 // Convert to MB
        }
        return 0.0
    }
    
    private func logPerformanceSummary() {
        guard performanceMetrics.inferenceCount > 0 else { return }
        
        let avgInferenceTime = performanceMetrics.totalInferenceTime / Double(performanceMetrics.inferenceCount)
        let avgAudioProcessingTime = performanceMetrics.audioBufferCount > 0 
            ? performanceMetrics.totalAudioProcessingTime / Double(performanceMetrics.audioBufferCount) 
            : 0.0
        
        NSLog("[OfflineASR] 📊 PERFORMANCE SUMMARY:")
        NSLog("[OfflineASR]   Model load time: \(String(format: "%.3f", performanceMetrics.modelLoadTime))s")
        NSLog("[OfflineASR]   Total inferences: \(performanceMetrics.inferenceCount)")
        NSLog("[OfflineASR]   Total inference time: \(String(format: "%.3f", performanceMetrics.totalInferenceTime))s")
        NSLog("[OfflineASR]   Average inference time: \(String(format: "%.3f", avgInferenceTime))s")
        NSLog("[OfflineASR]   Last inference time: \(String(format: "%.3f", performanceMetrics.lastInferenceTime))s")
        NSLog("[OfflineASR]   Audio buffers processed: \(performanceMetrics.audioBufferCount)")
        NSLog("[OfflineASR]   Average buffer processing: \(String(format: "%.3f", avgAudioProcessingTime * 1000))ms")
        NSLog("[OfflineASR]   Max memory usage: \(performanceMetrics.maxMemoryUsage) MB")
    }
}
