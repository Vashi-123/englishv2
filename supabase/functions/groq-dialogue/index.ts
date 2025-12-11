// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ReqPayload {
  messages: Message[];
  uiLang?: string;
  isFirstMessage?: boolean; // для первого сообщения (инициализация)
  lessonScript?: string; // структура урока (сценарий) - содержит всю информацию о теме, фокусе, словах, дне и уроке
}

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
const MODEL = Deno.env.get("GROQ_MODEL") || "llama-3.1-8b-instant";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

console.info("groq-dialogue function started");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  if (!GROQ_API_KEY) {
    return new Response("Missing GROQ_API_KEY", { status: 500, headers: corsHeaders });
  }

  try {
    const { messages, uiLang, isFirstMessage, lessonScript }: ReqPayload = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response("Missing 'messages' array", { status: 400, headers: corsHeaders });
    }

    if (!lessonScript) {
      return new Response("Missing 'lessonScript' - lesson script is required", { status: 400, headers: corsHeaders });
    }

    const userLang = uiLang || "ru";

    // Генерируем промпт на основе структуры урока
    let systemInstruction: string;
    
    if (lessonScript) {
      // Промпт на основе структуры урока
      systemInstruction = `You are an expert English tutor following a specific lesson script. Your role is to guide the student through the lesson step by step.

CRITICAL RULES:
1. You MUST follow the lesson script EXACTLY as provided
2. You MUST track which step you're currently on in the script
3. You MUST wait for the student's response before moving to the next step
4. ALL your explanations and instructions MUST be in ${userLang} (student's native language)
5. English should ONLY appear as: vocabulary words, example sentences, or phrases to practice
6. When the script requires AUDIO input from the student, you MUST add the tag <audio_input> at the END of your message
7. When the script requires TEXT input, do NOT add <audio_input> tag
8. EVERY message MUST end with a question, task, or call to action that requires the student to respond

📝 TEXT FORMATTING RULES (CRITICAL - Make messages engaging and easy to read):

**YOU MUST USE PROPER FORMATTING IN EVERY MESSAGE!**

1. USE LINE BREAKS (\n) - This is MANDATORY:
   - ALWAYS add blank lines (\n\n) between different ideas or paragraphs
   - NEVER write everything in one continuous paragraph
   - Break long text into 2-3 sentence paragraphs, separated by \n\n
   - Each new thought should start on a new line

2. USE EMOJIS strategically to add warmth and emotion:
   - 👍 for praise and encouragement
   - 🎉 for celebrations and victories
   - 💪 for motivation
   - ✨ for important points
   - 🎯 for goals and focus
   - 💡 for tips and insights
   - ⚡ for energy and action
   - ❤️ for warmth and connection
   - 👋 for greetings

3. CREATE VISUAL STRUCTURE:
   - Start important messages with emoji and line break
   - Use short paragraphs (2-3 sentences max), separated by \n\n
   - Add spacing around examples and lists
   - Use dashes (-) or bullets for lists, each on new line

4. HIGHLIGHT IMPORTANT INFORMATION:
   - Put English words/phrases in quotes: "Hello"
   - ALWAYS add translation in parentheses after English examples: "Hello" (Привет)
   - For practice phrases, sentences, or any English text, ALWAYS include translation: "I am happy" (Я счастлив)
   - Use **bold** for key concepts (if supported)
   - Use CAPS sparingly for emphasis

5. BE ENTHUSIASTIC but natural:
   - Use exclamation marks for excitement (but not too many!)
   - Vary sentence length
   - Use questions to engage

**CRITICAL FORMATTING RULES:**
- ALWAYS use line breaks (\\n\\n) between paragraphs in your message text
- NEVER write everything in one continuous block
- Use emojis strategically for warmth
- Break long text into 2-3 sentence paragraphs
- Separate examples from explanations with line breaks
- Use lists with line breaks for each item

**MANDATORY: ENGLISH EXAMPLES MUST INCLUDE TRANSLATION:**
- EVERY English word, phrase, sentence, or example MUST have translation in parentheses right after it
- Format: "English text" (Translation) or English text (Translation)
- Examples: "Hello" (Привет), "I am happy" (Я счастлив), "My name is..." (Меня зовут...)
- This applies to ALL English content: vocabulary, grammar examples, practice phrases, dialogues
- The translation should be in ${userLang} and appear directly in the text field, NOT in the translation field

**REMEMBER: In your JSON response, the text in "text" field should have \\n\\n for paragraph breaks and include translations for all English examples.**

LESSON SCRIPT:
${lessonScript}

TRACKING PROGRESS:
- Keep track of which "Сообщение Учителя" you've sent
- Wait for student's response before moving to the next step
- If student's response matches "Ожидаемое действие ученика", proceed to next step
- If student's response doesn't match, gently guide them back on track

LESSON COMPLETION:
- When you have completed ALL steps in the lesson script (all "Сообщение Учителя" messages have been sent and student has responded appropriately), you MUST add the tag <lesson_complete> at the END of your final message
- This signals to the application that the lesson is finished and the chat should be closed
- The <lesson_complete> tag should be added ONLY when the entire lesson script has been completed
- Format: Your final message text... <lesson_complete>

Example of lesson completion:
{
  "text": "Отлично! 🎉\\n\\nТы успешно завершил урок! Ты выучил базовые фразы и теперь можешь представиться на английском.\\n\\nДо встречи на следующем уроке! <lesson_complete>",
  "translation": ""
}

AUDIO INPUT SIGNAL:
When the script says "Отправляет аудио" or "Скажи мне вслух" or requires audio response, add <audio_input> at the end of your message text (inside the "text" field).

IMPORTANT: The <audio_input> tag should be at the very end of your message text, after all the content.

Example of audio input request:
{
  "text": "Привет! 👋\\n\\nДавай начнем с самого простого. Скажи мне вслух: \\"Hello!\\" (Привет)\\n\\nНажми кнопку записи и отправь мне это слово. <audio_input>",
  "translation": ""
}

Example of audio input request with lesson completion (if it's the final step):
{
  "text": "Отлично! Ты справился! 🎉\\n\\nСкажи мне последний раз: \\"Hello, I am...\\" (Привет, я...) <audio_input>\\n\\nПосле этого урок будет завершен. <lesson_complete>",
  "translation": ""
}

CRITICAL: When responding to student's audio input, NEVER describe the quality of their audio (e.g., "громко и уверенно", "loud and clear", "звучит хорошо"). You cannot actually hear the audio, so you should only respond to the transcribed text content. Simply acknowledge that you received their message and continue with the lesson.

RESPONSE FORMAT:
You MUST return valid JSON with the following structure:

{
  "text": "Your message text here in ${userLang}",
  "translation": ""
}

CRITICAL: 
- Return ONLY valid JSON, nothing else
- The "text" field MUST contain your message in ${userLang}
- The "translation" field MUST be an empty string "" (do not provide translation)
- Use \\n\\n for line breaks in the text content
- This is the ONLY format the application accepts

Example of correct response:
{
  "text": "Привет! 👋\\n\\nДобро пожаловать на урок!\\n\\nСегодня мы изучим слово \\"Hello\\" (Привет).\\n\\nПопробуй сказать: \\"Hello, I am...\\" (Привет, я...)",
  "translation": ""
}

Return ONLY valid JSON with this exact structure for every response.`;
    }

    // Формируем сообщения для Groq API
    const groqMessages = [
      {
        role: "system",
        content: systemInstruction
      },
      ...messages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      }))
    ];

    // lessonScript уже содержит всю структуру урока, включая приветствие и первое задание
    // ИИ должен следовать lessonScript, поэтому дополнительные промпты не нужны

    // Функция для проверки качества ответа
    const checkResponseQuality = (text: string): { isValid: boolean; hasErrors: boolean; errors: string[] } => {
      const errors: string[] = [];
      let hasErrors = false;

      // Проверка на валидный JSON с правильной структурой
      try {
        const parsed = JSON.parse(text);
        
        // Проверяем наличие обязательных полей
        if (!parsed.text) {
          errors.push('Missing "text" field in JSON response');
          hasErrors = true;
        }
        
        // translation может быть пустым, но поле должно существовать
        if (parsed.translation === undefined) {
          errors.push('Missing "translation" field in JSON response');
          hasErrors = true;
        }
        
        // Проверяем, что text не пустой
        if (parsed.text && parsed.text.trim().length < 10) {
          errors.push('"text" field is too short or empty');
          hasErrors = true;
        }
        
        // Проверяем на встроенные JSON структуры в полях
        if (parsed.text && (parsed.text.includes('"text":') || parsed.text.includes('"translation":') || parsed.text.includes('"en":') || parsed.text.includes('"ru":'))) {
          errors.push('JSON structure embedded in "text" field');
          hasErrors = true;
        }
        
      } catch (e) {
        // Не валидный JSON
        errors.push('Response is not valid JSON');
        hasErrors = true;
      }

      // Проверка на множественные JSON структуры
      const jsonMatches = text.match(/\{[^}]*"text"[^}]*"translation"[^}]*\}/g);
      if (jsonMatches && jsonMatches.length > 1) {
        errors.push('Multiple JSON structures found');
        hasErrors = true;
      }

      // Проверка на старый формат (en/ru) - это тоже ошибка
      if (text.includes('"en":') && text.includes('"ru":') && !text.includes('"text":')) {
        errors.push('Using old format (en/ru) instead of new format (text/translation)');
        hasErrors = true;
      }

      return {
        isValid: !hasErrors,
        hasErrors,
        errors
      };
    };

    // Функция для запроса к Groq с повторными попытками
    const makeGroqRequest = async (requestMessages: any[], isRetry = false, isFixAttempt = false): Promise<{ text: string; success: boolean }> => {
      const maxRetries = 3;
      let attempt = 0;

      while (attempt < maxRetries) {
        try {
          attempt++;
          console.log(`[groq-dialogue] Groq request attempt ${attempt}${isRetry ? ' (retry)' : ''}${isFixAttempt ? ' (fix attempt)' : ''}`);

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
              messages: requestMessages,
        max_tokens: 200,
        temperature: 0.7,
      }),
    });

          // Сценарий 1: API перегружен или не 200 статус
    if (!groqRes.ok) {
            const status = groqRes.status;
      const errText = await groqRes.text();
            console.error(`[groq-dialogue] Groq API error (status ${status}):`, errText);

            // Если это 429 (rate limit) или 503 (service unavailable) или 500 (server error)
            if (status === 429 || status === 503 || status === 500) {
              if (attempt < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, attempt), 5000); // Exponential backoff
                console.log(`[groq-dialogue] Retrying after ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue; // Повторяем запрос
              }
            }

            // Если не удалось после всех попыток
            return { text: '', success: false };
    }

          // Получили ответ 200
    const data = await groqRes.json();
    let text = data?.choices?.[0]?.message?.content;
    
    if (!text) {
            console.error("[groq-dialogue] Empty Groq response");
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
              continue;
            }
            return { text: '', success: false };
          }

          console.log("[groq-dialogue] Raw Groq response:", text.substring(0, 200));

          // Сценарий 2: ВСЕГДА просим ИИ проверить ответ на наличие ошибок
          if (!isFixAttempt) {
            console.log("[groq-dialogue] Requesting AI validation of response");
            
            // Проверяем программно для логирования
            const quality = checkResponseQuality(text);
            if (quality.hasErrors) {
              console.log(`[groq-dialogue] Programmatic check found errors:`, quality.errors);
            }
            
            // ВСЕГДА просим ИИ проверить и исправить при необходимости
            const validationPrompt = `Please check the following response for any errors, bugs, or issues. 

Check for:
- Invalid JSON structure
- Missing "text" or "translation" fields
- JSON structure embedded in text fields
- Multiple JSON structures
- Any other formatting issues

If the response is correct, return it as-is. If there are errors, fix them and return the corrected version.

Response to check:
${text.substring(0, 1000)}

Expected structure:
{
  "text": "Your message text here",
  "translation": ""
}

Return ONLY valid JSON with "text" and "translation" fields. The "translation" field must be an empty string "".`;

            const validationMessages = [
              {
                role: "system",
                content: `You are a quality checker. Check responses for errors and fix them if needed. Always return valid JSON with "text" and "translation" fields.

Expected structure:
{
  "text": "Your message text here",
  "translation": ""
}

Return ONLY valid JSON, nothing else. The "translation" field must be an empty string "".`
              },
              {
                role: "user",
                content: validationPrompt
              }
            ];

            const validationResult = await makeGroqRequest(validationMessages, false, true);
            if (validationResult.success && validationResult.text) {
              // Проверяем, что валидированный ответ действительно лучше
              const validatedQuality = checkResponseQuality(validationResult.text);
              const originalQuality = checkResponseQuality(text);
              
              // Если валидированный ответ лучше или такой же, используем его
              if (!validatedQuality.hasErrors || (validatedQuality.hasErrors && !originalQuality.hasErrors)) {
                console.log("[groq-dialogue] Using AI-validated response");
                return { text: validationResult.text, success: true };
              } else {
                console.log("[groq-dialogue] Validated response has issues, using original");
                // Если валидированный ответ хуже, используем оригинальный
                return { text, success: true };
              }
            } else {
              // Если валидация не удалась, используем оригинальный ответ
              console.log("[groq-dialogue] Validation failed, using original response");
              return { text, success: true };
            }
          }

          // Если это уже попытка исправления, возвращаем как есть
          return { text, success: true };

        } catch (error: any) {
          console.error(`[groq-dialogue] Request error (attempt ${attempt}):`, error);
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          return { text: '', success: false };
        }
      }

      return { text: '', success: false };
    };

    // Делаем запрос с обработкой ошибок
    const result = await makeGroqRequest(groqMessages);
    
    if (!result.success || !result.text) {
      return new Response("Failed to get response from Groq API after retries", { status: 500, headers: corsHeaders });
    }

    let text = result.text;

    // Clean markdown code blocks if present
    text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    console.log("[groq-dialogue] Cleaned text:", text.substring(0, 200));

    // Parse JSON response
    let parsed;
    let responseText = '';
    let responseTranslation = '';
    
    try {
      parsed = JSON.parse(text);
      console.log("[groq-dialogue] Parsed as JSON");
      
      // Extract text and translation from new format
      if (parsed.text) {
        responseText = String(parsed.text).trim();
      }
      
      // translation может быть пустым, но если его нет - ставим пустую строку
      if (parsed.translation !== undefined) {
        responseTranslation = String(parsed.translation).trim();
      } else {
        // Если translation отсутствует, ставим пустую строку
        responseTranslation = '';
      }
      
      // Fallback для старого формата (en/ru)
      if (!responseText && (parsed.en || parsed.ru)) {
        responseText = String(parsed.en || parsed.ru).trim();
        responseTranslation = '';
      }
      
      // Fallback для других возможных полей
      if (!responseText && typeof parsed === 'object' && parsed !== null) {
        responseText = String(parsed.message || parsed.content || text).trim();
        responseTranslation = '';
        }
      
    } catch (e) {
      // Not valid JSON, try to extract JSON from text
      console.log("[groq-dialogue] Not valid JSON, trying to extract");
      
      // Try to find JSON with text/translation
      const jsonMatch = text.match(/\{[\s\S]*?"text"[\s\S]*?"translation"[\s\S]*?\}/);
      
      if (jsonMatch) {
        try {
          let extracted = JSON.parse(jsonMatch[0]);
          if (extracted && extracted.text) {
            responseText = String(extracted.text).trim();
            responseTranslation = extracted.translation !== undefined ? String(extracted.translation).trim() : '';
          }
        } catch (e2) {
          // Try old format (en/ru) as fallback
          const oldFormatMatch = text.match(/\{[\s\S]*?"en"[\s\S]*?"ru"[\s\S]*?\}/);
          if (oldFormatMatch) {
            try {
              let extracted = JSON.parse(oldFormatMatch[0]);
              if (extracted && (extracted.en || extracted.ru)) {
                responseText = String(extracted.en || extracted.ru).trim();
                responseTranslation = '';
        }
            } catch (e3) {
              // Ignore
            }
          }
        }
      }
      
      // If still no valid JSON, use text as-is
      if (!responseText) {
        responseText = text.trim();
        responseTranslation = '';
      }
    }

    // Clean any accidental JSON structures that might still be in text
    let cleanText = responseText
      .replace(/\{[\s\S]*?"text"[\s\S]*?"translation"[\s\S]*?\}/g, '')  // Remove full JSON objects
      .replace(/\{[\s\S]*?"en"[\s\S]*?"ru"[\s\S]*?\}/g, '')  // Remove old format JSON objects
      .replace(/\{[\s\S]*?"text"[\s\S]*?\}/g, '')  // Remove partial JSON with text
      .replace(/"text"\s*:\s*"[^"]*"/g, '')  // Remove "text": "..." patterns
      .replace(/"translation"\s*:\s*"[^"]*"/g, '')  // Remove "translation": "..." patterns
      .trim();
    
    // If after cleaning we have nothing, use original
    if (!cleanText || cleanText.length === 0) {
      cleanText = responseText.trim();
    }
    
    console.log("[groq-dialogue] Final text:", cleanText.substring(0, 150));
    console.log("[groq-dialogue] Final translation:", responseTranslation || '(empty)');
    
    // Return response (translation будет пустым, если ИИ его не вернул)
    return new Response(JSON.stringify({ 
      response: cleanText,
      translation: responseTranslation || ''
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Connection": "keep-alive",
      },
    });
  } catch (err) {
    console.error("groq-dialogue error:", err);
    return new Response(`Internal error: ${err.message}`, { status: 500, headers: corsHeaders });
  }
});

