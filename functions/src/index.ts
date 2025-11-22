import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenAI } from "@google/genai";
import * as admin from "firebase-admin";

admin.initializeApp();

// Define secret for Gemini API key
const geminiApiKey = defineSecret("GEMINI_API_KEY");

// Initialize Gemini with API key from Secret Manager
const getAI = () => {
  const apiKey = geminiApiKey.value();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY secret not configured");
  }
  return new GoogleGenAI({ apiKey });
};

/**
 * Main chat streaming endpoint with SSE (v2)
 * Handles both regular chat and image generation
 */
export const streamChat = onRequest(
  {
    secrets: [geminiApiKey],
    timeoutSeconds: 540,
    memory: "512MiB",
    cors: true,
  },
  async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.status(200).end();
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      const { history, newMessage, attachments, modelId, settings } = req.body;

      if (!newMessage) {
        res.status(400).json({ error: "newMessage is required" });
        return;
      }

      // Set up SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
      res.flushHeaders(); // Flush headers immediately to start streaming

      const ai = getAI();

      // Prepare message parts
      const parts: any[] = [];

      if (attachments && attachments.length > 0) {
        attachments.forEach((att: any) => {
          parts.push({
            inlineData: {
              mimeType: att.mimeType,
              data: att.data,
            },
          });
        });
      }

      if (newMessage) {
        parts.push({ text: newMessage });
      }

      // Convert history
      const contents = [
        ...(history || []).map((msg: any) => ({
          role: msg.role,
          parts: [{ text: msg.text }],
        })),
        { role: "user", parts },
      ];

      const systemInstruction = settings?.systemInstruction || undefined;

      // Check if this is image generation model
      const isImageGen = modelId === "gemini-2.5-flash-image";

      if (isImageGen) {
        // Image generation (non-streaming)
        const response: any = await ai.models.generateContent({
          model: modelId,
          contents,
          config: {
            imageConfig: settings?.aspectRatio ? {
              aspectRatio: settings.aspectRatio
            } : undefined
          }
        });

        let generatedContent = "";

        if (response.candidates?.[0]?.content?.parts) {
          for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
              const mimeType = part.inlineData.mimeType || 'image/png';
              const base64Data = part.inlineData.data.replace(/\r?\n|\r/g, '');
              generatedContent += `\n![Generated Image](data:${mimeType};base64,${base64Data})\n`;
            } else if (part.text) {
              generatedContent += part.text;
            }
          }
        }

        if (!generatedContent && response.text) {
          generatedContent = response.text;
        }

        // Send as single SSE event
        if (generatedContent) {
          res.write(`data: ${JSON.stringify({ text: generatedContent })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      } else {
        // Regular chat streaming
        const result = await ai.models.generateContentStream({
          model: modelId || "gemini-2.5-flash",
          contents,
          config: {
            temperature: settings?.temperature || 1.0,
            topP: settings?.topP || 0.95,
            systemInstruction,
          },
        });

        for await (const chunk of result) {
          const text = chunk.text;
          if (text) {
            res.write(`data: ${JSON.stringify({ text })}\n\n`);
            // Force flush to underlying socket
            if ((res as any).flush) (res as any).flush();
            if ((res.socket as any)?.uncork) (res.socket as any).uncork();
          }
        }

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      }
    } catch (error: any) {
      console.error("Stream chat error:", error);
      res.write(
        `data: ${JSON.stringify({ error: error.message || "Failed to generate response" })}\n\n`
      );
      res.end();
    }
  });

/**
 * Intent detection endpoint (v2)
 * Detects if user wants image generation or chat
 */
export const detectIntent = onRequest(
  {
    secrets: [geminiApiKey],
    timeoutSeconds: 60,
    memory: "256MiB",
    cors: true,
  },
  async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.status(200).end();
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      const { newMessage, lastHistory } = req.body;

      if (!newMessage) {
        res.status(400).json({ error: "newMessage is required" });
        return;
      }

      const ai = getAI();
      const recentContext = (lastHistory || []).slice(-2)
        .map((m: any) => `${m.role}: ${m.text}`)
        .join('\n');

      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash-lite",
        contents: `
Role: You are an intent classifier for an AI assistant.
Task: Analyze the user's latest message and decide if they want to GENERATE or EDIT an image, or just Chat.

Context:
${recentContext}

User Message: "${newMessage}"

Instructions:
- If the user explicitly asks to "draw", "generate", "create", "make", "paint" an image, picture, or photo, return "IMAGE".
- If the user asks to "edit", "change", "modify" an attached image, return "IMAGE".
- Otherwise, return "CHAT".

Output: Return ONLY the word "IMAGE" or "CHAT". Do not add json or markdown.
        `,
        config: {
          temperature: 0.0,
          maxOutputTokens: 10,
        }
      });

      const intent = response.text?.trim().toUpperCase();
      res.json({ intent: intent === 'IMAGE' ? 'IMAGE' : 'CHAT' });
    } catch (error: any) {
      console.error("Intent detection error:", error);
      res.json({ intent: 'CHAT' }); // Default to chat on error
    }
  });

/**
 * Generate follow-up suggestions endpoint (v2)
 */
export const generateSuggestions = onRequest(
  {
    secrets: [geminiApiKey],
    timeoutSeconds: 60,
    memory: "256MiB",
    cors: true,
  },
  async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.status(200).end();
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      const { lastUserMessage, lastBotResponse } = req.body;

      // Don't generate for missing data or very short answers
      if (!lastUserMessage || !lastBotResponse || lastBotResponse.trim().length < 20) {
        res.json({ suggestions: [] });
        return;
      }

      const ai = getAI();
      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash-lite",
        contents: `
Role: You are a helpful AI assistant whose only job is to generate 3 useful and relevant follow-up questions.

Task: Based SOLELY on the AI's last response, generate 3 short, insightful follow-up questions that a HUMAN user would realistically ask next to continue the conversation in a meaningful way.

AI's Last Response:
"${lastBotResponse.slice(0, 500)}"

CRITICAL RULES:
1. The questions must be from the USER'S perspective.
2. The questions must be directly related to the topics, concepts, or entities mentioned in the AI's response.
3. DO NOT suggest questions that the AI should ask the user (e.g., "How can I help you?"). This is a common mistake and must be avoided.
4. DO NOT suggest generic greetings, simple affirmations, or questions that were already answered.

Output Format: Return ONLY a clean JSON array of 3 strings. Do not add any other text or markdown.
Example Output: ["Can you explain that in simpler terms?", "What is a real-world example of that?", "How does that relate to [topic]?"]
        `,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.7,
        }
      });

      const text = response.text;
      if (!text) {
        res.json({ suggestions: [] });
        return;
      }

      const suggestions = JSON.parse(text);
      if (Array.isArray(suggestions)) {
        // Filter out any bad/empty suggestions
        const filtered = suggestions.filter(s => typeof s === 'string' && s.trim().length > 0).slice(0, 3);
        res.json({ suggestions: filtered });
      } else {
        res.json({ suggestions: [] });
      }
    } catch (error: any) {
      console.error("Suggestions error:", error);
      res.json({ suggestions: [] });
    }
  });
