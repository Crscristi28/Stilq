import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenAI, Part, Content, ThinkingConfig, ThinkingLevel } from "@google/genai";
import * as admin from "firebase-admin";
import { SUGGESTION_PROMPT } from "./prompts/suggestion";

admin.initializeApp();

// --- Request Types ---
interface ChatAttachment {
    mimeType: string;
    data: string;
    name?: string;
}

interface HistoryMessage {
    role: 'user' | 'model';
    text: string;
}

interface ChatSettings {
    userName?: string;
    systemInstruction?: string;
    temperature?: number;
    topP?: number;
    aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
    showSuggestions?: boolean;
}

interface ChatRequest {
    history?: HistoryMessage[];
    newMessage?: string;
    attachments?: ChatAttachment[];
    modelId?: 'gemini-2.5-flash' | 'gemini-3-pro-preview' | 'gemini-2.5-flash-lite' | 'gemini-2.5-flash-image';
    settings?: ChatSettings;
}

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

// Helper: Check if MIME type is supported by inlineData (Images, PDF, Audio, Video)
const isInlineDataSupported = (mimeType: string): boolean => {
    return mimeType.startsWith('image/') || 
           mimeType.startsWith('video/') || 
           mimeType.startsWith('audio/') || 
           mimeType === 'application/pdf';
};

