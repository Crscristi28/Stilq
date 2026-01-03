/**
 * Universal image utilities for all image-generating models
 * Used by: Pro Image, Flash 2.5 Image (future)
 *
 * Uses @google/genai SDK (NOT @google/generative-ai)
 */

import * as admin from "firebase-admin";
import * as fs from "fs";
import { GoogleGenAI } from "@google/genai";

// Get image dimensions from base64 (PNG/JPEG/WebP)
export const getImageDimensions = (base64: string): { width: number; height: number } | null => {
    try {
        const buffer = Buffer.from(base64, 'base64');
        // PNG
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
            return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
        }
        // JPEG
        if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
            let offset = 2;
            while (offset < buffer.length - 9) {
                if (buffer[offset] === 0xFF) {
                    const marker = buffer[offset + 1];
                    if (marker === 0xC0 || marker === 0xC2) {
                        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
                    }
                    offset += 2 + buffer.readUInt16BE(offset + 2);
                } else {
                    offset++;
                }
            }
        }
        // WebP (RIFF header)
        if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
            if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38) {
                // VP8 lossy
                if (buffer[15] === 0x20) {
                    const width = buffer.readUInt16LE(26) & 0x3FFF;
                    const height = buffer.readUInt16LE(28) & 0x3FFF;
                    return { width, height };
                }
                // VP8L lossless
                if (buffer[15] === 0x4C) {
                    const bits = buffer.readUInt32LE(21);
                    const width = (bits & 0x3FFF) + 1;
                    const height = ((bits >> 14) & 0x3FFF) + 1;
                    return { width, height };
                }
            }
        }
        return null;
    } catch {
        return null;
    }
};

// Calculate aspect ratio from dimensions
export const calculateAspectRatio = (width: number, height: number): string => {
    const ratio = width / height;
    if (Math.abs(ratio - 1) < 0.1) return '1:1';
    if (Math.abs(ratio - 16/9) < 0.1) return '16:9';
    if (Math.abs(ratio - 9/16) < 0.1) return '9:16';
    if (Math.abs(ratio - 4/3) < 0.1) return '4:3';
    if (Math.abs(ratio - 3/4) < 0.1) return '3:4';
    if (Math.abs(ratio - 3/2) < 0.1) return '3:2';
    if (Math.abs(ratio - 2/3) < 0.1) return '2:3';
    if (ratio > 1) return '16:9';
    return '9:16';
};

// Detect aspect ratio from base64 image
export const detectAspectRatio = (base64: string): string => {
    const dims = getImageDimensions(base64);
    if (dims) {
        return calculateAspectRatio(dims.width, dims.height);
    }
    return '1:1';
};

// Fetch image from URL and return as base64
export const fetchImageAsBase64 = async (url: string): Promise<{ base64: string; mimeType: string } | null> => {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const mimeType = response.headers.get('content-type') || 'image/png';
        return { base64, mimeType };
    } catch (e) {
        console.error(`[IMAGE UTILS] Failed to fetch image:`, e);
        return null;
    }
};

// Upload image to Firebase Storage and return signed URL
export const uploadToStorage = async (
    base64Data: string,
    mimeType: string,
    userId?: string
): Promise<string> => {
    const bucket = admin.storage().bucket();
    const extension = mimeType.split('/')[1] || 'png';
    const basePath = userId ? `users/${userId}/generated` : 'generated';
    const fileName = `${basePath}/${Date.now()}.${extension}`;
    const tempPath = `/tmp/${Date.now()}.${extension}`;

    // Write to temp file
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(tempPath, buffer);

    // Upload to Firebase Storage
    await bucket.upload(tempPath, {
        destination: fileName,
        metadata: { contentType: mimeType }
    });

    // Get signed URL
    const [storageUrl] = await bucket.file(fileName).getSignedUrl({
        action: 'read',
        expires: '03-01-2500'
    });

    // Cleanup
    fs.unlinkSync(tempPath);

    return storageUrl;
};

// Upload image to Google AI File API using @google/genai SDK
export const uploadToFileApi = async (
    ai: GoogleGenAI,
    base64Data: string,
    mimeType: string
): Promise<string> => {
    const extension = mimeType.split('/')[1] || 'png';
    const fileName = `generated_${Date.now()}.${extension}`;
    const tempPath = `/tmp/${fileName}`;

    // Write to temp file
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(tempPath, buffer);

    // Upload using new @google/genai SDK
    const uploadResult = await ai.files.upload({
        file: tempPath,
        config: {
            mimeType,
            displayName: fileName,
        }
    });

    // Cleanup
    fs.unlinkSync(tempPath);

    return uploadResult.uri!;
};

// Dual upload: Firebase Storage + File API (for multi-turn)
export const dualUpload = async (
    ai: GoogleGenAI,
    base64Data: string,
    mimeType: string,
    userId?: string
): Promise<{ storageUrl: string; fileUri: string }> => {
    const extension = mimeType.split('/')[1] || 'png';
    const fileName = `generated_${Date.now()}.${extension}`;
    const basePath = userId ? `users/${userId}/generated` : 'generated';
    const tempPath = `/tmp/${fileName}`;

    // Write to temp file once
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(tempPath, buffer);

    const bucket = admin.storage().bucket();

    // Parallel upload: Firebase Storage + Google AI File API
    const [fbResult, aiResult] = await Promise.all([
        bucket.upload(tempPath, {
            destination: `${basePath}/${fileName}`,
            metadata: { contentType: mimeType }
        }),
        ai.files.upload({
            file: tempPath,
            config: {
                mimeType,
                displayName: fileName,
            }
        })
    ]);

    // Get signed URL
    const [storageUrl] = await fbResult[0].getSignedUrl({
        action: 'read',
        expires: '03-01-2500'
    });

    // Cleanup
    fs.unlinkSync(tempPath);

    return { storageUrl, fileUri: aiResult.uri! };
};
