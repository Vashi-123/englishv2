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
    
    let audioBlob: Blob;
    let mimeType = "audio/webm";
    
    if (contentType.includes("multipart/form-data")) {
      // Парсим FormData вручную
      const formData = await req.formData();
      const audioFile = formData.get("audio") as File;
      
      if (!audioFile) {
        return new Response(
          JSON.stringify({ error: "No audio file provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      audioBlob = audioFile;
      mimeType = audioFile.type || "audio/webm";
    } else {
      // Принимаем аудио как Blob напрямую
      audioBlob = await req.blob();
      mimeType = contentType.split(";")[0] || "audio/webm";
    }

    // Конвертируем аудио в base64
    const arrayBuffer = await audioBlob.arrayBuffer();
    const base64Audio = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

    // Определяем формат для Google API
    let encoding = "WEBM_OPUS";
    if (mimeType.includes("wav")) encoding = "LINEAR16";
    else if (mimeType.includes("flac")) encoding = "FLAC";
    else if (mimeType.includes("mp3")) encoding = "MP3";
    else if (mimeType.includes("webm")) encoding = "WEBM_OPUS";

    // Вызываем Google Speech-to-Text API
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
            sampleRateHertz: 48000,
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
      console.error("Google Speech API error:", errorText);
      return new Response(
        JSON.stringify({ error: `Google Speech API error: ${errorText}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await googleResponse.json();

    if (!data.results || data.results.length === 0) {
      return new Response(
        JSON.stringify({ transcript: "" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Берем первый результат с наибольшей уверенностью
    const transcript = data.results[0].alternatives[0].transcript;

    return new Response(
      JSON.stringify({ transcript }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error processing speech:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
