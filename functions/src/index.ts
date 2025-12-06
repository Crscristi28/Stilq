import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenAI, Part, Content, ThinkingConfig, ThinkingLevel, Type } from "@google/genai";
import * as admin from "firebase-admin";
import { SUGGESTION_PROMPT } from "./prompts/suggestion";
import { ROUTER_PROMPT } from "./prompts/router";
import { FLASH_SYSTEM_PROMPT } from "./prompts/flash";
import { IMAGE_AGENT_SYSTEM_PROMPT } from "./prompts/image-agent";

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
    imageStyle?: string; // Added imageStyle
    showSuggestions?: boolean;
}

interface ChatRequest {
    history?: HistoryMessage[];
    newMessage?: string;
    attachments?: ChatAttachment[];
    modelId?: 'gemini-2.5-flash' | 'gemini-3-pro-preview' | 'gemini-2.5-flash-lite' | 'gemini-2.5-flash-image' | 'auto' | 'image-agent';
    settings?: ChatSettings;
}

interface RouterDecision {
    targetModel: string;
    reasoning: string;
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

// Helper: Router Logic
async function determineModelFromIntent(ai: GoogleGenAI, lastMessage: string, history: HistoryMessage[]): Promise<RouterDecision> {
    try {
        // Simple context summary (last 2 messages to save tokens)
        const context = history.slice(-2).map(m => `${m.role}: ${m.text}`).join('\n');
        
        const prompt = `
        ${ROUTER_PROMPT}
        
        Context:
        ${context}
        
        User Request: "${lastMessage}"
        `;

        const result: any = await ai.models.generateContent({
            model: "gemini-2.5-flash-lite",
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: { responseMimeType: 'application/json' }
        });

        const text = result.text;
        return JSON.parse(text || "{}") as RouterDecision;
    } catch (e) {
        console.error("Router failed, defaulting to Flash:", e);
        return { targetModel: "gemini-2.5-flash", reasoning: "Router error fallback" };
    }
}

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

      // --- ROUTER LOGIC ---
      let selectedModelId: string | undefined = modelId;

      if (modelId === 'auto') {
          try {
             const decision = await determineModelFromIntent(ai, newMessage || "User sent attachment", history || []);
             selectedModelId = decision.targetModel;
             console.log(`[Auto-Router] Routed to ${selectedModelId}. Reason: ${decision.reasoning}`);
             
             // Optional: Inform client of routing decision (debug or UI feedback)
             // res.write(`data: ${JSON.stringify({ thinking: `Auto-routed to ${selectedModelId} (${decision.reasoning})` })}\n\n`);
          } catch (err) {
             console.error("[Auto-Router] Error, using default:", err);
             selectedModelId = "gemini-2.5-flash";
          }
      }

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

      // Model Type Checks (Use selectedModelId)
      const isFlash = selectedModelId === "gemini-2.5-flash";
      const isPro = selectedModelId === "gemini-3-pro-preview";

      // Add model-specific system prompts
      if (isFlash) {
          systemInstruction = systemInstruction
              ? `${FLASH_SYSTEM_PROMPT}\n\n${systemInstruction}`
              : FLASH_SYSTEM_PROMPT;
      }

      // Other Model Type Checks
      const isImageGen = selectedModelId === "gemini-2.5-flash-image";
      const isImageAgent = selectedModelId === "image-agent";
      const isLite = selectedModelId === "gemini-2.5-flash-lite";

      // Thinking Config: Enable for Flash/Pro, Disable for Lite/Image/ImageAgent
      const isThinkingCapable = !isLite && !isImageGen && !isImageAgent;

      // Track full response text for suggestions
      let fullResponseText = "";

