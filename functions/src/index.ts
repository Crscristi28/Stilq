import { onRequest } from "firebase-functions/v2/https";
import { GoogleGenAI, Part, Content, ThinkingLevel, Type } from "@google/genai";
import * as admin from "firebase-admin";
import * as fs from "fs";
import { SUGGESTION_PROMPT } from "./prompts/suggestion";
import { ROUTER_PROMPT } from "./prompts/router";
import { FLASH_SYSTEM_PROMPT } from "./prompts/flash";
import { IMAGE_AGENT_SYSTEM_PROMPT } from "./prompts/image-agent";
import { RESEARCH_SYSTEM_PROMPT } from "./prompts/research";
import { PRO25_SYSTEM_PROMPT } from "./prompts/pro25";
import { PRO3_PREVIEW_SYSTEM_PROMPT } from "./prompts/pro3-preview";
import { buildProImageContents, handleProImageStream } from "./handlers/pro-image";

admin.initializeApp();

// --- Request Types ---
interface ChatAttachment {
    mimeType: string;
    data: string;
    name?: string;
    storageUrl?: string;
    fileUri?: string;
}

interface HistoryMessage {
    role: 'user' | 'model';
    text: string;
    imageUrls?: string[];
}

interface ChatSettings {
    userName?: string;
    systemInstruction?: string;
    aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
    imageStyle?: string;
    showSuggestions?: boolean;
}

interface ChatRequest {
    history?: HistoryMessage[];
    newMessage?: string;
    attachments?: ChatAttachment[];
    modelId?: 'gemini-3-flash-preview' | 'gemini-3-pro-preview' | 'gemini-2.5-pro' | 'gemini-2.5-flash-lite' | 'gemini-2.5-flash-image' | 'gemini-3-pro-image-preview' | 'auto' | 'image-agent' | 'research';
    settings?: ChatSettings;
}

interface RouterDecision {
    targetModel: string;
    reasoning: string;
}

// API Key instance (chat, router, suggestions, generateImage - has code execution)
const getAI = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured");
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

// Helper: Normalize MIME type for File API (avoid codeExecution errors)
// Everything that's not media becomes text/plain - model is smart enough to understand content
const getFileApiMimeType = (mimeType: string): string => {
    const isMedia = mimeType.startsWith('image/') ||
                    mimeType.startsWith('video/') ||
                    mimeType.startsWith('audio/') ||
                    mimeType === 'application/pdf';
    return isMedia ? mimeType : 'text/plain';
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

        const result = await ai.models.generateContent({
            model: "gemini-2.5-flash-lite",
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: {
                responseMimeType: 'application/json',
                temperature: 0,
                topK: 1,
                topP: 1.0,
                maxOutputTokens: 150
            }
        });

        const text = result.text;
        // Clean markdown wrapper if present (```json ... ```)
        const cleanJson = (text || "{}").replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanJson) as RouterDecision;
    } catch (e) {
        console.error("Router failed, defaulting to Flash:", e);
        return { targetModel: "gemini-3-flash-preview", reasoning: "Router error fallback" };
    }
}

/**
 * Main chat streaming endpoint with SSE (v2)
 * Handles both regular chat and image generation + Auto-Suggestions
 */
