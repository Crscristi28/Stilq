# Upload System Implementation Guide

## Overview

Stilq uses a **Unified Upload** pattern with parallel uploads to two services:

```
┌─────────────┐    ┌──────────────────────┐    ┌─────────────────────┐
│   Frontend  │───▶│  unifiedUpload (CF)  │───▶│  Firebase Storage   │ (storageUrl)
│  InputArea  │    │                      │───▶│  Google AI File API │ (fileUri)
└─────────────┘    └──────────────────────┘    └─────────────────────┘
```

**Key Features:**
- Parallel upload to Firebase Storage + Google AI File API
- Diacritics sanitization (supports Czech, Polish, etc. filenames)
- MIME type normalization for code files
- 20MB file size limit
- Upload-on-select pattern (upload immediately when user selects files)

---

## Table of Contents
1. [Architecture](#architecture)
2. [Frontend: InputArea](#frontend-inputarea)
3. [Backend: unifiedUpload](#backend-unifiedupload)
4. [Diacritics Sanitization](#diacritics-sanitization)
5. [MIME Type Normalization](#mime-type-normalization)
6. [Data Flow](#data-flow)
7. [Types](#types)
8. [Troubleshooting](#troubleshooting)

---

## Architecture

### Why Two Uploads?

| Service | Purpose | Limit |
|---------|---------|-------|
| **Firebase Storage** | UI preview, permanent URL for users | Unlimited |
| **Google AI File API** | Sending to Gemini model via `fileUri` | 2GB per file, expires 48h |

**Problem solved:** Gemini `inlineData` has 10MB limit. Two 5MB images = error. Using `fileUri` removes this limit.

### File Structure

```
components/
└── InputArea.tsx           # Frontend upload handler

functions/src/
└── index.ts                # unifiedUpload Cloud Function

services/
└── geminiService.ts        # fileToBase64 helper
```

---

## Frontend: InputArea

### Upload Flow

1. User selects files
2. Convert to base64 immediately
3. Show files in UI with loading spinner
4. Call `unifiedUpload` Cloud Function
5. Receive `storageUrl` + `fileUri`
6. Update attachment state, remove spinner

### Code Reference

```typescript
// components/InputArea.tsx

const UNIFIED_UPLOAD_URL = 'https://us-central1-elenor-57bde.cloudfunctions.net/unifiedUpload';

const uploadAttachment = async (
  base64Data: string,
  mimeType: string,
  originalName?: string
): Promise<{ storageUrl: string; fileUri: string }> => {
  // Validate size (20MB limit)
  if (base64Data.length > 28 * 1024 * 1024) {
    throw new Error("File too large (max 20MB)");
  }

  const response = await fetch(UNIFIED_UPLOAD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: originalName || `file_${Date.now()}`,
      mimeType,
      fileBufferBase64: base64Data
    })
  });

  const { storageUrl, fileUri } = await response.json();
  return { storageUrl, fileUri };
};
```

### File Selection Handler

```typescript
const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
  if (!user?.uid) {
    alert("Please sign in to upload files");
    return;
  }

  if (e.target.files && e.target.files.length > 0) {
    const filesToProcess = Array.from(e.target.files);
    const startIndex = attachments.length;

    // 1. Convert ALL files to base64 first
    const newAttachments: Attachment[] = [];
    for (const file of filesToProcess) {
      const base64 = await fileToBase64(file);
      newAttachments.push({ mimeType: file.type, data: base64, name: file.name });
    }

    // 2. Add ALL attachments at once (prevents UI flicker)
    setAttachments(prev => [...prev, ...newAttachments]);

    // 3. Mark ALL as uploading (show spinners)
    const uploadingSet = new Set<number>();
    for (let i = 0; i < newAttachments.length; i++) {
      uploadingSet.add(startIndex + i);
    }
    setUploadingIndexes(prev => new Set([...prev, ...uploadingSet]));

    // 4. Upload ALL in parallel
    newAttachments.forEach(async (att, i) => {
      const attachmentIndex = startIndex + i;
      try {
        const { storageUrl, fileUri } = await uploadAttachment(att.data!, att.mimeType, att.name);

        // 5. Add URLs to attachment
        setAttachments(prev => prev.map((a, idx) =>
          idx === attachmentIndex ? { ...a, storageUrl, fileUri } : a
        ));

        // 6. Remove from uploading set (hide spinner)
        setUploadingIndexes(prev => {
          const updated = new Set(prev);
          updated.delete(attachmentIndex);
          return updated;
        });
      } catch (err) {
        console.error("Failed to upload", att.name, err);
        // Remove from uploading even on error
        setUploadingIndexes(prev => {
          const updated = new Set(prev);
          updated.delete(attachmentIndex);
          return updated;
        });
      }
    });
  }
};
```

### Send Button Safety

```typescript
const isUploading = uploadingIndexes.size > 0;

<button
  disabled={!hasContent || isLoading || isUploading}
  title={isUploading ? 'Uploading files...' : ''}
>
  {isUploading ? <Loader2 className="animate-spin" /> : <ArrowUp />}
</button>
```

---

## Backend: unifiedUpload

### Cloud Function Configuration

```typescript
// functions/src/index.ts

export const unifiedUpload = onRequest(
  {
    cors: true,
    secrets: ["GEMINI_API_KEY"],
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async (req, res) => { ... }
);
```

### Implementation

```typescript
try {
  const { fileName, mimeType, fileBufferBase64 } = req.body;

  if (!fileName || !mimeType || !fileBufferBase64) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  // Sanitize filename FIRST - Google AI SDK uses file path in HTTP headers (must be ASCII)
  const timestamp = Date.now();
  const sanitizedFileName = `${timestamp}_${fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // Remove diacritics
    .replace(/[^\x00-\x7F]/g, '_')}`; // Replace remaining non-ASCII

  // Decode base64 to buffer and write to temp file (use sanitized name!)
  const buffer = Buffer.from(fileBufferBase64, 'base64');
  const tempPath = `/tmp/${sanitizedFileName}`;
  fs.writeFileSync(tempPath, buffer);

  const ai = getAI();
  const bucket = admin.storage().bucket();

  // PARALLEL UPLOAD: Firebase Storage + Google AI File API
  const [fbUploadResult, aiUploadResult] = await Promise.all([
    // Firebase Storage (keeps original fileName - Firebase supports UTF-8)
    bucket.upload(tempPath, {
      destination: `attachments/${timestamp}_${fileName}`,
      metadata: { contentType: mimeType }
    }),
    // Google AI File API using @google/genai SDK
    ai.files.upload({
      file: tempPath,
      config: {
        mimeType: getFileApiMimeType(mimeType),
        displayName: sanitizedFileName,
      }
    })
  ]);

  // Generate signed URL (permanent access)
  const [storageUrl] = await fbUploadResult[0].getSignedUrl({
    action: 'read',
    expires: '03-01-2500'
  });

  // Cleanup temp file
  fs.unlinkSync(tempPath);

  res.json({
    storageUrl,
    fileUri: aiUploadResult.uri
  });

} catch (error: unknown) {
  console.error("[UnifiedUpload] Error:", error);
  const errorMessage = error instanceof Error ? error.message : "Upload failed";
  res.status(500).json({ error: errorMessage });
}
```

---

## Diacritics Sanitization

### The Problem

Google AI SDK uses file paths in HTTP headers which must be ASCII-only. Files with diacritics (Czech, Polish, etc.) cause errors:

```
TypeError: Cannot convert argument to a ByteString because the
character at index 23 has a value of 769 which is greater than 255
```

**Example:** `Ai referát.pdf` → Error (á = Unicode 769)

### The Solution

Sanitize filename **before** creating temp file:

```typescript
const sanitizedFileName = `${timestamp}_${fileName
  .normalize('NFD')                      // Decompose: á → a + combining accent
  .replace(/[\u0300-\u036f]/g, '')       // Remove combining accents
  .replace(/[^\x00-\x7F]/g, '_')}`;      // Replace other non-ASCII with underscore
```

**Example transformations:**
| Original | Sanitized |
|----------|-----------|
| `Ai referát.pdf` | `1735123456_Ai referat.pdf` |
| `być.png` | `1735123456_byc.png` |
| `日本語.jpg` | `1735123456___.jpg` |

### Key Point

Firebase Storage **keeps original filename** (supports UTF-8), so users see their original filenames in the UI. Only the Google AI File API path is sanitized.

---

## MIME Type Normalization

### The Problem

Gemini File API doesn't support all MIME types with `codeExecution` tool:

```
Error: The mime type: application/x-javascript is not supported for code execution
```

### The Solution

Normalize non-media MIME types to `text/plain`:

```typescript
const getFileApiMimeType = (mimeType: string): string => {
  const isMedia = mimeType.startsWith('image/') ||
                  mimeType.startsWith('video/') ||
                  mimeType.startsWith('audio/') ||
                  mimeType === 'application/pdf';
  return isMedia ? mimeType : 'text/plain';
};
```

**Important:** Use this helper in BOTH places:
1. `unifiedUpload` - when uploading to File API
2. `streamChat` - when sending `fileData` to Gemini

---

## Data Flow

### Complete Flow

```
User selects files
       │
       ▼
[Convert to base64] ─────── fileToBase64()
       │
       ▼
[Add to attachments state] ─ Show in UI with spinner
       │
       ▼
[Call unifiedUpload CF] ──── POST to Cloud Function
       │
       ├─── Sanitize filename (remove diacritics)
       │
       ├─── Write to /tmp/
       │
       ├─── Upload to Firebase Storage ─── storageUrl
       │         (keeps original filename)
       │
       └─── Upload to Google AI File API ─ fileUri
                 (uses sanitized filename)
       │
       ▼
[Update attachment] ─────── Add storageUrl + fileUri
       │
       ▼
[Remove from uploading] ─── Hide spinner
       │
       ▼
User clicks Send
       │
       ▼
[streamChat] ─────────────── Use fileUri for Gemini API
```

### Attachment States

```typescript
// 1. Just selected (converting to base64)
{ mimeType: "image/jpeg", data: "base64...", name: "photo.jpg" }

// 2. Uploading (spinner visible)
{ mimeType: "image/jpeg", data: "base64...", name: "photo.jpg" }
// uploadingIndexes.has(index) === true

// 3. Uploaded (ready to send)
{
  mimeType: "image/jpeg",
  data: "base64...",           // Kept for fallback
  name: "photo.jpg",
  storageUrl: "https://...",   // For UI preview
  fileUri: "files/abc123"      // For Gemini API
}

// 4. Saved to Firestore (data stripped)
{
  mimeType: "image/jpeg",
  name: "photo.jpg",
  storageUrl: "https://..."
  // NO data - would exceed 1MB limit
  // NO fileUri - expires after 48h
}
```

---

## Types

```typescript
// types.ts

export interface Attachment {
  mimeType: string;
  data?: string;        // base64 (for Gemini inlineData fallback)
  storageUrl?: string;  // Firebase Storage URL (permanent, for UI)
  fileUri?: string;     // Google AI File API URI (for Gemini, expires 48h)
  name?: string;
  isPlaceholder?: boolean;
  aspectRatio?: string;
  isGraph?: boolean;
}
```

---

## Troubleshooting

### Error: "Cannot convert argument to a ByteString"

**Cause:** Filename contains diacritics (á, ě, ř, etc.)

**Solution:** Ensure `sanitizedFileName` is created BEFORE `tempPath`:
```typescript
const sanitizedFileName = `${timestamp}_${fileName.normalize('NFD')...}`;
const tempPath = `/tmp/${sanitizedFileName}`;  // Use sanitized name!
```

### Error: "File too large (max 20MB)"

**Cause:** Base64 data exceeds 28MB (≈ 20MB original)

**Solution:** Client-side validation before upload:
```typescript
if (base64Data.length > 28 * 1024 * 1024) {
  throw new Error("File too large (max 20MB)");
}
```

### Error: "MIME type not supported for code execution"

**Cause:** Using raw MIME type like `application/x-javascript`

**Solution:** Use `getFileApiMimeType()` to normalize:
```typescript
mimeType: getFileApiMimeType(att.mimeType)  // Returns 'text/plain' for code
```

### Error: "storage/unauthorized"

**Cause:** User not authenticated or file exceeds security rules

**Solution:** Check Firebase Storage rules allow the upload

### Send button stays disabled

**Cause:** Upload failed but index not removed from `uploadingIndexes`

**Solution:** Always remove from set in both try and catch:
```typescript
} catch (err) {
  setUploadingIndexes(prev => {
    const updated = new Set(prev);
    updated.delete(attachmentIndex);
    return updated;
  });
}
```

---

## Limits

| Limit | Value | Notes |
|-------|-------|-------|
| Cloud Function payload | ~20MB | Base64 adds ~33% overhead |
| Firebase Storage | Unlimited | Permanent signed URLs |
| Google AI File API | 2GB per file | Expires after 48h |
| Firestore document | 1MB | Don't save base64 data |
| Gemini inlineData | 10MB | Use fileUri to bypass |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-12-21 | Initial unified upload implementation |
| 1.1.0 | 2025-12-21 | MIME type normalization fix |
| 2.0.0 | 2025-12-29 | Migrated to @google/genai SDK |
| 2.1.0 | 2025-12-30 | Added diacritics sanitization for filenames |

---

*Documentation generated: 2025-12-30*
