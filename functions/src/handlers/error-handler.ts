/**
 * Error Handler - Centralized error handling & retry logic
 *
 * Features:
 * - Empty response retry (Flash -> Pro fallback)
 * - Future: 429, 500, offline, 404, 400 handling
 */

import { GoogleGenAI, Content, ThinkingLevel } from "@google/genai";
import { Response } from "express";

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

    try {
        const result = await ai.models.generateContentStream({
            model,
            contents,
            config,
        });

        for await (const chunk of result) {
            const candidates = (chunk as any).candidates;
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
                            console.log(`[GRAPH] Received inline image: ${(part as any).inlineData.mimeType}`);
                            const inlineData = (part as any).inlineData;
                            res.write(`data: ${JSON.stringify({ graph: { mimeType: inlineData.mimeType || 'image/png', data: inlineData.data } })}\n\n`);
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

        return { text: fullText, success: true };
    } catch (error) {
        console.error(`[STREAM ERROR] ${model}:`, error);
        return { text: fullText, success: false };
    }
}

/**
 * Retry with Pro model when Flash returns empty
 */
export async function retryWithPro(
    ai: GoogleGenAI,
    contents: Content[],
    systemInstruction: string,
    res: Response
): Promise<StreamResult> {
    console.log(`[RETRY] Flash returned empty, switching to Pro...`);
    res.write(`data: ${JSON.stringify({ retry: true, model: "gemini-3-pro-preview" })}\n\n`);
    if ((res as any).flush) (res as any).flush();

    const proConfig = {
        tools: [{ googleSearch: {} }, { codeExecution: {} }, { urlContext: {} }],
        thinkingConfig: { includeThoughts: true, thinkingLevel: ThinkingLevel.LOW },
        temperature: 1.0,
        topP: 0.95,
        maxOutputTokens: 65536,
        systemInstruction,
    };

    return streamWithRetry(ai, "gemini-3-pro-preview", contents, proConfig, res);
}

// Future error handlers:
// export function handle429(res: Response) { ... }
// export function handle500(res: Response) { ... }
// export function handleOffline(res: Response) { ... }
