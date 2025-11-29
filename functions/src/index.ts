import { onRequest } from "firebase-functions/v2/https";
import { GoogleGenAI } from "@google/genai";
import * as admin from "firebase-admin";
import { SUGGESTION_PROMPT } from "./prompts/suggestion";

admin.initializeApp();

// =============================================================================
// VERTEX AI CONFIGURATION
// =============================================================================
const VERTEX_PROJECT = "elenor-57bde";
const VERTEX_LOCATION = "global"; // Required for Gemini 3 Pro Preview

/**
 * Initialize Gemini with Vertex AI
 * Uses Application Default Credentials (ADC) from Cloud Functions service account
 * apiVersion: 'v1beta' required for multi-tool support (googleSearch + codeExecution + urlContext)
 */
const getAI = () => {
  return new GoogleGenAI({
    vertexai: true,
    project: VERTEX_PROJECT,
    location: VERTEX_LOCATION,
    apiVersion: 'v1beta', // Required for multi-tool support
  });
};

// =============================================================================
// TYPES
// =============================================================================
interface ContentPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  executableCode?: { language?: string; code: string };
  codeExecutionResult?: { outcome?: string; output: string };
  inlineData?: { mimeType: string; data: string };
}

interface HistoryMessage {
  role: 'user' | 'model';
  text: string;
  thoughtSignature?: string; // Store thought signature for multi-turn
}

// =============================================================================
// MAIN STREAMING ENDPOINT
// =============================================================================
/**
 * Main chat streaming endpoint with SSE (v2)
 * Handles both regular chat and image generation + Auto-Suggestions
 *
 * Gemini 3 Pro Features:
 * - Multi-tool support: googleSearch + codeExecution + urlContext
 * - Thought signatures for reasoning continuity
 * - thinkingLevel parameter (replaces thinkingBudget)
 */
