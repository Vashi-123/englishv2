import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  if (!GOOGLE_API_KEY) {
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

    // Конвертируем аудио в base64 (правильный способ для больших файлов)
    const arrayBuffer = await audioBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Конвертируем в base64 по частям для больших файлов
    let base64Audio = "";
    const chunkSize = 8192;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.slice(i, i + chunkSize);
      base64Audio += btoa(String.fromCharCode(...chunk));
    }

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

    // Вызываем Google Speech-to-Text API
    console.log("[google-speech] Calling Google Speech API...");
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

    if (!googleResponse.ok) {
      const errorText = await googleResponse.text();
      console.error("[google-speech] Google Speech API error:", errorText);
      return new Response(
        JSON.stringify({ 
          error: `Google Speech API error: ${errorText}`,
          status: googleResponse.status 
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await googleResponse.json();
    console.log("[google-speech] Google API response:", JSON.stringify(data).substring(0, 200));

    if (!data.results || data.results.length === 0) {
      console.log("[google-speech] No results from Google API");
      return new Response(
        JSON.stringify({ transcript: "" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Берем первый результат с наибольшей уверенностью
    const transcript = data.results[0].alternatives[0].transcript;
    console.log("[google-speech] Transcript:", transcript);

    return new Response(
      JSON.stringify({ transcript }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[google-speech] Error processing speech:", error);
    return new Response(
      JSON.stringify({ 
        error: error?.message || "Internal server error",
        stack: error?.stack 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
