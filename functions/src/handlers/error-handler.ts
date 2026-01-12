/**
 * Error Handler - Centralized error handling & retry logic
 *
 * Features:
 * - Empty response retry (Flash -> Pro fallback)
 * - Future: 429, 500, offline, 404, 400 handling
 */

import { GoogleGenAI, Content } from "@google/genai";
import { Response } from "express";
import { detectAspectRatio } from "../utils/image";

interface StreamResult {
    text: string;
    success: boolean;
}

/**
 * Streams a chat response and handles chunks
 * Returns accumulated text for retry decision
 */
export async function streamWithRetry(
    ai: GoogleGenAI,
    model: string,
    contents: Content[],
    config: any,
    res: Response
): Promise<StreamResult> {
    let fullText = "";
    let sentMetadata = false;
    let chunkCount = 0;

    try {
        console.log(`[STREAM START] Model: ${model}`);
        const result = await ai.models.generateContentStream({
            model,
            contents,
            config,
        });

        for await (const chunk of result) {
            chunkCount++;
            const candidates = (chunk as any).candidates;

            // Check for promptFeedback (model blocked before generating)
            const promptFeedback = (chunk as any).promptFeedback;
            if (promptFeedback) {
                console.log(`[PROMPT FEEDBACK] blockReason: ${promptFeedback.blockReason || 'none'}`);
                if (promptFeedback.safetyRatings) {
                    console.log(`[SAFETY RATINGS]`, JSON.stringify(promptFeedback.safetyRatings, null, 2));
                }
                if (promptFeedback.blockReasonMessage) {
                    console.log(`[BLOCK MESSAGE] ${promptFeedback.blockReasonMessage}`);
                }
            }

            // Log chunk details for debugging
            if (candidates && candidates.length > 0) {
                const finishReason = candidates[0].finishReason;
                if (finishReason) {
                    console.log(`[STREAM CHUNK ${chunkCount}] finishReason: ${finishReason}`);
                }
            } else {
                // No candidates - log full chunk to see what's wrong
                console.log(`[STREAM CHUNK ${chunkCount}] No candidates - Full chunk:`, JSON.stringify(chunk, null, 2));
            }

            if (candidates && candidates.length > 0) {
                const parts = candidates[0].content?.parts;
                if (parts) {
                    for (const part of parts) {
                        // Code execution logging
                        if ((part as any).executableCode) {
                            console.log(`[CODE] Executing: ${(part as any).executableCode.code?.substring(0, 100)}...`);
                        }

                        // Code execution result with image
                        if ((part as any).codeExecutionResult) {
                            const codeResult = (part as any).codeExecutionResult;
                            console.log(`[CODE] Result outcome: ${codeResult.outcome}, output length: ${codeResult.output?.length || 0}`);

                            const output = codeResult.output || '';
                            const base64ImageRegex = /data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=]+)/;
                            const imageMatch = output.match(base64ImageRegex);
                            if (imageMatch) {
                                res.write(`data: ${JSON.stringify({ image: { mimeType: `image/${imageMatch[1]}`, data: imageMatch[2] } })}\n\n`);
                                if ((res as any).flush) (res as any).flush();
                            }
                        }

                        // Inline images (matplotlib graphs)
                        if ((part as any).inlineData) {
                            const inlineData = (part as any).inlineData;
                            const aspectRatio = detectAspectRatio(inlineData.data);
                            console.log(`[GRAPH] Received inline image: ${inlineData.mimeType} (${aspectRatio})`);
                            res.write(`data: ${JSON.stringify({ graph: { mimeType: inlineData.mimeType || 'image/png', data: inlineData.data, aspectRatio } })}\n\n`);
                            if ((res as any).flush) (res as any).flush();
                        }

                        // Thinking vs regular text
                        const isThought = (part as any).thought === true;
                        if (isThought && part.text) {
                            res.write(`data: ${JSON.stringify({ thinking: part.text })}\n\n`);
                            if ((res as any).flush) (res as any).flush();
                        } else if (part.text) {
                            fullText += part.text;
                            res.write(`data: ${JSON.stringify({ text: part.text })}\n\n`);
                            if ((res as any).flush) (res as any).flush();
                        }
                    }
                }
            } else {
                const text = chunk.text;
                if (text) {
                    fullText += text;
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

        console.log(`[STREAM END] Model: ${model} | Chunks: ${chunkCount} | Text length: ${fullText.length}`);
        return { text: fullText, success: true };
    } catch (error) {
        console.error(`[STREAM ERROR] ${model}:`, error);
        return { text: fullText, success: false };
    }
}

/**
 * Retry with Pro 2.5 model when Flash/Pro 3 returns empty or blocked
 */
async function retryWithPro25(
    ai: GoogleGenAI,
    contents: Content[],
    systemInstruction: string,
    res: Response,
    fromModel: string
): Promise<StreamResult> {
    console.log(`[RETRY] ${fromModel} returned empty/blocked, switching to Pro 2.5...`);
    res.write(`data: ${JSON.stringify({ retry: true, model: "gemini-2.5-pro", from: fromModel })}\n\n`);
    if ((res as any).flush) (res as any).flush();

    const proConfig = {
        tools: [{ googleSearch: {} }, { codeExecution: {} }, { urlContext: {} }],
        thinkingConfig: { includeThoughts: true, thinkingBudget: 4096 },
        temperature: 0.6,
        topP: 0.95,
        maxOutputTokens: 65536,
        systemInstruction,
    };

    return streamWithRetry(ai, "gemini-2.5-pro", contents, proConfig, res);
}

/**
 * Smart streaming with automatic retry for Flash 3 and Pro 3
 * Both models can fail with blockReason: OTHER, so fallback to Pro 2.5
 */
export async function streamChatWithRetry(
    ai: GoogleGenAI,
    model: string,
    contents: Content[],
    config: any,
    res: Response
): Promise<StreamResult> {
    const result = await streamWithRetry(ai, model, contents, config, res);

    // Auto-retry Flash 3 and Pro 3 with Pro 2.5 fallback when they return empty
    if (result.text.trim().length === 0) {
        if (model === "gemini-3-flash-preview" || model === "gemini-3-pro-preview") {
            return retryWithPro25(ai, contents, config.systemInstruction || "", res, model);
        }
    }

    return result;
}

// Future error handlers:
// export function handle429(res: Response) { ... }
// export function handle500(res: Response) { ... }
// export function handleOffline(res: Response) { ... }
