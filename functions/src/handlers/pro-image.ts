/**
 * Pro Image Handler (gemini-3-pro-image-preview)
 *
 * Key features:
 * - Multi-turn editing with thoughtSignature + inlineData
 * - Native text + image output
 * - Google Search grounding
 * - Dual upload (Storage + File API) for history
 */

import { GoogleGenAI, Part, Content } from "@google/genai";
import { Response } from "express";
import { PRO_IMAGE_SYSTEM_PROMPT } from "../prompts/pro-image";
import { detectAspectRatio, fetchImageAsBase64, dualUpload } from "../utils/image";

// Types
interface HistoryMessage {
    role: 'user' | 'model';
    text: string;
    imageUrls?: string[];
}

interface ChatAttachment {
    mimeType: string;
    data: string;
    name?: string;
    storageUrl?: string;
    fileUri?: string;
}

// Context limits for Pro Image model
const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_IMAGES = 8;

// Build contents with inlineData + thoughtSignature for multi-turn editing
export async function buildProImageContents(
    history: HistoryMessage[],
    newMessage: string,
    attachments: ChatAttachment[]
): Promise<Content[]> {
    console.log(`[PRO IMAGE BUILD] ===== START =====`);
    console.log(`[PRO IMAGE BUILD] History messages: ${history.length}`);
    console.log(`[PRO IMAGE BUILD] New message: "${newMessage.substring(0, 100)}..."`);
    console.log(`[PRO IMAGE BUILD] Attachments: ${attachments.length}`);

    // Limit history to last N messages to avoid context overflow
    const limitedHistory = history.slice(-MAX_HISTORY_MESSAGES);
    console.log(`[PRO IMAGE BUILD] Limited history to ${limitedHistory.length} messages (max ${MAX_HISTORY_MESSAGES})`);

    // Log history details
    limitedHistory.forEach((msg, i) => {
        const imageCount = msg.imageUrls?.length || 0;
        console.log(`[PRO IMAGE BUILD] History[${i}] role=${msg.role} text="${msg.text?.substring(0, 50)}..." images=${imageCount}`);
    });

    // Log attachment details
    attachments.forEach((att, i) => {
        console.log(`[PRO IMAGE BUILD] Attachment[${i}] mime=${att.mimeType} fileUri=${att.fileUri ? 'YES' : 'NO'} storageUrl=${att.storageUrl ? 'YES' : 'NO'}`);
    });

    const contents: Content[] = [];

    // First pass: collect all image URLs from history (newest first)
    const allHistoryImageUrls: { msgIndex: number; url: string }[] = [];
    for (let i = limitedHistory.length - 1; i >= 0; i--) {
        const msg = limitedHistory[i];
        if (msg.imageUrls && msg.imageUrls.length > 0) {
            for (const url of msg.imageUrls) {
                allHistoryImageUrls.push({ msgIndex: i, url });
            }
        }
    }

    // Take only the newest N images
    const allowedImageUrls = new Set(
        allHistoryImageUrls.slice(0, MAX_HISTORY_IMAGES).map(item => item.url)
    );
    console.log(`[PRO IMAGE] Allowing ${allowedImageUrls.size} newest images from history (limit: ${MAX_HISTORY_IMAGES})`);

    // Process history with thoughtSignature for model parts
    for (const msg of limitedHistory) {
        const msgParts: Part[] = [];

        // Fetch and add images from history as inlineData (only allowed newest ones)
        if (msg.imageUrls && msg.imageUrls.length > 0) {
            for (const url of msg.imageUrls) {
                if (!allowedImageUrls.has(url)) {
                    console.log(`[PRO IMAGE] Skipping old image (not in newest ${MAX_HISTORY_IMAGES})`);
                    continue;
                }
                const imageData = await fetchImageAsBase64(url);
                if (imageData) {
                    // ALL parts need thoughtSignature for multi-turn to work
                    msgParts.push({
                        inlineData: { mimeType: imageData.mimeType, data: imageData.base64 },
                        thoughtSignature: "skip_thought_signature_validator"
                    } as Part);
                    console.log(`[PRO IMAGE] Added history image as inlineData for ${msg.role}`);
                }
            }
        }

        // Strip [IMAGE:X] and [GRAPH:X] markers from text before sending to model
        const cleanText = (msg.text || "").replace(/\n?\[(?:IMAGE|GRAPH):\d+\]\n?/g, '').trim();

        // Add text part (with signature for model)
        if (msg.role === 'model') {
            msgParts.push({
                text: cleanText,
                thoughtSignature: "skip_thought_signature_validator"
            } as Part);
        } else if (cleanText) {
            msgParts.push({ text: cleanText });
        }

        // Ensure at least one part exists
        if (msgParts.length === 0) {
            msgParts.push({ text: cleanText });
        }

        contents.push({ role: msg.role, parts: msgParts });
    }

    // Build current user message parts
    const userParts: Part[] = [];

    // Add attachments using fileData (fileUri from unified upload)
    // NEVER use inlineData for user uploads - large files would crash the app
    if (attachments && attachments.length > 0) {
        for (const att of attachments) {
            if (att.mimeType?.startsWith('image/') && att.fileUri) {
                userParts.push({
                    fileData: { mimeType: att.mimeType, fileUri: att.fileUri }
                });
                console.log(`[PRO IMAGE] Added attachment as fileData: ${att.fileUri}`);
            }
        }
    }

    // Add text message
    if (newMessage && newMessage.trim()) {
        userParts.push({ text: newMessage });
    }

    // Ensure at least one part
    if (userParts.length === 0) {
        userParts.push({ text: "" });
    }

    contents.push({ role: "user", parts: userParts });

    // Summary log
    console.log(`[PRO IMAGE BUILD] ===== SUMMARY =====`);
    contents.forEach((c, i) => {
        const partTypes = c.parts?.map(p => {
            if ((p as any).text) return 'text';
            if ((p as any).inlineData) return 'inlineData';
            if ((p as any).fileData) return 'fileData';
            return 'unknown';
        }).join(', ') || 'none';
        const hasSignature = c.parts?.some(p => (p as any).thoughtSignature) || false;
        console.log(`[PRO IMAGE BUILD] Content[${i}] role=${c.role} parts=[${partTypes}] hasSignature=${hasSignature}`);
    });
    console.log(`[PRO IMAGE BUILD] ===== END (${contents.length} items) =====`);

    return contents;
}

