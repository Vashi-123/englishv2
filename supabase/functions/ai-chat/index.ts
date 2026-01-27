import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Message {
    role: "system" | "user" | "assistant";
    content: string;
}

interface ChatRequest {
    messages: Message[];
    model?: string;
    temperature?: number;
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
        const { messages, model, temperature }: ChatRequest = await req.json();

        if (!messages || !Array.isArray(messages)) {
            return new Response(JSON.stringify({ error: "messages array is required" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        if (!GROQ_API_KEY) {
            throw new Error("GROQ_API_KEY is not set");
        }

        const systemPrompt = {
            role: "system",
            content: "You are a helpful, friendly English language tutor. Keep your responses concise (1-3 sentences) to facilitate a fluent voice conversation. Avoid long lectures. Help the user practice speaking."
        };

        // Ensure system prompt is present or prepend it
        const finalMessages = messages.length > 0 && messages[0].role === 'system'
            ? messages
            : [systemPrompt, ...messages];

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: model || "llama-3.1-8b-instant", // Fast model for voice
                messages: finalMessages,
                temperature: temperature || 0.7,
                max_tokens: 150, // Keep it short for voice
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Groq API error: ${response.status} ${errText}`);
        }

        const data = await response.json();
        const reply = data.choices[0]?.message?.content || "";

        return new Response(JSON.stringify({ reply }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (error) {
        console.error("Error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
