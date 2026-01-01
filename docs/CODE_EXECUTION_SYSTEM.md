# Code Execution System Implementation Guide

## Overview

Stilq uses Gemini's native **codeExecution** tool to run Python code and generate visualizations (matplotlib graphs, charts, etc.). The system handles code execution results, extracts images, and displays them inline in chat.

**Key Features:**
- Native Python code execution via Gemini API
- Automatic graph extraction from code results
- Inline `[GRAPH:X]` markers for seamless display
- Background upload to Firebase Storage
- Separate from image generation (Pro Image)

---

## Table of Contents
1. [Architecture](#architecture)
2. [Backend: Code Execution Handling](#backend-code-execution-handling)
3. [Frontend: Graph Display](#frontend-graph-display)
4. [System Prompts](#system-prompts)
5. [Data Flow](#data-flow)
6. [Types](#types)
7. [Differences from Image Generation](#differences-from-image-generation)

---

## Architecture

### Flow Diagram

```
User asks for visualization
       │
       ▼
[Gemini model with codeExecution tool]
       │
       ├─── executableCode (Python code) ─── Hidden from user
       │
       └─── codeExecutionResult
                │
                ├─── inlineData (image/png) ─── Graph image
                │
                └─── output (text/base64) ─── Check for images
       │
       ▼
[Backend extracts image]
       │
       ▼
[Send as { graph: { mimeType, data } }]
       │
       ▼
[Frontend: geminiService.ts]
       │
       ├─── onGraph callback
       │
       └─── Add [GRAPH:X] marker to text
       │
       ▼
[App.tsx: Upload to Firebase Storage]
       │
       ▼
[MessageList.tsx: Render inline]
```

### Models with Code Execution

| Model | codeExecution | Configuration |
|-------|---------------|---------------|
| Gemini 3 Flash | Yes | `thinkingLevel: HIGH` |
| Gemini 3 Pro Preview | Yes | `thinkingLevel: LOW` |
| Gemini 2.5 Pro | Yes | `thinkingBudget: 4096` |
| Research Mode | Yes | `thinkingLevel: HIGH` |
| Pro Image | No | Image generation only |

---

## Backend: Code Execution Handling

### Tool Configuration

```typescript
// functions/src/index.ts

// Gemini 3 Flash
modelConfig = {
  tools: [
    { googleSearch: {} },
    { codeExecution: {} },
    { urlContext: {} }
  ],
  thinkingConfig: { includeThoughts: true, thinkingLevel: ThinkingLevel.HIGH },
  temperature: 1.0,
  maxOutputTokens: 64000,
};

// Gemini 3 Pro Preview
modelConfig = {
  tools: [
    { googleSearch: {} },
    { codeExecution: {} },
    { urlContext: {} }
  ],
  thinkingConfig: { includeThoughts: true, thinkingLevel: ThinkingLevel.LOW },
  temperature: 1.0,
  maxOutputTokens: 65536,
};
```

### Extracting Images from Code Results

```typescript
// functions/src/index.ts - inside streaming loop

for (const part of parts) {
    // 1. executableCode - HIDDEN from user
    if ((part as any).executableCode) {
        console.log(`[DEBUG] CODE EXECUTION - hidden from user`);
        // Code is NEVER sent to client - only images from results
    }

    // 2. codeExecutionResult - Check for images in output
    if ((part as any).codeExecutionResult) {
        const output = (part as any).codeExecutionResult.output || '';
        console.log(`[DEBUG] CODE RESULT - checking for images`);

        // Extract base64 images from output
        const base64ImageRegex = /data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=]+)/;
        const imageMatch = output.match(base64ImageRegex);
        if (imageMatch) {
            const mimeType = `image/${imageMatch[1]}`;
            const base64Data = imageMatch[2];
            // Send as IMAGE event (extracted from text output)
            res.write(`data: ${JSON.stringify({ image: { mimeType, data: base64Data } })}\n\n`);
        }
        // Text output and errors are hidden - only images shown
    }

    // 3. inlineData - Direct graph from matplotlib
    if ((part as any).inlineData) {
        console.log(`[DEBUG] INLINE DATA (graph):`, (part as any).inlineData.mimeType);
        const inlineData = (part as any).inlineData;
        const mimeType = inlineData.mimeType || 'image/png';
        const base64Data = inlineData.data;
        // Send as GRAPH event (separate from image-agent images)
        res.write(`data: ${JSON.stringify({
            graph: { mimeType, data: base64Data }
        })}\n\n`);
    }
}
```

### Event Types

| Event | Source | Purpose |
|-------|--------|---------|
| `{ image: {...} }` | Pro Image, Image Agent | AI-generated images |
| `{ graph: {...} }` | codeExecution inlineData | Matplotlib graphs, charts |

---

## Frontend: Graph Display

### geminiService.ts - Handling Graph Events

```typescript
// services/geminiService.ts

// Handle graph event (from codeExecution) - separate from images
// Marker is added HERE so fullText includes it (saved to DB correctly)
if (data.graph) {
    console.log("GeminiService: RECEIVED GRAPH EVENT!", data.graph.mimeType);
    if (onGraph) {
        const graphIndex = await onGraph(data.graph);
        const marker = `\n[GRAPH:${graphIndex}]\n`;
        fullText += marker;
        onChunk(marker);
    }
}
```

### App.tsx - onGraph Callback

```typescript
// App.tsx - inside streamChatResponse call

// onGraph - graphs from codeExecution (rendered inline with marker)
// Returns index immediately, upload runs in background (non-blocking)
async (graphData) => {
    const graphIndex = streamAttachmentsRef.current.length;

    if (user?.uid && sessionId) {
        // Create placeholder immediately (for instant UI)
        const placeholder: Attachment = {
            mimeType: graphData.mimeType,
            isPlaceholder: true,
            isGraph: true,
            aspectRatio: '1:1'
        };
        streamAttachmentsRef.current = [...streamAttachmentsRef.current, placeholder];

        // Upload in background - don't block streaming
        uploadGeneratedImage(graphData, user.uid, sessionId)
            .then(attachment => {
                streamAttachmentsRef.current = streamAttachmentsRef.current.map(att =>
                    att === placeholder
                        ? { ...attachment, isGraph: true, aspectRatio: '1:1' }
                        : att
                );
            })
            .catch(err => {
                console.error("APP: Failed to upload graph:", err);
                streamAttachmentsRef.current = streamAttachmentsRef.current.filter(att => att !== placeholder);
            });
    }
    return graphIndex;
}
```

### MessageList.tsx - Rendering Inline Graphs

```typescript
// components/MessageList.tsx

// Split text by [GRAPH:X] and [IMAGE:X] markers
const parts = msg.text.split(/(\[(?:GRAPH|IMAGE):\d+\])/);

return parts.map((part, idx) => {
    const graphMatch = part.match(/\[GRAPH:(\d+)\]/);
    const imageMatch = part.match(/\[IMAGE:(\d+)\]/);

    if (graphMatch) {
        // Render graph inline
        const graphIndex = parseInt(graphMatch[1], 10);
        const att = msg.attachments?.[graphIndex];
        if (att && att.isGraph) {
            const cssRatio = (att.aspectRatio || '1:1').replace(':', '/');
            if (att.isPlaceholder) {
                // Show loading placeholder
                return (
                    <div key={idx} className="animate-pulse" style={{ aspectRatio: cssRatio }}>
                        <Sparkles className="text-blue-500 animate-pulse" />
                    </div>
                );
            }
            // Show actual graph
            return (
                <img
                    key={idx}
                    src={att.storageUrl || `data:${att.mimeType};base64,${att.data}`}
                    className="rounded-2xl"
                    style={{ aspectRatio: cssRatio }}
                />
            );
        }
    }

    if (imageMatch) {
        // Render image inline (from Pro Image)
        // ... similar logic
    }

    return <MarkdownRenderer key={idx} content={part} />;
});
```

### Gallery Filtering

Graphs are NOT shown in the gallery (only inline):

```typescript
// Filter: non-graph, non-inline images only
const galleryAttachments = msg.attachments.filter((att, attIdx) =>
    !att.isGraph && !inlineIndices.has(attIdx)
);
```

---

## System Prompts

### Code Execution Instructions (flash.ts)

```xml
<tool name="codeExecution">
  <trigger>REQUIRED for: high-precision math, statistical analysis,
           large data processing, and complex visualizations.</trigger>

  <visualization_scenarios>
    <description>Use to CREATE GRAPHS for these topics:</description>
    <financial>Stock history, crypto trends, portfolio pie charts.</financial>
    <math_science>Plotting functions, geometry, physics trajectories.</math_science>
    <comparisons>Benchmarks, market share, price comparisons.</comparisons>
    <trends>Time-series (weather, population, adoption).</trends>
    <reminder>Data comes from googleSearch FIRST → then visualize here.</reminder>
  </visualization_scenarios>

  <placement>IN-LINE. Insert graphs naturally into the chat.</placement>

  <limitations priority="critical">
    <rule>NO internet access (cannot download files/APIs).</rule>
    <rule>Use ONLY data from: googleSearch results, user input, or self-generated.</rule>
  </limitations>

  <rendering>
    <fact>The CodeExecution tool AUTOMATICALLY displays the plot/image
         in chat immediately after the code runs.</fact>
    <rule>NEVER use markdown image links (![](file.png)).</rule>
    <reason>Manual links fail to resolve and create broken UI.</reason>
  </rendering>

  <execution_protocol priority="critical">
    <step1>DATA ACQUISITION: Perform 2-3 targeted searches via googleSearch.</step1>
    <step2>VISUAL CORE: Execute codeExecution to generate the graph.</step2>
    <step3>FINAL DELIVERY: Present analysis of data and graph.</step3>
  </execution_protocol>
</tool>
```

### Key Rules for Model

1. **Data First**: Use googleSearch to get data, then visualize
2. **No Network**: codeExecution cannot download files or call APIs
3. **Auto Display**: Graphs appear automatically, no markdown links needed
4. **Fallback**: If graph fails, use Markdown table or ASCII chart

---

## Data Flow

### Complete Flow

```
User: "Show me Bitcoin price chart for last month"
       │
       ▼
[Gemini uses googleSearch to get BTC prices]
       │
       ▼
[Gemini uses codeExecution with matplotlib]
       │
       ▼
[Backend receives part.inlineData]
       │
       ▼
[Send SSE: { graph: { mimeType: "image/png", data: "base64..." } }]
       │
       ▼
[geminiService.ts: onGraph callback]
       │
       ▼
[App.tsx: Create placeholder, start upload]
       │
       ▼
[Add marker to text: "...\n[GRAPH:0]\n..."]
       │
       ▼
[MessageList.tsx: Split by marker, render inline]
       │
       ▼
[Upload completes: Replace placeholder with storageUrl]
```

### Marker Format

```
[GRAPH:0]  - First graph in attachments array
[GRAPH:1]  - Second graph
[IMAGE:0]  - First image (from Pro Image, separate)
```

---

## Types

```typescript
// types.ts

export interface Attachment {
  mimeType: string;
  data?: string;          // base64 (temporary)
  storageUrl?: string;    // Firebase Storage URL (permanent)
  fileUri?: string;       // Google AI File API URI
  name?: string;
  isPlaceholder?: boolean; // True during upload
  aspectRatio?: string;    // "1:1", "16:9", etc.
  isGraph?: boolean;       // TRUE for codeExecution graphs
}
```

### isGraph vs Regular Images

| Property | Graph (codeExecution) | Image (Pro Image) |
|----------|----------------------|-------------------|
| `isGraph` | `true` | `false`/undefined |
| Marker | `[GRAPH:X]` | `[IMAGE:X]` |
| Source | matplotlib, charts | AI image generation |
| Gallery | Hidden | Shown (if no marker) |
| Aspect Ratio | Usually `1:1` | Dynamic |

---

## Differences from Image Generation

| Aspect | Code Execution (Graphs) | Pro Image |
|--------|------------------------|-----------|
| Tool | `codeExecution` | Native image generation |
| Event | `{ graph: {...} }` | `{ image: {...} }` |
| Marker | `[GRAPH:X]` | `[IMAGE:X]` |
| `isGraph` | `true` | `false` |
| Use Case | Data visualization | Creative images |
| Gallery | Never shown | Shown if no inline marker |
| Models | Flash, Pro, Pro 2.5 | Pro Image only |

---

## Troubleshooting

### Graphs Not Appearing

**Check:**
1. Model has `codeExecution` in tools config
2. Backend sends `{ graph: {...} }` event (not `{ image: {...} }`)
3. `onGraph` callback is passed to `streamChatResponse`
4. `isGraph: true` set on attachment

### Graph Shows in Gallery

**Cause:** `isGraph` not set to `true`

**Fix:** Ensure `isGraph: true` when creating attachment:
```typescript
{ ...attachment, isGraph: true, aspectRatio: '1:1' }
```

### Broken Image Links in Response

**Cause:** Model outputting `![](image.png)` markdown

**Fix:** System prompt tells model not to use markdown image links - graphs appear automatically

### Code Execution Errors with File Uploads

**Cause:** MIME type not supported (e.g., `application/x-javascript`)

**Fix:** Use `getFileApiMimeType()` to normalize to `text/plain`

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-12-30 | Initial documentation |

---

*Documentation generated: 2025-12-30*
