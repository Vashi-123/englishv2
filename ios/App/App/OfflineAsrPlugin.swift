import Foundation
import Capacitor
import AVFoundation

@objc(OfflineAsrPlugin)
public class OfflineAsrPlugin: CAPPlugin {
    
    // MARK: - Constants
    
    private enum Constants {
        static let targetSampleRate: Double = 16000.0
        static let targetChannels: AVAudioChannelCount = 1
        static let recognizerThreads = 2
    }
    
    // MARK: - Properties
    
    private let processingQueue = DispatchQueue(label: "com.englishv2.asr.processing", qos: .userInitiated)
    private let audioQueue = DispatchQueue(label: "com.englishv2.asr.audio", qos: .userInitiated)
    
    private var whisperContext: OpaquePointer?
    private var recordedSamples: [Float] = []
    private var audioEngine: AVAudioEngine?
    private var audioConverter: AVAudioConverter?
    
    private var isRecording = false
    private var lastTranscript = ""
    private var stats = RecognitionStats()
    
    // MARK: - Recognition Stats
    
    private struct RecognitionStats {
        var samplesCount: Int = 0
        var peakLevel: Float = 0.0
        var bufferCount: Int = 0
        var sumSquares: Double = 0.0
    }
    
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
        guard isRecording else {
            call.resolve(["transcript": ""])
            return
        }
        
        isRecording = false
        stopAudioEngine()
        
        processingQueue.async { [weak self] in
            guard let self = self else {
                DispatchQueue.main.async { call.resolve(["transcript": ""]) }
                return
            }
            
            let transcript = self.finalizeRecognition()
            let rms: Double
            if self.stats.samplesCount > 0 {
                rms = sqrt(self.stats.sumSquares / Double(self.stats.samplesCount))
            } else {
                rms = 0.0
            }
            NSLog("[OfflineASR] finalize: samples=\(self.stats.samplesCount) buffers=\(self.stats.bufferCount) peak=\(self.stats.peakLevel)")
            let result: [String: Any] = [
                "transcript": transcript,
                "acceptedSamplesTotal": self.stats.samplesCount,
                "peakAbs": self.stats.peakLevel,
                "rms": rms
            ]
            
            DispatchQueue.main.async {
                call.resolve(result)
            }
        }
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
        if whisperContext != nil { return true }
        guard let model = whisperModelPath() else { return false }

        var ctxParams = whisper_context_default_params()
        ctxParams.use_gpu = false
        ctxParams.flash_attn = false

        guard let ctx = whisper_init_from_file_with_params(model, ctxParams) else {
            return false
        }
        whisperContext = ctx
        return true
    }
    
    // MARK: - Recording
    
    private func startRecording(_ call: CAPPluginCall, expectedText: String) {
        guard !isRecording else {
            call.resolve(["started": true])
            return
        }

        guard ensureWhisperContext() else {
            NSLog("[OfflineASR] whisper context init failed (model missing?)")
            call.resolve(["started": false, "reason": "recognizer_init_failed"])
            return
        }
        
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
        
        // Install tap
        inputNode.installTap(onBus: 0, bufferSize: 4800, format: inputFormat) { [weak self] buffer, _ in
            self?.processAudioBuffer(buffer, converter: converter, outputFormat: outputFormat)
        }
        
        // Start engine
        do {
            try engine.start()
            isRecording = true
            call.resolve(["started": true])
        } catch {
            stopAudioEngine()
            call.resolve(["started": false, "reason": "engine_start_failed"])
        }
    }
    
    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer, converter: AVAudioConverter, outputFormat: AVAudioFormat) {
        guard isRecording else { return }
        
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

            self.recordedSamples.append(contentsOf: samples)
        }
    }
    
    private func finalizeRecognition() -> String {
        defer { recordedSamples = [] }
        guard ensureWhisperContext(), let ctx = whisperContext else {
            NSLog("[OfflineASR] whisper context unavailable at finalize")
            return ""
        }
        guard !recordedSamples.isEmpty else {
            NSLog("[OfflineASR] no audio samples collected")
            return ""
        }

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

        let resultCode = recordedSamples.withUnsafeBufferPointer { ptr -> Int32 in
            guard let base = ptr.baseAddress else { return -1 }
            return whisper_full(ctx, params, base, Int32(ptr.count))
        }

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
        // Release context to free memory when not needed between checks
        whisper_free(ctx)
        whisperContext = nil
        lastTranscript = transcript
        return transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    
    // MARK: - Cleanup
    
    private func stopAudioEngine() {
        if let engine = audioEngine {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
        audioEngine = nil
        audioConverter = nil
        
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setActive(false, options: .notifyOthersOnDeactivation)
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
        } catch {
            // Ignore errors during cleanup
        }
    }
    
    private func cleanupStream() {
    }
    
    deinit {
        cleanupStream()
        if let ctx = whisperContext {
            whisper_free(ctx)
        }
    }
}
