import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const OPENAI_TTS_API_KEY = Deno.env.get("OPENAI_TTS_API_KEY");

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface TtsRequest {
    text: string;
    voice?: string;
    speed?: number;
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
        return new Response("Method Not Allowed", {
            status: 405,
            headers: corsHeaders
        });
    }

    try {
        const { text, voice, speed }: TtsRequest = await req.json();

        if (!text) {
            return new Response(JSON.stringify({ error: "text is required" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        if (!OPENAI_TTS_API_KEY) {
            throw new Error("OPENAI_TTS_API_KEY is not set");
        }

        // OpenAI TTS API
        // model: tts-1 (standard) or tts-1-hd (high def). tts-1 is faster for real-time.
        const response = await fetch("https://api.openai.com/v1/audio/speech", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENAI_TTS_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "tts-1",
                input: text,
                voice: voice || "alloy", // alloy, echo, fable, onyx, nova, shimmer
                response_format: "mp3",
                speed: speed || 1.0,
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`OpenAI TTS API error: ${response.status} ${errText}`);
        }

        // Stream the audio back directly
        const audioBlob = await response.blob();

        return new Response(audioBlob, {
            headers: {
                ...corsHeaders,
                "Content-Type": "audio/mpeg",
                "Content-Length": String(audioBlob.size),
            },
        });

    } catch (error) {
        console.error("Error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
