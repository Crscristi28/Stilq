# Pro Image Model Implementation Guide

## Model: `gemini-3-pro-image-preview`

> **SDK**: `@google/genai` v1.34.0 (NOT `@google/generative-ai`)

---

## Table of Contents
1. [Overview](#overview)
2. [The thoughtSignature Hack](#the-thoughtsignature-hack)
3. [inlineData vs fileData](#inlinedata-vs-filedata)
4. [History Image Handling](#history-image-handling)
5. [User Attachment Handling](#user-attachment-handling)
6. [Dual Upload Pattern](#dual-upload-pattern)
7. [Model Limits](#model-limits)
8. [Code Reference](#code-reference)

---

## Overview

The `gemini-3-pro-image-preview` model supports:
- Native text + image generation
- Multi-turn image editing (edit previously generated images)
- Google Search grounding
- Up to 14 images per prompt

**Key Challenge**: Multi-turn editing requires special handling with `thoughtSignature`.

---

## The thoughtSignature Hack

### Problem
Multi-turn image editing (editing previously generated images) **does not work** by default. The API rejects history that contains model-generated content without proper signing.

### Solution
Add `thoughtSignature: "skip_thought_signature_validator"` to ALL model parts:

```typescript
// For model text parts
msgParts.push({
    text: msg.text || "",
    thoughtSignature: "skip_thought_signature_validator"
} as Part);

// For model image parts (history)
msgParts.push({
    inlineData: { mimeType: imageData.mimeType, data: imageData.base64 },
    thoughtSignature: "skip_thought_signature_validator"
} as Part);
```

### Critical Rules
1. `thoughtSignature` ONLY works with `inlineData`
2. `thoughtSignature` does NOT work with `fileData`
3. ALL model parts (text + images) need thoughtSignature
4. User parts do NOT need thoughtSignature

---

## inlineData vs fileData

### inlineData
- Raw base64 embedded directly in the request
- **Works with thoughtSignature**
- Use for: History images (fetched from storage)
- Larger request payload

```typescript
{
    inlineData: {
        mimeType: "image/png",
        data: "base64string..."
    },
    thoughtSignature: "skip_thought_signature_validator"
}
```

### fileData
- Reference to File API via URI
- **Does NOT work with thoughtSignature**
- Use for: Current user attachments
- Smaller request payload

```typescript
{
    fileData: {
        mimeType: "image/png",
        fileUri: "https://generativelanguage.googleapis.com/..."
    }
}
```

---

## History Image Handling

### Flow
1. History contains `imageUrls` (Firebase Storage signed URLs)
2. Fetch each image → convert to base64
3. Embed as `inlineData` with `thoughtSignature`

### Code Pattern

```typescript
// Fetch and add images from history as inlineData
if (msg.imageUrls && msg.imageUrls.length > 0) {
    for (const url of msg.imageUrls) {
        const imageData = await fetchImageAsBase64(url);
        if (imageData) {
            // ALL parts need thoughtSignature for multi-turn to work
            msgParts.push({
                inlineData: {
                    mimeType: imageData.mimeType,
                    data: imageData.base64
                },
                thoughtSignature: "skip_thought_signature_validator"
            } as Part);
        }
    }
}

// Add text part (with signature for model)
if (msg.role === 'model') {
    msgParts.push({
        text: msg.text || "",
        thoughtSignature: "skip_thought_signature_validator"
    } as Part);
} else if (msg.text && msg.text.trim()) {
    msgParts.push({ text: msg.text });
}
```

### fetchImageAsBase64 Utility

```typescript
export const fetchImageAsBase64 = async (
    url: string
): Promise<{ base64: string; mimeType: string } | null> => {
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
```

---

## User Attachment Handling

### Rule
**NEVER use inlineData for user uploads** - large files would crash the app.

### Flow
1. Frontend uploads via unified upload (gets `fileUri`)
2. Backend uses `fileData` with `fileUri` reference
3. No thoughtSignature needed for user parts

### Code Pattern

```typescript
// Add attachments using fileData (fileUri from unified upload)
// NEVER use inlineData for user uploads - large files would crash the app
if (attachments && attachments.length > 0) {
    for (const att of attachments) {
        if (att.mimeType?.startsWith('image/') && att.fileUri) {
            userParts.push({
                fileData: {
                    mimeType: att.mimeType,
                    fileUri: att.fileUri
                }
            });
        }
    }
}
```

---

## Dual Upload Pattern

When Pro Image generates an image, we upload to **both**:
1. **Firebase Storage** - for UI display (signed URL)
2. **Google AI File API** - for future multi-turn editing (fileUri)

### Why Both?
- `storageUrl`: Reliable for frontend display, never expires
- `fileUri`: Required if user switches away and comes back

### Code Pattern

```typescript
export const dualUpload = async (
    ai: GoogleGenAI,
    base64Data: string,
    mimeType: string
): Promise<{ storageUrl: string; fileUri: string }> => {
    const extension = mimeType.split('/')[1] || 'png';
    const fileName = `generated_${Date.now()}.${extension}`;
    const tempPath = `/tmp/${fileName}`;

    // Write to temp file once
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(tempPath, buffer);

    const bucket = admin.storage().bucket();

    // Parallel upload: Firebase Storage + Google AI File API
    const [fbResult, aiResult] = await Promise.all([
        bucket.upload(tempPath, {
            destination: `generated/${fileName}`,
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
```

### Usage in Stream Handler

```typescript
if ((part as any).inlineData && !isThought) {
    const inlineData = (part as any).inlineData;
    const mimeType = inlineData.mimeType || 'image/png';
    const base64Data = inlineData.data;

    // Detect aspect ratio
    const aspectRatio = detectAspectRatio(base64Data);

    try {
        // Dual upload for multi-turn history
        const { storageUrl, fileUri } = await dualUpload(ai, base64Data, mimeType);

        // Send image with both URLs + aspectRatio
        res.write(`data: ${JSON.stringify({
            image: { mimeType, data: base64Data, storageUrl, fileUri, aspectRatio }
        })}\n\n`);
    } catch (uploadError) {
        // Fallback: send just base64 + aspectRatio
        res.write(`data: ${JSON.stringify({
            image: { mimeType, data: base64Data, aspectRatio }
        })}\n\n`);
    }
}
```

---

## Model Limits

| Limit | Value |
|-------|-------|
| Max images per prompt | 14 |
| Max objects per image | 6 |
| Max humans per image | 5 |
| Max image size | 7 MB per input |
| Context window (input) | 1M tokens |
| Context window (output) | 64K tokens |
| Image tokenization | 258 tokens per 768x768 tile |

### Recommended Limits for History
- **Text history**: Last 10 messages
- **Image history**: Last 6 images (safe margin below 14)

---

## Code Reference

### File Structure

```
functions/src/
├── handlers/
│   └── pro-image.ts      # Pro Image handler
├── utils/
│   └── image.ts          # Image utilities (dualUpload, fetchImageAsBase64)
├── prompts/
│   └── pro-image.ts      # System prompt
└── index.ts              # Main endpoint (routes to Pro Image)
```

### Key Functions

| Function | File | Purpose |
|----------|------|---------|
| `buildProImageContents` | handlers/pro-image.ts | Build contents with thoughtSignature |
| `handleProImageStream` | handlers/pro-image.ts | Handle streaming response |
| `fetchImageAsBase64` | utils/image.ts | Fetch URL → base64 |
| `dualUpload` | utils/image.ts | Upload to Storage + File API |
| `detectAspectRatio` | utils/image.ts | Get aspect ratio from base64 |

### Types

```typescript
interface HistoryMessage {
    role: 'user' | 'model';
    text: string;
    imageUrls?: string[];  // Firebase Storage signed URLs
}

interface ChatAttachment {
    mimeType: string;
    data: string;
    name?: string;
    storageUrl?: string;   // Firebase Storage URL
    fileUri?: string;      // Google AI File API URI
}
```

---

## Summary Table

| Scenario | Data Type | thoughtSignature | Source |
|----------|-----------|------------------|--------|
| History model text | text | YES | msg.text |
| History model image | inlineData | YES | fetch from storageUrl |
| History user text | text | NO | msg.text |
| Current user attachment | fileData | NO | fileUri from upload |
| Generated image output | inlineData | N/A | model response |

---

## Debugging Tips

1. **Check logs for part types**:
   ```
   [PRO IMAGE BUILD] Content[0] role=user parts=[text] hasSignature=false
   [PRO IMAGE BUILD] Content[1] role=model parts=[inlineData, text] hasSignature=true
   ```

2. **Verify thoughtSignature is present** for all model parts

3. **Never mix inlineData and fileData** for the same purpose

4. **Monitor image count** - stay below 14 total

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-12-29 | Initial implementation with thoughtSignature hack |

---

*Documentation generated: 2025-12-29*
