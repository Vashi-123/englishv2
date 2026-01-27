import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
            status: 405,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }

    if (!GROQ_API_KEY) {
        console.error("Missing GROQ_API_KEY");
        return new Response(JSON.stringify({ error: "Server configuration error" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }

    try {
        // 1. Parse the incoming form data to get the file
        const formData = await req.formData();
        const file = formData.get("file");

        if (!file || !(file instanceof File)) {
            return new Response(JSON.stringify({ error: "No file uploaded. Please send a 'file' form-data field." }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        console.log(`Received file: ${file.name}, size: ${file.size} bytes, type: ${file.type}`);

        // 2. Prepare FormData for Groq API
        const groqFormData = new FormData();
        groqFormData.append("file", file);
        groqFormData.append("model", "whisper-large-v3-turbo");

        // Optional parameters (pass through if provided)
        // Default to 'en' (English) as requested to improve accuracy for English speech
        const language = formData.get("language") || "en";
        groqFormData.append("language", language);

        const prompt = formData.get("prompt");
        if (prompt) groqFormData.append("prompt", prompt);

        const responseFormat = formData.get("response_format") || "json";
        groqFormData.append("response_format", responseFormat);

        // 3. Send to Groq
        const groqResponse = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                // Note: Do NOT set Content-Type header with FormData, fetch sets it automatically with boundary
            },
            body: groqFormData,
        });

        if (!groqResponse.ok) {
            const errorText = await groqResponse.text();
            console.error("Groq API error:", errorText);
            return new Response(JSON.stringify({ error: `Groq API Error: ${errorText}` }), {
                status: groqResponse.status,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        // 4. Return the result
        const result = await groqResponse.json(); // May be text/json depending on response_format, but Groq default is JSON

        return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (error) {
        console.error("Internal Server Error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }
});
