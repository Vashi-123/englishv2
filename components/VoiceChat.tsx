import React, { useState, useRef } from 'react';
import { Mic, Square, Loader2, Send } from 'lucide-react';
import { supabase } from '../services/supabaseClient';

export const VoiceChat: React.FC = () => {
    const [isRecording, setIsRecording] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [transcribedText, setTranscribedText] = useState('');
    const [chatHistory, setChatHistory] = useState<Array<{ role: 'user' | 'ai', text: string }>>([]);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            chunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunksRef.current.push(e.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
                await processAudio(audioBlob);

                // Stop all tracks
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();
            setIsRecording(true);
        } catch (err) {
            console.error('Error accessing microphone:', err);
            alert('Could not access microphone');
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    };

    const processAudio = async (audioBlob: Blob) => {
        setIsProcessing(true);
        try {
            // 1. Prepare FormData
            const formData = new FormData();
            formData.append('file', audioBlob, 'start_recording.webm');
            formData.append('model', 'whisper-large-v3-turbo');
            // Optional: Language hint
            // formData.append('language', 'en'); 

            // 2. Call our new Edge Function
            const { data, error } = await supabase.functions.invoke('whisper-transcribe', {
                body: formData,
            });

            if (error) throw error;

            if (data && data.text) {
                setTranscribedText(data.text);
                // Automatically add to history as user
                setChatHistory(prev => [...prev, { role: 'user', text: data.text }]);

                // Here you would typically send this text to your AI tutor
                // Example: await sendToTutor(data.text);
            }
        } catch (err) {
            console.error('Transcription error:', err);
            alert('Failed to transcribe audio. Check console for details.');
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="max-w-md mx-auto p-4 bg-white rounded-2xl shadow-lg border border-gray-100">
            <div className="mb-4 text-center">
                <h2 className="text-lg font-bold text-gray-800">Voice AI Demo</h2>
                <p className="text-xs text-gray-500">Powered by Groq Whisper Large V3 Turbo</p>
            </div>

            <div className="h-64 overflow-y-auto mb-4 bg-gray-50 rounded-xl p-3 space-y-3">
                {chatHistory.length === 0 && (
                    <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                        Say something...
                    </div>
                )}
                {chatHistory.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] px-3 py-2 rounded-xl text-sm ${msg.role === 'user'
                            ? 'bg-blue-600 text-white rounded-br-none'
                            : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none'
                            }`}>
                            {msg.text}
                        </div>
                    </div>
                ))}
                {isProcessing && (
                    <div className="flex justify-center py-2">
                        <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
                    </div>
                )}
            </div>

            <div className="flex items-center gap-2">
                <button
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={isProcessing}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition-all ${isRecording
                        ? 'bg-rose-500 text-white shadow-rose-200'
                        : 'bg-gray-900 text-white shadow-gray-200 hover:bg-gray-800'
                        } shadow-lg disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                    {isRecording ? (
                        <>
                            <Square className="w-4 h-4 fill-current" />
                            Stop Recording
                        </>
                    ) : (
                        <>
                            <Mic className="w-4 h-4" />
                            {isProcessing ? 'Processing...' : 'Tap to Speak'}
                        </>
                    )}
                </button>
            </div>

            {transcribedText && !isRecording && !isProcessing && (
                <div className="mt-3 p-3 bg-green-50 rounded-lg text-xs text-green-800 border border-green-100">
                    <strong>Debug (Raw Transcription):</strong> {transcribedText}
                </div>
            )}
        </div>
    );
};