      if (isImageGen) {
        // Image generation (non-streaming)
        
        // --- STYLE MODIFIER ---
        // If a style is selected, append it to the user's prompt
        if (settings?.imageStyle && settings.imageStyle !== 'none') {
            const readableStyle = settings.imageStyle.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            const stylePrompt = `\n\nStyle: ${readableStyle}, high quality, detailed.`;
            
            // Find the text part in the last user message and append style
            const lastUserMsg = contents[contents.length - 1];
            if (lastUserMsg && lastUserMsg.parts) {
                const textPart = lastUserMsg.parts.find(p => p.text);
                if (textPart) {
                    textPart.text += stylePrompt;
                } else {
                    lastUserMsg.parts.push({ text: stylePrompt });
                }
            }
        }

        const response: any = await ai.models.generateContent({
          model: selectedModelId!, // Use routed model
          contents,
          config: {
            responseModalities: ['TEXT', 'IMAGE'],
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
        return;
      } else if (isImageAgent) {
        // IMAGE AGENT: Flash with generateImage tool
        const generateImageTool = {
          functionDeclarations: [{
            name: "generateImage",
            description: "Generate an image based on a text prompt",
            parameters: {
              type: Type.OBJECT,
              properties: {
                prompt: {
                  type: Type.STRING,
                  description: "Detailed description of the image to generate"
                },
                aspectRatio: {
                  type: Type.STRING,
                  enum: ["1:1", "16:9", "9:16", "4:3", "3:4"],
                  description: "Aspect ratio for the image"
                },
                style: {
                  type: Type.STRING,
                  description: "Optional style modifier (e.g. photorealistic, anime, sketch)"
                }
              },
              required: ["prompt"]
            }
          }]
        };

        const agentResult = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents,
          config: {
            tools: [generateImageTool],
            systemInstruction: IMAGE_AGENT_SYSTEM_PROMPT,
            thinkingConfig: {
              thinkingBudget: 0
            }
          }
        });

        const agentResponse = agentResult as any;
        const parts = agentResponse.candidates?.[0]?.content?.parts || [];

        for (const part of parts) {
          // Check for function call
          if (part.functionCall) {
            const { name, args } = part.functionCall;
            console.log(`[ImageAgent] Function call: ${name}`, args);

            if (name === "generateImage") {
              const imagePrompt = args.prompt || "";
              const aspectRatio = args.aspectRatio || settings?.aspectRatio || "1:1";
              const style = args.style || settings?.imageStyle;

              let finalPrompt = imagePrompt;
              if (style && style !== "none") {
                finalPrompt += `\n\nStyle: ${style}, high quality, detailed.`;
              }

              // Call the image model
              const imageResponse: any = await ai.models.generateContent({
                model: "gemini-2.5-flash-image",
                contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
                config: {
                  responseModalities: ['TEXT', 'IMAGE'],
                  imageConfig: { aspectRatio }
                }
              });

              const imageParts = imageResponse.candidates?.[0]?.content?.parts || [];
              for (const imgPart of imageParts) {
                if (imgPart.inlineData) {
                  const mimeType = imgPart.inlineData.mimeType || 'image/png';
                  const base64Data = imgPart.inlineData.data.replace(/\r?\n|\r/g, '');
                  // Include aspectRatio so frontend can size skeleton correctly
                  res.write(`data: ${JSON.stringify({ image: { mimeType, data: base64Data, aspectRatio } })}\n\n`);
                  if ((res as any).flush) (res as any).flush();
                } else if (imgPart.text) {
                  res.write(`data: ${JSON.stringify({ text: imgPart.text })}\n\n`);
                  if ((res as any).flush) (res as any).flush();
                }
              }
            }
          } else if (part.text) {
            res.write(`data: ${JSON.stringify({ text: part.text })}\n\n`);
            if ((res as any).flush) (res as any).flush();
          }
        }

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        if ((res as any).flush) (res as any).flush();
        res.end();
        return;
      } else {
        // Regular chat streaming with Google Search & Thinking

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
                    includeThoughts: true,
                    thinkingBudget: 1024
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

        console.log(`[DEBUG] Model: ${selectedModelId}, isPro: ${isPro}`);
        console.log(`[DEBUG] Tools config:`, JSON.stringify(tools));
        console.log(`[DEBUG] ThinkingConfig:`, JSON.stringify(thinkingConfig));

        const result = await ai.models.generateContentStream({
          model: selectedModelId || "gemini-2.5-flash",
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
                         const output = (part as any).codeExecutionResult.output || '';

                         // Check if output contains a base64 image (matplotlib/pillow output)
                         const base64ImageRegex = /data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=]+)/;
                         const imageMatch = output.match(base64ImageRegex);

                         if (imageMatch) {
                             // Found base64 image in output - send as image event
                             const mimeType = `image/${imageMatch[1]}`;
                             const base64Data = imageMatch[2];
                             console.log(`[DEBUG] Found base64 image in code output: ${mimeType}`);
                             res.write(`data: ${JSON.stringify({
                                 image: { mimeType, data: base64Data }
                             })}\n\n`);
                             if ((res as any).flush) (res as any).flush();
                         } else {
                             // Regular text output
                             const resultText = `\n**Output:**\n\`\`\`\n${output}\n\`\`\`\n`;
                             fullResponseText += resultText;
                             res.write(`data: ${JSON.stringify({ text: resultText })}\n\n`);
                             if ((res as any).flush) (res as any).flush();
                         }
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
        if (suggestionsEnabled && fullResponseText.trim().length > 150) {
            try {
                console.log("[Suggestions] Generating...");
                const suggestionResp: any = await ai.models.generateContent({
                    model: "gemini-2.5-flash-lite",
                    contents: [{ 
                        role: "user",
                        parts: [{
                            text: `
                                ${SUGGESTION_PROMPT}
                                
                                Context - AI Response:
                                "${fullResponseText.slice(0, 2000)}"
                            `
                        }]
                    }],
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
