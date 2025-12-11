import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { encodeBase64 } from "jsr:@std/encoding/base64";

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  console.log("[google-speech] ===== Request received =====");
  console.log("[google-speech] Method:", req.method);
  console.log("[google-speech] GOOGLE_API_KEY status:", GOOGLE_API_KEY ? "✓ Present" : "✗ Missing");
  
  if (GOOGLE_API_KEY) {
    console.log("[google-speech] GOOGLE_API_KEY length:", GOOGLE_API_KEY.length);
    console.log("[google-speech] GOOGLE_API_KEY prefix:", GOOGLE_API_KEY.substring(0, 10) + "...");
  }

  if (req.method === "OPTIONS") {
    console.log("[google-speech] OPTIONS request - returning CORS headers");
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    console.error("[google-speech] Invalid method:", req.method);
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  if (!GOOGLE_API_KEY) {
    console.error("[google-speech] GOOGLE_API_KEY is missing!");
    return new Response(
      JSON.stringify({ error: "Missing GOOGLE_API_KEY" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    console.log("[google-speech] Content-Type:", contentType);
    
    let audioBlob: Blob;
    let mimeType = "audio/webm";
    
    if (contentType.includes("multipart/form-data")) {
      // Парсим FormData
      const formData = await req.formData();
      const audioFile = formData.get("audio") as File;
      
      if (!audioFile) {
        console.error("[google-speech] No audio file in form data");
        return new Response(
          JSON.stringify({ error: "No audio file provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      audioBlob = audioFile;
      mimeType = audioFile.type || "audio/webm";
      console.log("[google-speech] Audio file size:", audioBlob.size, "type:", mimeType);
    } else {
      // Принимаем аудио как Blob напрямую
      audioBlob = await req.blob();
      mimeType = contentType.split(";")[0] || "audio/webm";
      console.log("[google-speech] Audio blob size:", audioBlob.size, "type:", mimeType);
    }

    if (audioBlob.size === 0) {
      console.error("[google-speech] Empty audio blob");
      return new Response(
        JSON.stringify({ error: "Empty audio file" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Конвертируем аудио в base64
    const arrayBuffer = await audioBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Используем правильное Base64 кодирование через Deno std library
    const base64Audio = encodeBase64(uint8Array);

    // Определяем формат для Google API
    let encoding = "WEBM_OPUS";
    let sampleRate = 48000;
    
    if (mimeType.includes("wav")) {
      encoding = "LINEAR16";
      sampleRate = 16000;
    } else if (mimeType.includes("flac")) {
      encoding = "FLAC";
      sampleRate = 44100;
    } else if (mimeType.includes("mp3")) {
      encoding = "MP3";
      sampleRate = 44100;
    } else if (mimeType.includes("webm")) {
      encoding = "WEBM_OPUS";
      sampleRate = 48000;
    }
    
    console.log("[google-speech] Encoding:", encoding, "Sample rate:", sampleRate);
    console.log("[google-speech] Base64 audio length:", base64Audio.length, "chars");

    // Вызываем Google Speech-to-Text API
    const googleApiUrl = `https://speech.googleapis.com/v1/speech:recognize?key=${GOOGLE_API_KEY.substring(0, 10)}...`;
    console.log("[google-speech] Calling Google Speech API...");
    console.log("[google-speech] API URL:", googleApiUrl);
    console.log("[google-speech] Request payload size:", JSON.stringify({
      config: { encoding, sampleRateHertz: sampleRate, languageCode: "en-US" },
      audio: { content: `[${base64Audio.length} chars]` }
    }).length, "bytes");
    
    const requestStartTime = Date.now();
    const googleResponse = await fetch(
      `https://speech.googleapis.com/v1/speech:recognize?key=${GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          config: {
            encoding: encoding,
            sampleRateHertz: sampleRate,
            languageCode: "en-US",
            alternativeLanguageCodes: ["ru-RU"],
            enableAutomaticPunctuation: true,
          },
          audio: {
            content: base64Audio,
          },
        }),
      }
    );
    
    const requestDuration = Date.now() - requestStartTime;
    console.log("[google-speech] Google API response status:", googleResponse.status, googleResponse.statusText);
    console.log("[google-speech] Request duration:", requestDuration, "ms");

    if (!googleResponse.ok) {
      const errorText = await googleResponse.text();
      console.error("[google-speech] Google Speech API error response:");
      console.error("[google-speech] Status:", googleResponse.status);
      console.error("[google-speech] Error body:", errorText);
      return new Response(
        JSON.stringify({ 
          error: `Google Speech API error: ${errorText}`,
          status: googleResponse.status 
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    console.log("[google-speech] ✓ Google API request successful");

    const data = await googleResponse.json();
    console.log("[google-speech] Google API response received");
    console.log("[google-speech] Response has results:", data.results ? data.results.length : 0);
    
    if (data.results && data.results.length > 0) {
      console.log("[google-speech] First result confidence:", data.results[0].alternatives?.[0]?.confidence || "N/A");
    }
    console.log("[google-speech] Full response (first 300 chars):", JSON.stringify(data).substring(0, 300));

    if (!data.results || data.results.length === 0) {
      console.log("[google-speech] ⚠ No results from Google API - returning empty transcript");
      return new Response(
        JSON.stringify({ transcript: "" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Берем первый результат с наибольшей уверенностью
    const transcript = data.results[0].alternatives[0].transcript;
    console.log("[google-speech] ✓ Transcript extracted:", transcript);
    console.log("[google-speech] ===== Request completed successfully =====");

    return new Response(
      JSON.stringify({ transcript }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[google-speech] ===== ERROR OCCURRED =====");
    console.error("[google-speech] Error type:", error?.constructor?.name || "Unknown");
    console.error("[google-speech] Error message:", error?.message || "No message");
    console.error("[google-speech] Error stack:", error?.stack || "No stack trace");
    console.error("[google-speech] ===== END ERROR =====");
    return new Response(
      JSON.stringify({ 
        error: error?.message || "Internal server error",
        stack: error?.stack 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
