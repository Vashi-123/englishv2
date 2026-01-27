import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Loader2, Volume2, User, Bot, StopCircle, RefreshCw } from 'lucide-react';
import { supabase } from '../services/supabaseClient';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

type Message = {
    role: 'user' | 'assistant';
    content: string;
};

type ConversationState = 'idle' | 'listening' | 'speaking' | 'thinking' | 'error';

// VAD Constants
const VAD_THRESHOLD = 15; // Volume threshold (0-255) - adjust based on testing
const SILENCE_DURATION = 1200; // ms to wait before considering speech ended
const MIN_SPEECH_DURATION = 500; // ms minimum to consider it real speech (avoid clicks)

export const VoiceConversation: React.FC = () => {
    const [state, setState] = useState<ConversationState>('idle');
    const [messages, setMessages] = useState<Message[]>([]);
    const [errorMsg, setErrorMsg] = useState('');
    const [volume, setVolume] = useState(0); // For visualization

    // Refs for State (needed inside audio callbacks)
    const stateRef = useRef<ConversationState>('idle');
    const isSpeechDetectedRef = useRef(false);
    const speechStartTimeRef = useRef(0);
    const silenceStartTimeRef = useRef(0);

    // Audio API Refs
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const microphoneRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const animationFrameRef = useRef<number | null>(null);

    // AI Audio Source (Web Audio API)
    const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

    // Auto-scroll
    const scrollRef = useRef<HTMLDivElement>(null);

    // Sync state ref
    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    // Cleanup
    useEffect(() => {
        return () => {
            stopConversation();
        };
    }, []);

    const stopConversation = () => {
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
        }
        stopAiAudio();
        setState('idle');
    };

    const stopAiAudio = () => {
        if (audioSourceRef.current) {
            try {
                audioSourceRef.current.stop();
            } catch (e) {
                // Ignore if already stopped
            }
            audioSourceRef.current = null;
        }
    };

    const startConversation = async () => {
        try {
            setErrorMsg('');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            const analyser = audioContext.createAnalyser();
            const microphone = audioContext.createMediaStreamSource(stream);

            analyser.fftSize = 256;
            microphone.connect(analyser);

            audioContextRef.current = audioContext;
            analyserRef.current = analyser;
            microphoneRef.current = microphone;

            // Setup MediaRecorder just for capturing chunks when we decide to
            // Logic: We will start/stop MediaRecorder based on VAD
            // Actually, for simple VAD implementation: 
            // We can keep MediaRecorder "paused" or just start it when speech detected.
            // Better approach for cleaner audio: Keep a circular buffer? 
            // Simplest "Good Enough" approach: Start MediaRecorder when VAD triggers, stop when Silence triggers.

            // But MediaRecorder has startup latency. 
            // Let's rely on prompt VAD trigger to start recording immediately.

            setupVadLoop();
            setState('listening');

        } catch (err) {
            console.error('Mic access error:', err);
            setErrorMsg('Cannot access microphone. Please allow permissions.');
        }
    };

    const startRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') return;

        // Use the existing stream from the microphone node
        const stream = microphoneRef.current!.mediaStream;
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };

        mediaRecorder.start();
        console.log('Started recording segment');
    };

    const stopRecordingAndTranscribe = () => {
        if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') return;

        mediaRecorderRef.current.stop();
        console.log('Stopped recording segment');

        mediaRecorderRef.current.onstop = async () => {
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            // Only process if blob size is significant (double check duration if possible)
            if (audioBlob.size > 1000) {
                await processUserAudio(audioBlob);
            }
        };
    };

    const setupVadLoop = () => {
        const dataArray = new Uint8Array(analyserRef.current!.frequencyBinCount);

        const checkVolume = () => {
            if (!analyserRef.current) return;

            analyserRef.current.getByteFrequencyData(dataArray);

            // Calculate average volume
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const avgVolume = sum / dataArray.length;
            setVolume(avgVolume);

            const now = Date.now();
            const isLoud = avgVolume > VAD_THRESHOLD;

            // BARGE-IN LOGIC: If user speaks while AI is speaking
            if (isLoud && stateRef.current === 'speaking') {
                console.log('Barge-in detected! Stopping AI.');
                stopAiAudio();
                setState('listening'); // Force state back to listening
            }

            // ONLY logic for "Listening" state (don't record while Thinking)
            if (stateRef.current === 'listening') {
                if (isLoud) {
                    if (!isSpeechDetectedRef.current) {
                        // Speech Started
                        isSpeechDetectedRef.current = true;
                        speechStartTimeRef.current = now;
                        console.log('Speech started');
                        startRecording();
                    }
                    // Reset silence timer because we are hearing sound
                    silenceStartTimeRef.current = 0;
                } else {
                    // Silence
                    if (isSpeechDetectedRef.current) {
                        // We were speaking, now silent. Start counting silence duration.
                        if (silenceStartTimeRef.current === 0) {
                            silenceStartTimeRef.current = now;
                        } else if (now - silenceStartTimeRef.current > SILENCE_DURATION) {
                            // Speech Ended (Silence timeout reached)
                            const speechDuration = now - speechStartTimeRef.current; // Approx

                            if (speechDuration > MIN_SPEECH_DURATION) {
                                console.log('Speech ended (Valid duration)');
                                stopRecordingAndTranscribe();
                                // Prevent VAD from triggering again immediately until process is done
                                isSpeechDetectedRef.current = false;
                                silenceStartTimeRef.current = 0;
                            } else {
                                // Too short (click/noise), ignore
                                console.log('Ignored short noise');
                                if (mediaRecorderRef.current) {
                                    mediaRecorderRef.current.stop(); // Discard
                                    audioChunksRef.current = [];
                                }
                                isSpeechDetectedRef.current = false;
                                silenceStartTimeRef.current = 0;
                            }
                        }
                    }
                }
            }

            animationFrameRef.current = requestAnimationFrame(checkVolume);
        };

        checkVolume();
    };

    const processUserAudio = async (audioBlob: Blob) => {
        // Lock state so VAD doesn't trigger again
        setState('thinking');

        try {
            console.log('Transcribing...');
            // 1. Transcribe
            const formData = new FormData();
            formData.append('file', audioBlob, 'voice.webm');
            formData.append('model', 'whisper-large-v3-turbo');

            const { data: transData, error: transError } = await supabase.functions.invoke('whisper-transcribe', {
                body: formData,
            });

            if (transError) throw new Error(transError.message || 'Transcribe failed');
            const userText = transData.text?.trim();

            if (!userText) {
                console.log('Empty transcription, back to listening');
                setState('listening');
                return;
            }

            // Add User Message
            const newMessages = [...messages, { role: 'user' as const, content: userText }];
            setMessages(newMessages);

            // 2. Chat
            const { data: chatData, error: chatError } = await supabase.functions.invoke('ai-chat', {
                body: { messages: newMessages }
            });

            if (chatError) throw new Error(chatError.message || 'Chat failed');
            const aiResponse = chatData.reply;

            // Add AI Message
            setMessages(prev => [...prev, { role: 'assistant', content: aiResponse }]);

            // 3. TTS
            // Use native fetch to ensure we get a Blob (supabase.invoke type definition issues)
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token || supabaseAnonKey;

            const response = await fetch(`${supabaseUrl}/functions/v1/text-to-speech`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text: aiResponse, voice: 'shimmer' })
            });

            if (!response.ok) throw new Error('TTS request failed');

            const arrayBuffer = await response.arrayBuffer();

            if (arrayBuffer.byteLength > 0 && audioContextRef.current) {
                setState('speaking');

                // Decode and play using Web Audio API (avoids autoplay blocks)
                const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
                const source = audioContextRef.current.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioContextRef.current.destination);

                source.onended = () => {
                    // Back to listening
                    setState('listening');
                    audioSourceRef.current = null;
                };

                source.start(0);
                audioSourceRef.current = source;
            } else {
                console.warn("TTS returned empty audio");
                setState('listening');
            }

        } catch (err: any) {
            console.error('Error in pipeline:', err);
            setErrorMsg(err.message);
            setState('error');
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-80px)] max-w-lg mx-auto bg-white rounded-3xl overflow-hidden shadow-2xl border border-gray-100 font-sans">
            {/* Top Bar */}
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between bg-white z-10">
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${state === 'idle' ? 'bg-gray-300' : 'bg-green-500 animate-pulse'}`}></div>
                    <span className="text-sm font-semibold text-gray-700 tracking-tight">Live Conversation</span>
                </div>
                <button
                    onClick={() => { setMessages([]); stopConversation(); }}
                    className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                >
                    <RefreshCw className="w-4 h-4" />
                </button>
            </div>

            {/* Chat History */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-6 space-y-6 bg-gradient-to-b from-gray-50/50 to-white"
            >
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-center space-y-4 opacity-50">
                        <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center">
                            <Volume2 className="w-10 h-10 text-indigo-400" />
                        </div>
                        <p className="text-gray-500 font-medium max-w-[200px]">Tap "Start" and just speak naturally</p>
                    </div>
                )}

                {messages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] ${msg.role === 'user' ? 'bg-indigo-600 text-white shadow-indigo-100' : 'bg-gray-100 text-gray-800'} px-5 py-3 rounded-2xl shadow-sm text-[15px] leading-relaxed ${msg.role === 'user' ? 'rounded-br-sm' : 'rounded-bl-sm'}`}>
                            {msg.content}
                        </div>
                    </div>
                ))}

                {/* State Indicators */}
                {state === 'thinking' && (
                    <div className="flex justify-start">
                        <div className="bg-gray-50 border border-gray-100 px-5 py-3.5 rounded-2xl rounded-bl-sm flex items-center gap-2">
                            <span className="text-xs font-semibold text-gray-400">AI Thinking</span>
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
                        </div>
                    </div>
                )}
            </div>

            {/* Control Area */}
            <div className="p-6 bg-white border-t border-gray-50 flex flex-col items-center justify-center gap-4 relative">
                {/* Volume Visualizer Ring */}
                {state === 'listening' && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
                        <div
                            className="w-32 h-32 rounded-full bg-indigo-500 transition-all duration-75 ease-linear"
                            style={{ transform: `scale(${1 + volume / 100})` }}
                        />
                    </div>
                )}

                {state === 'idle' ? (
                    <button
                        onClick={startConversation}
                        className="w-20 h-20 bg-indigo-600 rounded-full flex items-center justify-center shadow-xl shadow-indigo-200 hover:scale-105 active:scale-95 transition-all z-10"
                    >
                        <Mic className="w-8 h-8 text-white" />
                    </button>
                ) : (
                    <button
                        onClick={stopConversation}
                        className="w-20 h-20 bg-red-50 text-red-500 border-2 border-red-100 rounded-full flex items-center justify-center hover:bg-red-100 transition-all z-10"
                    >
                        <StopCircle className="w-8 h-8 fill-current" />
                    </button>
                )}

                <div className="h-4 text-xs font-medium text-center text-gray-400 z-10">
                    {state === 'idle' && "Ready to start"}
                    {state === 'listening' && "Listening... (Hands-free)"}
                    {state === 'thinking' && "Processing..."}
                    {state === 'speaking' && "Speaking..."}
                </div>

                {errorMsg && (
                    <div className="absolute bottom-full mb-2 bg-red-100 text-red-600 text-xs px-3 py-1 rounded-full whitespace-nowrap">
                        {errorMsg}
                    </div>
                )}
            </div>
        </div>
    );
};