export const streamChat = onRequest(
  {
    timeoutSeconds: 540,
    memory: "1GiB",
    cors: true,
    secrets: ["GEMINI_API_KEY"],
    minInstances: 1,
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

      // --- ROUTER LOGIC ---
      let selectedModelId: string | undefined = modelId;

      if (modelId === 'auto') {
          try {
             // Router uses API Key
             const routerAI = getAI();
             const decision = await determineModelFromIntent(routerAI, newMessage || "User sent attachment", history || []);
             selectedModelId = decision.targetModel;
             console.log(`[Auto-Router] Routed to ${selectedModelId}. Reason: ${decision.reasoning}`);

             // Inform client of routing decision for UI (e.g., indicators)
             res.write(`data: ${JSON.stringify({ routedModel: selectedModelId })}\n\n`);
             if ((res as any).flush) (res as any).flush();
          } catch (err) {
             console.error("[Auto-Router] Error, using default:", err);
             selectedModelId = "gemini-3-flash-preview";
          }
      }

      // Prepare message parts
      const parts: Part[] = [];

      if (attachments && attachments.length > 0) {
        attachments.forEach((att: ChatAttachment) => {
            if (att.fileUri) {
                // Use File API URI (no size limit, faster)
                // MIME type must match what was used in unifiedUpload
                parts.push({
                    fileData: {
                        fileUri: att.fileUri,
                        mimeType: getFileApiMimeType(att.mimeType),
                    },
                });
            } else if (isInlineDataSupported(att.mimeType)) {
                // Fallback: Send as inlineData (has 10MB limit)
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

      // Model checks for history limiting (must be before contents)
      const isImageGen = selectedModelId === "gemini-2.5-flash-image";
      const isResearch = selectedModelId === "research";

      // Limit history for expensive/specialized models (save tokens & costs)
      const limitedHistory = isImageGen
        ? (history || []).slice(-1)   // Image mode: last 1 message
        : isResearch
        ? (history || []).slice(-2)   // Research mode: last 2 messages
        : (history || []);            // Others: full history

      // Convert history (clean - no image URLs, saves tokens for non-image models)
      const contents: Content[] = [
        ...limitedHistory.map((msg: HistoryMessage) => ({
          role: msg.role,
          parts: [{ text: msg.text }],
        })),
        { role: "user", parts },
      ];

      // Log contents for non-Pro Image models (helps debug model switching)
      console.log(`[CONTENTS BUILD] Model: ${selectedModelId} | History: ${limitedHistory.length} messages | Total contents: ${contents.length}`);
      contents.forEach((c, i) => {
        const partTypes = c.parts?.map(p => {
          if ((p as any).text !== undefined) return 'text';
          if ((p as any).inlineData) return 'inlineData';
          if ((p as any).fileData) return 'fileData';
          return 'unknown';
        }).join(', ') || 'none';
        console.log(`[CONTENTS BUILD] Content[${i}] role=${c.role} parts=[${partTypes}]`);
      });

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
      const isFlash = selectedModelId === "gemini-3-flash-preview";
      const isPro = selectedModelId === "gemini-3-pro-preview";
      const isPro25 = selectedModelId === "gemini-2.5-pro" && !isResearch; // PRO_25 manual selection (isResearch is already checked before model ID mapping)
      const isProImage = selectedModelId === "gemini-3-pro-image-preview";

      // Log model selection for debugging
      console.log(`[MODEL] Selected: ${selectedModelId} | isFlash: ${isFlash} | isPro: ${isPro} | isPro25: ${isPro25} | isProImage: ${isProImage} | isResearch: ${isResearch}`);

      // Add model-specific system prompts
      // User preferences are wrapped in <user_preferences> to clearly separate from system instructions
      if (isFlash) {
          systemInstruction = systemInstruction
              ? `${FLASH_SYSTEM_PROMPT}\n\n<user_preferences>\n${systemInstruction}\n</user_preferences>`
              : FLASH_SYSTEM_PROMPT;
      } else if (isPro) {
          systemInstruction = systemInstruction
              ? `${PRO3_PREVIEW_SYSTEM_PROMPT}\n\n<user_preferences>\n${systemInstruction}\n</user_preferences>`
              : PRO3_PREVIEW_SYSTEM_PROMPT;
      } else if (isPro25) {
          systemInstruction = systemInstruction
              ? `${PRO25_SYSTEM_PROMPT}\n\n<user_preferences>\n${systemInstruction}\n</user_preferences>`
              : PRO25_SYSTEM_PROMPT;
      }
      // Note: Research has its own block with RESEARCH_SYSTEM_PROMPT

      // Other Model Type Checks
      const isImageAgent = selectedModelId === "image-agent";

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

        // Image generation uses Gemini API (supports fileUri from File API)
        const imageGenAI = getAI();
        const response = await imageGenAI.models.generateContent({
          model: selectedModelId!,
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
            if (part.inlineData && part.inlineData.data) {
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
          name: "generateImage",
          description: "Generate a NEW image based on a text prompt. Use this when user wants to create a completely new image.",
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
        };

        const editImageTool = {
          name: "editImage",
          description: "Edit an EXISTING image using natural language instructions. Use this when user wants to modify, change, or transform an image they uploaded or you previously generated.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              imageUrl: {
                type: Type.STRING,
                description: "The Firebase Storage URL of the image (for reference/logging)"
              },
              fileUri: {
                type: Type.STRING,
                description: "The Google AI File API URI for the image (use this for the model)"
              },
              mimeType: {
                type: Type.STRING,
                description: "The MIME type of the image (e.g. image/webp, image/png, image/jpeg)"
              },
              prompt: {
                type: Type.STRING,
                description: "Clear instruction describing what changes to make to the image"
              }
            },
            required: ["imageUrl", "fileUri", "mimeType", "prompt"]
          }
        };

        const imageAgentTools = {
          functionDeclarations: [generateImageTool, editImageTool]
        };

        // Build special contents for image-agent with image URLs in each message
        // Start with history messages (add URLs to each)
        const historyWithUrls = (history || []).map((msg: HistoryMessage) => {
          let msgText = msg.text;
          if (msg.imageUrls && msg.imageUrls.length > 0) {
            const imageRefs = msg.imageUrls.map((url, idx) => `${idx + 1}. ${url}`).join('\n');
            msgText += `\n\n[Images in this message:\n${imageRefs}]`;
          }
          return {
            role: msg.role,
            parts: [{ text: msgText }],
          };
        });

        // Copy current user message from contents (last item)
        const currentUserMsg = contents[contents.length - 1];
        const imageAgentContents: Content[] = [
          ...historyWithUrls,
          { role: currentUserMsg.role, parts: currentUserMsg.parts ? [...currentUserMsg.parts] : [] },
        ];

        // Add current attachment URLs to the last user message
        const currentImages: Array<{storageUrl: string, fileUri?: string, mimeType: string}> = [];
        if (attachments) {
          attachments.forEach(att => {
            if (att.storageUrl && att.mimeType?.startsWith('image/')) {
              currentImages.push({
                storageUrl: att.storageUrl,
                fileUri: att.fileUri,
                mimeType: att.mimeType
              });
            }
          });
        }

        if (currentImages.length > 0) {
          const urlContext = `\n\n[Images attached to this message:\n${currentImages.map((img, idx) => `${idx + 1}. storageUrl: ${img.storageUrl} | fileUri: ${img.fileUri || 'N/A'} | mimeType: ${img.mimeType}`).join('\n')}]`;
          const lastMsg = imageAgentContents[imageAgentContents.length - 1];
          if (lastMsg && lastMsg.parts) {
            const textPartIndex = lastMsg.parts.findIndex(p => p.text);
            if (textPartIndex >= 0) {
              (lastMsg.parts[textPartIndex] as any).text += urlContext;
            } else {
              lastMsg.parts.push({ text: urlContext });
            }
          }
        }

        // Image agent uses Gemini API (supports fileUri from File API)
        const imageAgentAI = getAI();
        const agentResult = await imageAgentAI.models.generateContent({
          model: "gemini-2.5-flash",
          contents: imageAgentContents,
          config: {
            tools: [imageAgentTools],
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

              // Notify frontend that image generation is starting
              res.write(`data: ${JSON.stringify({ generatingImage: true })}\n\n`);
              if ((res as any).flush) (res as any).flush();

              // Call the image model (Gemini API - supports fileUri)
              const generateImageAI = getAI();
              const imageResponse = await generateImageAI.models.generateContent({
                model: "gemini-2.5-flash-image",
                contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
                config: {
                  responseModalities: ['TEXT', 'IMAGE'],
                  imageConfig: { aspectRatio }
                }
              });

              const imageParts = imageResponse.candidates?.[0]?.content?.parts || [];
              for (const imgPart of imageParts) {
                // Only send images, ignore text from image model (agent already writes text)
                if (imgPart.inlineData && imgPart.inlineData.data) {
                  const mimeType = imgPart.inlineData.mimeType || 'image/png';
                  const base64Data = imgPart.inlineData.data.replace(/\r?\n|\r/g, '');
                  // Include aspectRatio so frontend can size skeleton correctly
                  res.write(`data: ${JSON.stringify({ image: { mimeType, data: base64Data, aspectRatio } })}\n\n`);
                  if ((res as any).flush) (res as any).flush();
                }
              }
            } else if (name === "editImage") {
              const imageUrl = args.imageUrl; // storageUrl (Firebase - always HTTPS)
              const rawFileUri = args.fileUri;
              const imageMimeType = args.mimeType || 'image/png';
              const editPrompt = args.prompt;

              // Hybrid Selector: gai-image:// is temp internal ref (expires), use storageUrl instead
              const isInternalGenerativeUri = rawFileUri?.startsWith('gai-image://');
              const imageFileUri = (rawFileUri && !isInternalGenerativeUri) ? rawFileUri : imageUrl;

              console.log(`[ImageAgent] Editing image | storageUrl: ${imageUrl} | rawFileUri: ${rawFileUri} | finalUri: ${imageFileUri} | mimeType: ${imageMimeType}`);

              // Notify frontend that image editing is starting
              res.write(`data: ${JSON.stringify({ generatingImage: true })}\n\n`);
              if ((res as any).flush) (res as any).flush();

              // Call the image model with existing image (Gemini API - supports fileUri)
              const editImageAI = getAI();
              const editResponse = await editImageAI.models.generateContent({
                model: "gemini-2.5-flash-image",
                contents: [{
                  role: "user",
                  parts: [
                    { fileData: { fileUri: imageFileUri, mimeType: imageMimeType } },
                    { text: `${editPrompt}. Keep original aspect ratio and orientation.` }
                  ]
                }],
                config: {
                  responseModalities: ['TEXT', 'IMAGE']
                }
              });

              const editParts = editResponse.candidates?.[0]?.content?.parts || [];
              for (const editPart of editParts) {
                // Only send images, ignore text from image model (agent already writes text)
                if (editPart.inlineData && editPart.inlineData.data) {
                  const mimeType = editPart.inlineData.mimeType || 'image/png';
                  const base64Data = editPart.inlineData.data.replace(/\r?\n|\r/g, '');
                  res.write(`data: ${JSON.stringify({ image: { mimeType, data: base64Data } })}\n\n`);
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
      } else if (isResearch) {
        // RESEARCH MODE: Separate block with API Key instance
        const researchAI = getAI();

        let fullResponseText = "";

        const result = await researchAI.models.generateContentStream({
          model: "gemini-3-pro-preview",
          contents,
          config: {
            tools: [
              { googleSearch: {} },
              { urlContext: {} },
              { codeExecution: {} }
            ],
            thinkingConfig: {
              includeThoughts: true,
              thinkingLevel: ThinkingLevel.HIGH
            },
            temperature: 1.0,
            topP: 0.95,
            maxOutputTokens: 65536,
            systemInstruction: RESEARCH_SYSTEM_PROMPT,
          }
        });

        let sentMetadata = false;

        for await (const chunk of result) {
          const candidates = (chunk as any).candidates;
          if (candidates && candidates.length > 0) {
            const parts = candidates[0].content?.parts;
            if (parts) {
              for (const part of parts) {
                // Thinking
                const isThought = (part as any).thought === true;
                if (isThought && part.text) {
                  res.write(`data: ${JSON.stringify({ thinking: part.text })}\n\n`);
                  if ((res as any).flush) (res as any).flush();
                } else if (part.text) {
                  fullResponseText += part.text;
                  res.write(`data: ${JSON.stringify({ text: part.text })}\n\n`);
                  if ((res as any).flush) (res as any).flush();
                }
              }
            }
          } else {
            const text = chunk.text;
            if (text) {
              fullResponseText += text;
              res.write(`data: ${JSON.stringify({ text })}\n\n`);
              if ((res as any).flush) (res as any).flush();
            }
          }

          // Grounding metadata (sources)
          let metadata = (chunk as any).groundingMetadata;
          if (!metadata) {
            metadata = (chunk as any).candidates?.[0]?.groundingMetadata;
          }
          if (metadata && !sentMetadata) {
            if (metadata.groundingChunks) {
              const sources = metadata.groundingChunks
                .map((c: { web?: { title?: string; uri: string } }) => {
                  if (c.web) {
                    return { title: c.web.title || "Web Source", url: c.web.uri };
                  }
                  return null;
                })
                .filter((s: { title: string; url: string } | null): s is { title: string; url: string } => s !== null);

              if (sources.length > 0) {
                res.write(`data: ${JSON.stringify({ sources })}\n\n`);
                if ((res as any).flush) (res as any).flush();
                sentMetadata = true;
              }
            }
          }

          if ((res as any).flush) (res as any).flush();
        }

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        if ((res as any).flush) (res as any).flush();
        res.end();
        return;
      } else if (isProImage) {
        // PRO IMAGE MODEL: Uses handler with thoughtSignature for multi-turn editing
        const proImageAI = getAI();
        const proImageContents = await buildProImageContents(history || [], newMessage || "", attachments || []);
        await handleProImageStream(proImageAI, proImageContents, res);
        res.end();
        return;
      } else {
        // Regular chat streaming with Google Search & Thinking

        // Configure model-specific settings
        let modelConfig;

        if (isFlash) {
          // Gemini 3 Flash (thinkingLevel options: MINIMAL, LOW, MEDIUM, HIGH)
          modelConfig = {
            tools: [{ googleSearch: {} }, { codeExecution: {} }, { urlContext: {} }],
            thinkingConfig: { includeThoughts: true, thinkingLevel: ThinkingLevel.HIGH },
            temperature: 1.0,
            topP: 0.95,
            maxOutputTokens: 64000,
            systemInstruction: systemInstruction,
          };
        } else if (isPro) {
          // Gemini 3 Pro Preview
          modelConfig = {
            tools: [{ googleSearch: {} }, { codeExecution: {} }, { urlContext: {} }],
            thinkingConfig: { includeThoughts: true, thinkingLevel: ThinkingLevel.LOW },
            temperature: 1.0,
            topP: 0.95,
            maxOutputTokens: 65536,
            systemInstruction: systemInstruction,
          };
        } else if (isPro25) {
          // Gemini 2.5 Pro
          modelConfig = {
            tools: [{ googleSearch: {} }, { codeExecution: {} }, { urlContext: {} }],
            thinkingConfig: { includeThoughts: true, thinkingBudget: 4096 },
            temperature: 0.6,
            topP: 0.95,
            maxOutputTokens: 65536,
            systemInstruction: systemInstruction,
          };
        }

        console.log(`[DEBUG] Model: ${selectedModelId}, isPro: ${isPro}, isPro25: ${isPro25}, isFlash: ${isFlash}`);

        // All chat models use API Key
        const chatAI = getAI();

        const result = await chatAI.models.generateContentStream({
          model: selectedModelId || "gemini-3-flash-preview",
          contents,
          config: modelConfig,
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
                        console.log(`[DEBUG] CODE EXECUTION - hidden from user`);
                        // Code is NEVER sent to client - only images from results
                    }
                    if ((part as any).codeExecutionResult) {
                        const output = (part as any).codeExecutionResult.output || '';
                        console.log(`[DEBUG] CODE RESULT - checking for images`);

                        // Only send images to client - hide everything else
                        const base64ImageRegex = /data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=]+)/;
                        const imageMatch = output.match(base64ImageRegex);
                        if (imageMatch) {
                            const mimeType = `image/${imageMatch[1]}`;
                            const base64Data = imageMatch[2];
                            res.write(`data: ${JSON.stringify({ image: { mimeType, data: base64Data } })}\n\n`);
                            if ((res as any).flush) (res as any).flush();
                        }
                        // Text output and errors are hidden - only images shown
                    }

                    // Handle inline images from code execution (matplotlib graphs, etc.)
                    if ((part as any).inlineData) {
                        console.log(`[DEBUG] INLINE DATA (graph):`, (part as any).inlineData.mimeType);
                        const inlineData = (part as any).inlineData;
                        const mimeType = inlineData.mimeType || 'image/png';
                        const base64Data = inlineData.data;
                        // Send as GRAPH event (separate from image-agent images)
                        res.write(`data: ${JSON.stringify({
                            graph: { mimeType, data: base64Data }
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
                 .map((c: { web?: { title?: string; uri: string } }) => {
                    if (c.web) {
                        return { title: c.web.title || "Web Source", url: c.web.uri };
                    }
                    return null;
                 })
                 .filter((s: { title: string; url: string } | null): s is { title: string; url: string } => s !== null);

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
        if (suggestionsEnabled && fullResponseText.trim().length > 1500) {
            try {
                console.log("[Suggestions] Generating...");
                // Suggestions use API Key
                const suggestionsAI = getAI();
                const suggestionResp = await suggestionsAI.models.generateContent({
                    model: "gemini-2.5-flash-lite",
                    contents: [{
                        role: "user",
                        parts: [{
                            text: `
                                ${SUGGESTION_PROMPT}

                                Context - AI Response:
                                "${fullResponseText}"
                            `
                        }]
                    }],
                    config: {
                        responseMimeType: 'application/json',
                        temperature: 0.7,
                        maxOutputTokens: 150
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
    } catch (error: unknown) {
      console.error("Stream chat error:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to generate response";
      res.write(
        `data: ${JSON.stringify({ error: errorMessage })}\n\n`
      );
      if ((res as any).flush) (res as any).flush();
      res.end();
    }
  });

/**
 * Unified Upload: Parallel upload to Firebase Storage + Google AI File API
 * Removes 10MB inlineData limit by using File API
 */
export const unifiedUpload = onRequest(
  {
    cors: true,
    secrets: ["GEMINI_API_KEY"],
    memory: "1GiB",
    timeoutSeconds: 540,
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
      const { fileName, mimeType, fileBufferBase64 } = req.body;

      if (!fileName || !mimeType || !fileBufferBase64) {
        res.status(400).json({ error: "Missing required fields: fileName, mimeType, fileBufferBase64" });
        return;
      }

      // Sanitize filename FIRST - Google AI SDK uses file path in HTTP headers (must be ASCII)
      const timestamp = Date.now();
      const sanitizedFileName = `${timestamp}_${fileName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')  // Remove diacritics
        .replace(/[^\x00-\x7F]/g, '_')}`; // Replace remaining non-ASCII with underscore

      // Decode base64 to buffer and write to temp file (use sanitized name!)
      const buffer = Buffer.from(fileBufferBase64, 'base64');
      const tempPath = `/tmp/${sanitizedFileName}`;
      fs.writeFileSync(tempPath, buffer);

      const ai = getAI();
      const bucket = admin.storage().bucket();

      // PARALLEL UPLOAD: Firebase Storage (for UI) + Google AI File API (for Gemini)
      const [fbUploadResult, aiUploadResult] = await Promise.all([
        // Firebase Storage upload (keeps original fileName - Firebase supports UTF-8)
        bucket.upload(tempPath, {
          destination: `attachments/${timestamp}_${fileName}`,
          metadata: { contentType: mimeType }
        }),
        // Google AI File API upload using @google/genai SDK
        ai.files.upload({
          file: tempPath,
          config: {
            mimeType: getFileApiMimeType(mimeType),
            displayName: sanitizedFileName,
          }
        })
      ]);

      // Generate signed URL for Firebase Storage (permanent access)
      const [storageUrl] = await fbUploadResult[0].getSignedUrl({
        action: 'read',
        expires: '03-01-2500'
      });

      // Cleanup temp file
      fs.unlinkSync(tempPath);

      console.log(`[UnifiedUpload] Success: ${fileName} | storageUrl: ${storageUrl.substring(0, 50)}... | fileUri: ${aiUploadResult.uri}`);

      res.json({
        storageUrl,
        fileUri: aiUploadResult.uri
      });

    } catch (error: unknown) {
      console.error("[UnifiedUpload] Error:", error);
      const errorMessage = error instanceof Error ? error.message : "Upload failed";
      res.status(500).json({ error: errorMessage });
    }
  }
);
