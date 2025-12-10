import { onRequest } from "firebase-functions/v2/https";
import { GoogleGenAI, Part, Content, ThinkingConfig, ThinkingLevel, Type } from "@google/genai";
import * as admin from "firebase-admin";
import { SUGGESTION_PROMPT } from "./prompts/suggestion";
import { ROUTER_PROMPT } from "./prompts/router";
import { FLASH_SYSTEM_PROMPT } from "./prompts/flash";
import { IMAGE_AGENT_SYSTEM_PROMPT } from "./prompts/image-agent";
import { RESEARCH_SYSTEM_PROMPT } from "./prompts/research";

admin.initializeApp();

// --- Request Types ---
interface ChatAttachment {
    mimeType: string;
    data: string;
    name?: string;
    storageUrl?: string;
}

interface HistoryMessage {
    role: 'user' | 'model';
    text: string;
    imageUrls?: string[];
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
    modelId?: 'gemini-2.5-flash' | 'gemini-3-pro-preview' | 'gemini-2.5-pro' | 'gemini-2.5-flash-lite' | 'gemini-2.5-flash-image' | 'auto' | 'image-agent' | 'research';
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

// Vertex AI instance (editImage only - supports HTTP URL in fileUri)
const getVertexAI = () => {
  return new GoogleGenAI({
    vertexai: true,
    project: "elenor-57bde",
    location: "global"
  });
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
    timeoutSeconds: 540,
    memory: "512MiB",
    cors: true,
    secrets: ["GEMINI_API_KEY"],
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
             // Router uses Vertex AI (Flash Lite)
             const routerAI = getVertexAI();
             const decision = await determineModelFromIntent(routerAI, newMessage || "User sent attachment", history || []);
             selectedModelId = decision.targetModel;
             console.log(`[Auto-Router] Routed to ${selectedModelId}. Reason: ${decision.reasoning}`);

             // Inform client of routing decision for UI (e.g., indicators)
             res.write(`data: ${JSON.stringify({ routedModel: selectedModelId })}\n\n`);
             if ((res as any).flush) (res as any).flush();
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

      // Model checks for history limiting (must be before contents)
      const isImageGen = selectedModelId === "gemini-2.5-flash-image";
      const isResearch = selectedModelId === "research";

      // Map 'research' to actual model ID
      if (isResearch) {
          selectedModelId = "gemini-2.5-pro";
      }

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
      const isPro25 = selectedModelId === "gemini-2.5-pro" && !isResearch; // PRO_25 manual selection (isResearch is already checked before model ID mapping)

      // Log model selection for debugging
      console.log(`[MODEL] Selected: ${selectedModelId} | isFlash: ${isFlash} | isPro: ${isPro} | isPro25: ${isPro25} | isResearch: ${isResearch}`);

      // Add model-specific system prompts
      if (isFlash) {
          systemInstruction = systemInstruction
              ? `${FLASH_SYSTEM_PROMPT}\n\n${systemInstruction}`
              : FLASH_SYSTEM_PROMPT;
      }
      // Note: Research has its own block with RESEARCH_SYSTEM_PROMPT

      // Other Model Type Checks
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

        // Image generation uses Vertex AI
        const imageGenAI = getVertexAI();
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
                description: "The Firebase Storage URL of the image to edit"
              },
              prompt: {
                type: Type.STRING,
                description: "Clear instruction describing what changes to make to the image"
              }
            },
            required: ["imageUrl", "prompt"]
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
        const currentImageUrls: string[] = [];
        if (attachments) {
          attachments.forEach(att => {
            if (att.storageUrl && att.mimeType?.startsWith('image/')) {
              currentImageUrls.push(att.storageUrl);
            }
          });
        }

        if (currentImageUrls.length > 0) {
          const urlContext = `\n\n[Images attached to this message:\n${currentImageUrls.map((url, idx) => `${idx + 1}. ${url}`).join('\n')}]`;
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

        // Image agent uses Vertex AI (Flash)
        const imageAgentAI = getVertexAI();
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

              // Call the image model (Vertex AI)
              const generateImageAI = getVertexAI();
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
              const imageUrl = args.imageUrl;
              const editPrompt = args.prompt;

              console.log(`[ImageAgent] Editing image: ${imageUrl}`);

              // Notify frontend that image editing is starting
              res.write(`data: ${JSON.stringify({ generatingImage: true })}\n\n`);
              if ((res as any).flush) (res as any).flush();

              // Call the image model with existing image (Vertex AI for HTTP URL support)
              const vertexAI = getVertexAI();
              const editResponse = await vertexAI.models.generateContent({
                model: "gemini-2.5-flash-image",
                contents: [{
                  role: "user",
                  parts: [
                    { fileData: { fileUri: imageUrl, mimeType: "image/png" } },
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
            } else if (isPro25) {
                // PRO_25 manual selection: standard thinking
                thinkingConfig = {
                    includeThoughts: true,
                    thinkingBudget: 4096
                };
            } else {
                // Gemini 2.5 Flash: uses thinkingBudget
                thinkingConfig = {
                    includeThoughts: true,
                    thinkingBudget: 1024
                };
            }
        }

        // Log thinking config
        console.log(`[THINKING] Config:`, JSON.stringify(thinkingConfig));

        // Configure Tools based on model
        const tools = isPro || isPro25
            ? [
                { googleSearch: {} },
                { codeExecution: {} },
                { urlContext: {} }
              ]
            : [{ googleSearch: {} }];

        console.log(`[DEBUG] Model: ${selectedModelId}, isPro: ${isPro}`);
        console.log(`[DEBUG] Tools config:`, JSON.stringify(tools));
        console.log(`[DEBUG] ThinkingConfig:`, JSON.stringify(thinkingConfig));

        // Pro models use API Key (for code execution), others use Vertex AI
        const chatAI = (isPro || isPro25) ? getAI() : getVertexAI();
        console.log(`[DEBUG] Using: ${(isPro || isPro25) ? 'API Key' : 'Vertex AI'}`);

        const result = await chatAI.models.generateContentStream({
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
                // Suggestions use Vertex AI (Flash Lite)
                const suggestionsAI = getVertexAI();
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