export const streamChat = onRequest(
  {
    timeoutSeconds: 540,
    memory: "512MiB",
    cors: true,
    // Vertex AI uses ADC (Application Default Credentials) from Cloud Functions service account
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

      // Prepare message parts for current user message
      const userParts: ContentPart[] = [];

      if (attachments && attachments.length > 0) {
        attachments.forEach((att: any) => {
          userParts.push({
            inlineData: {
              mimeType: att.mimeType,
              data: att.data,
            },
          });
        });
      }

      if (newMessage && newMessage.trim()) {
        userParts.push({ text: newMessage });
      }

      // =======================================================================
      // BUILD CONTENTS WITH THOUGHT SIGNATURES
      // For Gemini 3 Pro, thought signatures must be preserved across turns
      // =======================================================================
      const contents: any[] = [];

      if (history && history.length > 0) {
        for (const msg of history as HistoryMessage[]) {
          const msgParts: any[] = [{ text: msg.text }];

          // Include thought signature if present (required for Gemini 3 Pro multi-turn)
          if (msg.thoughtSignature) {
            msgParts.push({ thoughtSignature: msg.thoughtSignature });
          }

          contents.push({
            role: msg.role,
            parts: msgParts,
          });
        }
      }

      // Add current user message
      contents.push({ role: "user", parts: userParts });

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
      const isPro = modelId === "gemini-3-pro-preview";

      // Thinking Config: Enable for Flash/Pro, Disable for Lite/Image
      const isThinkingCapable = !isLite && !isImageGen;

      // Track full response text for suggestions
      let fullResponseText = "";
      // Track thought signature for client to store (for multi-turn)
      let lastThoughtSignature: string | undefined;

      if (isImageGen) {
        // =====================================================================
        // IMAGE GENERATION (non-streaming)
        // =====================================================================
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
          if ((res as any).flush) (res as any).flush();
        }
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        if ((res as any).flush) (res as any).flush();
        res.end();
        return;
      } else {
        // =====================================================================
        // REGULAR CHAT STREAMING WITH TOOLS & THINKING
        // =====================================================================

        // Configure Thinking based on model type
        let thinkingConfig: any = undefined;

        if (isThinkingCapable) {
          if (isPro) {
            // Gemini 3 Pro: uses thinkingLevel (not thinkingBudget!)
            // "low" for fast responses, "high" for complex reasoning
            thinkingConfig = {
              includeThoughts: true,
              thinkingLevel: "low"
            };
          } else {
            // Gemini 2.5 Flash: uses thinkingBudget
            thinkingConfig = {
              includeThoughts: true,
              thinkingBudget: -1 // dynamic
            };
          }
        }

        // =====================================================================
        // CONFIGURE TOOLS BASED ON MODEL
        // Gemini 3 Pro: supports multi-tool (googleSearch + codeExecution + urlContext)
        // Gemini 2.5 Flash: only googleSearch
        // =====================================================================
        const tools: any[] = isPro
          ? [
              { googleSearch: {} },
              { codeExecution: {} },
              { urlContext: {} }
            ]
          : [{ googleSearch: {} }];

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
          const candidates = (chunk as any).candidates;

          if (candidates && candidates.length > 0) {
            const candidate = candidates[0];
            const parts = candidate.content?.parts as ContentPart[] | undefined;

            if (parts) {
              for (const part of parts) {
                // ---------------------------------------------------------
                // THOUGHT SIGNATURE: Capture for multi-turn continuity
                // Required for Gemini 3 Pro with tools
                // ---------------------------------------------------------
                if (part.thoughtSignature) {
                  lastThoughtSignature = part.thoughtSignature;
                }

                // ---------------------------------------------------------
                // THINKING/REASONING: Model's internal thought process
                // ---------------------------------------------------------
                if (part.thought === true && part.text) {
                  res.write(`data: ${JSON.stringify({ thinking: part.text })}\n\n`);
                  if ((res as any).flush) (res as any).flush();
                }
                // ---------------------------------------------------------
                // CODE EXECUTION: Python code generated and executed
                // ---------------------------------------------------------
                else if (part.executableCode) {
                  const codeBlock = `\n\`\`\`${part.executableCode.language || 'python'}\n${part.executableCode.code}\n\`\`\`\n`;
                  fullResponseText += codeBlock;
                  res.write(`data: ${JSON.stringify({ text: codeBlock })}\n\n`);
                  if ((res as any).flush) (res as any).flush();
                }
                // ---------------------------------------------------------
                // CODE EXECUTION RESULT: Output from executed code
                // ---------------------------------------------------------
                else if (part.codeExecutionResult) {
                  const resultBlock = `\n**Code Output:**\n\`\`\`\n${part.codeExecutionResult.output}\n\`\`\`\n`;
                  fullResponseText += resultBlock;
                  res.write(`data: ${JSON.stringify({ text: resultBlock })}\n\n`);
                  if ((res as any).flush) (res as any).flush();
                }
                // ---------------------------------------------------------
                // REGULAR TEXT
                // ---------------------------------------------------------
                else if (part.text) {
                  fullResponseText += part.text;
                  res.write(`data: ${JSON.stringify({ text: part.text })}\n\n`);
                  if ((res as any).flush) (res as any).flush();
                }
              }
            }

            // ---------------------------------------------------------
            // GROUNDING METADATA (Sources from Google Search)
            // ---------------------------------------------------------
            let metadata = (chunk as any).groundingMetadata;
            if (!metadata) {
              metadata = candidate.groundingMetadata;
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
          } else {
            // Fallback for simple text chunks
            const text = (chunk as any).text;
            if (text) {
              fullResponseText += text;
              res.write(`data: ${JSON.stringify({ text })}\n\n`);
              if ((res as any).flush) (res as any).flush();
            }
          }

          // Force flush
          if ((res as any).flush) (res as any).flush();
          if ((res.socket as any)?.uncork) (res.socket as any).uncork();
        }

        // =====================================================================
        // SEND THOUGHT SIGNATURE TO CLIENT (for multi-turn storage)
        // Client should store this and send it back in history for next request
        // =====================================================================
        if (lastThoughtSignature) {
          res.write(`data: ${JSON.stringify({ thoughtSignature: lastThoughtSignature })}\n\n`);
          if ((res as any).flush) (res as any).flush();
        }

        // =====================================================================
        // SUGGESTION GENERATION (Server-Side Pipeline)
        // =====================================================================
        const suggestionsEnabled = settings?.showSuggestions !== false;

        console.log(`[Suggestions] Enabled: ${suggestionsEnabled}, Length: ${fullResponseText.trim().length}`);

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
              // CLEANUP: Remove markdown blocks if present
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
  }
);