/**
 * Main chat streaming endpoint with SSE (v2)
 * Handles both regular chat and image generation + Auto-Suggestions
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
      const { history, newMessage, attachments, modelId, settings } = req.body as ChatRequest;

      if (!newMessage && (!attachments || attachments.length === 0)) {
        res.status(400).json({ error: "Either message text or attachments are required" });
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
      const parts: Part[] = [];

      if (attachments && attachments.length > 0) {
        attachments.forEach((att: ChatAttachment) => {
            if (isInlineDataSupported(att.mimeType)) {
                // Send as inlineData (Images, PDF, etc.)
                parts.push({
                    inlineData: {
                        mimeType: att.mimeType,
                        data: att.data,
                    },
                });
            } else {
                // Treat as text/code file
                // Decode base64 to string
                try {
                    const decodedText = Buffer.from(att.data, 'base64').toString('utf-8');
                    const fileNameHeader = att.name ? `File: ${att.name}\n` : 'Attached File:\n';
                    
                    parts.push({
                        text: `${fileNameHeader}\`\`\`${att.mimeType}\n${decodedText}\n\`\`\`\n`
                    });
                } catch (e) {
                    console.error(`Failed to decode attachment ${att.name}:`, e);
                    // Fallback or ignore
                }
            }
        });
      }

      if (newMessage && newMessage.trim()) {
        parts.push({ text: newMessage });
      }

      // Convert history
      const contents: Content[] = [
        ...(history || []).map((msg: HistoryMessage) => ({
          role: msg.role,
          parts: [{ text: msg.text }],
        })),
        { role: "user", parts },
      ];

      // --- SYSTEM INSTRUCTION CONSTRUCTION ---
      let systemInstruction = settings?.systemInstruction ? String(settings.systemInstruction) : undefined;
      
      // Personalization: Inject User Name if provided
      const userName = settings?.userName;
      if (userName) {
          const nameInstruction = `The user's name is "${userName}". Use it naturally in conversation where appropriate.`;
          systemInstruction = systemInstruction 
              ? `${nameInstruction}\n\n${systemInstruction}`
              : nameInstruction;
      }

      // Model Type Checks
      const isImageGen = modelId === "gemini-2.5-flash-image";
      const isLite = modelId === "gemini-2.5-flash-lite";
      
      // Thinking Config: Enable for Flash/Pro, Disable for Lite/Image
      const isThinkingCapable = !isLite && !isImageGen;

      // Track full response text for suggestions
      let fullResponseText = "";

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

        if (response.candidates?.[0]?.content?.parts) {
          for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
              const mimeType = part.inlineData.mimeType || 'image/png';
              const base64Data = part.inlineData.data.replace(/\r?\n|\r/g, '');
              // Send as image event (same format as code execution graphs)
              res.write(`data: ${JSON.stringify({
                image: { mimeType, data: base64Data }
              })}\n\n`);
              if ((res as any).flush) (res as any).flush();
            } else if (part.text) {
              // Send any text as text event
              res.write(`data: ${JSON.stringify({ text: part.text })}\n\n`);
              if ((res as any).flush) (res as any).flush();
            }
          }
        } else if (response.text) {
          res.write(`data: ${JSON.stringify({ text: response.text })}\n\n`);
          if ((res as any).flush) (res as any).flush();
        }

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        if ((res as any).flush) (res as any).flush();
        res.end();
        return; // No suggestions for Image Gen
      } else {
        // Regular chat streaming with Google Search & Thinking
        
        // Check if Pro model
        const isPro = modelId === "gemini-3-pro-preview";

        // Configure Thinking based on model type
        let thinkingConfig: ThinkingConfig | undefined = undefined;

        if (isThinkingCapable) {
            if (isPro) {
                // Gemini 3 Pro: uses thinkingLevel
                thinkingConfig = {
                    includeThoughts: true,
                    thinkingLevel: ThinkingLevel.LOW
                };
            } else {
                // Gemini 2.5 Flash: uses thinkingBudget
                // Note: includeThoughts must be true when thinkingBudget > 0
                thinkingConfig = {
                    includeThoughts: false,
                    thinkingBudget: 0
                };
            }
        }

        // Configure Tools based on model
        const tools: any[] = isPro
            ? [
                { googleSearch: {} },
                { codeExecution: {} },
                { urlContext: {} }
              ]
            : [{ googleSearch: {} }];

        console.log(`[DEBUG] Model: ${modelId}, isPro: ${isPro}`);
        console.log(`[DEBUG] Tools config:`, JSON.stringify(tools));
        console.log(`[DEBUG] ThinkingConfig:`, JSON.stringify(thinkingConfig));

        const result = await ai.models.generateContentStream({
          model: modelId || "gemini-2.5-flash",
          contents,
          config: {
            tools,
            thinkingConfig,
            temperature: settings?.temperature ?? 1.0,
            topP: settings?.topP ?? 0.95,
            maxOutputTokens: 65536,
            systemInstruction: systemInstruction,
          },
        });

        let sentMetadata = false;

        for await (const chunk of result) {
          // DEBUG: Log raw chunk structure to see tool usage
          const candidates = (chunk as any).candidates;
          if (candidates && candidates.length > 0) {
             const parts = candidates[0].content?.parts;
             if (parts) {
                 for (const part of parts) {
                     // DEBUG: Log each part type
                     const partKeys = Object.keys(part);
                     console.log(`[DEBUG] Part keys: ${partKeys.join(', ')}`);

                     // Check for tool calls and SEND to client
                     if ((part as any).functionCall) {
                         console.log(`[DEBUG] FUNCTION CALL:`, JSON.stringify((part as any).functionCall));
                     }
                     if ((part as any).executableCode) {
                         console.log(`[DEBUG] CODE EXECUTION:`, JSON.stringify((part as any).executableCode));
                         // Send code to client as markdown code block
                         const code = `\n\`\`\`python\n${(part as any).executableCode.code}\n\`\`\`\n`;
                         fullResponseText += code;
                         res.write(`data: ${JSON.stringify({ text: code })}\n\n`);
                         if ((res as any).flush) (res as any).flush();
                     }
                     if ((part as any).codeExecutionResult) {
                         console.log(`[DEBUG] CODE RESULT:`, JSON.stringify((part as any).codeExecutionResult));
                         // Send result to client
                         const output = (part as any).codeExecutionResult.output || '';
                         const resultText = `\n**Output:**\n\`\`\`\n${output}\n\`\`\`\n`;
                         fullResponseText += resultText;
                         res.write(`data: ${JSON.stringify({ text: resultText })}\n\n`);
                         if ((res as any).flush) (res as any).flush();
                     }

                    // Handle inline images from code execution (matplotlib graphs, etc.)
                    if ((part as any).inlineData) {
                        console.log(`[DEBUG] INLINE DATA:`, (part as any).inlineData.mimeType);
                        const inlineData = (part as any).inlineData;
                        const mimeType = inlineData.mimeType || 'image/png';
                        const base64Data = inlineData.data;
                        // Send as image event (instant display, not token-by-token)
                        res.write(`data: ${JSON.stringify({
                            image: { mimeType, data: base64Data }
                        })}\n\n`);
                        if ((res as any).flush) (res as any).flush();
                    }

                     // Check if this part is a thought
                     const isThought = (part as any).thought === true;

                     if (isThought && part.text) {
                         res.write(`data: ${JSON.stringify({ thinking: part.text })}\n\n`);
                         if ((res as any).flush) (res as any).flush();
                     } else if (part.text) {
                         fullResponseText += part.text; // Accumulate for suggestions
                         res.write(`data: ${JSON.stringify({ text: part.text })}\n\n`);
                         if ((res as any).flush) (res as any).flush();
                     }
                 }
             }
          } else {
              // Fallback for simple text chunks
              const text = chunk.text;
              if (text) {
                fullResponseText += text;
                res.write(`data: ${JSON.stringify({ text })}\n\n`);
                if ((res as any).flush) (res as any).flush();
              }
          }

          // Extract Grounding Metadata (Sources)
          let metadata = (chunk as any).groundingMetadata;
          if (!metadata) {
             metadata = (chunk as any).candidates?.[0]?.groundingMetadata;
          }

          if (metadata && !sentMetadata) {
            if (metadata.groundingChunks) {
               const sources = metadata.groundingChunks
                 .map((c: any) => {
                    if (c.web) {
                        return { title: c.web.title || "Web Source", url: c.web.uri };
                    }
                    return null;
                 })
                 .filter((s: any) => s !== null);

               if (sources.length > 0) {
                 res.write(`data: ${JSON.stringify({ sources })}\n\n`);
                 if ((res as any).flush) (res as any).flush();
                 sentMetadata = true; 
               }
            }
          }

          // Force flush
          if ((res as any).flush) (res as any).flush();
          if ((res.socket as any)?.uncork) (res.socket as any).uncork();
        }

        // --- SUGGESTION GENERATION (Server-Side Pipeline) ---
        // CHECK USER PREFERENCE: Default to true if undefined
        const suggestionsEnabled = settings?.showSuggestions !== false;
        
        console.log(`[Suggestions] Enabled: ${suggestionsEnabled}, Length: ${fullResponseText.trim().length}`);
        
        // Only generate if enabled AND text exists and not too short
        if (suggestionsEnabled && fullResponseText.trim().length > 10) {
            try {
                console.log("[Suggestions] Generating...");
                const suggestionResp = await ai.models.generateContent({
                    model: "gemini-2.5-flash-lite",
                    contents: `
                        ${SUGGESTION_PROMPT}
                        
                        Context - AI Response:
                        "${fullResponseText.slice(0, 2000)}"
                    `,
                    config: {
                        responseMimeType: 'application/json',
                        temperature: 0.7
                    }
                });
                
                const suggText = suggestionResp.text;
                
                if (suggText) {
                    // CLEANUP: Remove markdown blocks if present (common LLM behavior)
                    const cleanJson = suggText.replace(/```json/g, '').replace(/```/g, '').trim();
                    
                    const parsed = JSON.parse(cleanJson);
                    if (Array.isArray(parsed)) {
                        const suggestions = parsed.slice(0, 3);
                        res.write(`data: ${JSON.stringify({ suggestions })}\n\n`);
                        if ((res as any).flush) (res as any).flush();
                    }
                }
            } catch (err) {
                console.error("[Suggestions] Error:", err);
            }
        } else {
             console.log("[Suggestions] Skipped.");
        }

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        if ((res as any).flush) (res as any).flush();
        res.end();
      }
    } catch (error: any) {
      console.error("Stream chat error:", error);
      res.write(
        `data: ${JSON.stringify({ error: error.message || "Failed to generate response" })}\n\n`
      );
      if ((res as any).flush) (res as any).flush();
      res.end();
    }
  });