// Handle Pro Image streaming response
export async function handleProImageStream(
    ai: GoogleGenAI,
    contents: Content[],
    res: Response,
    userId?: string
): Promise<void> {
    console.log(`[PRO IMAGE] Starting stream...`);

    try {
        const result = await ai.models.generateContentStream({
            model: "gemini-3-pro-image-preview",
            contents,
            config: {
                tools: [{ googleSearch: {} }],
                responseModalities: ['TEXT', 'IMAGE'],
                topP: 0.95,
                maxOutputTokens: 32768,
                systemInstruction: PRO_IMAGE_SYSTEM_PROMPT,
            },
        });

        let sentMetadata = false;

        for await (const chunk of result) {
        if (chunk.candidates && chunk.candidates[0]?.content?.parts) {
            const parts = chunk.candidates[0].content.parts;

            for (const part of parts) {
                // Check for thought (draft) content - skip images in thoughts
                const isThought = (part as any).thought === true;

                // Handle text
                if (part.text) {
                    res.write(`data: ${JSON.stringify({ text: part.text })}\n\n`);
                    if ((res as any).flush) (res as any).flush();
                }

                // Handle native image output (skip draft images in thoughts)
                if ((part as any).inlineData && !isThought) {
                    const inlineData = (part as any).inlineData;
                    const mimeType = inlineData.mimeType || 'image/png';
                    const base64Data = inlineData.data;

                    // Detect aspect ratio
                    const aspectRatio = detectAspectRatio(base64Data);
                    console.log(`[PRO IMAGE] Received image (${aspectRatio}), starting dual upload...`);

                    try {
                        // Dual upload for multi-turn history (ai instance required for File API)
                        const { storageUrl, fileUri } = await dualUpload(ai, base64Data, mimeType, userId);
                        console.log(`[PRO IMAGE] Dual upload success`);

                        // Send image with both URLs + aspectRatio
                        res.write(`data: ${JSON.stringify({
                            image: { mimeType, data: base64Data, storageUrl, fileUri, aspectRatio }
                        })}\n\n`);
                    } catch (uploadError) {
                        console.error(`[PRO IMAGE] Dual upload failed:`, uploadError);
                        // Fallback: send just base64 + aspectRatio
                        res.write(`data: ${JSON.stringify({
                            image: { mimeType, data: base64Data, aspectRatio }
                        })}\n\n`);
                    }
                    if ((res as any).flush) (res as any).flush();
                }
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

        if ((res as any).flush) (res as any).flush();
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    if ((res as any).flush) (res as any).flush();
    console.log(`[PRO IMAGE] Stream complete`);

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[PRO IMAGE] Stream error:`, errorMessage);
        console.error(`[PRO IMAGE] Full error:`, error);
        res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
        if ((res as any).flush) (res as any).flush();
    }
}
