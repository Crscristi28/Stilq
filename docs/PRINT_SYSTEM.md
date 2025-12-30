# Print System Implementation Guide

## Overview

The Print System allows users to export AI messages as beautifully formatted PDF documents. It opens a new browser window with HTML preview, renders markdown with inline images, and triggers the native print dialog.

**Key Features:**
- HTML preview window with Close button
- Markdown rendering via marked.js (CDN)
- Inline image support with `[IMAGE:X]` markers
- Gallery for non-inline images
- Print-optimized CSS (page breaks, ink-saving, no browser headers)
- Automatic print dialog after images load

---

## Table of Contents
1. [Architecture](#architecture)
2. [HTML Preview Window](#html-preview-window)
3. [Markdown Rendering](#markdown-rendering)
4. [Image Handling](#image-handling)
5. [Print CSS](#print-css)
6. [Code Reference](#code-reference)

---

## Architecture

### Flow

```
User clicks Print → printMessage(msg) → window.open() → HTML generated → marked.js loads → Images load → Print dialog
```

### File Structure

```
utils/
└── printMessage.ts     # Main print utility

components/
└── MessageList.tsx     # Print button integration
```

---

## HTML Preview Window

The print system opens a new browser tab with a standalone HTML document.

### Key Elements

| Element | Purpose |
|---------|---------|
| Close button | Fixed top-right, allows user to cancel |
| Meta section | Timestamp (hidden in print) |
| Content div | Rendered markdown + images |

### Window Creation

```typescript
const printWindow = window.open('', '_blank');
if (!printWindow) {
    alert('Please allow popups to print.');
    return;
}

// Write HTML and close document
printWindow.document.write(html);
printWindow.document.close();
```

---

## Markdown Rendering

Uses **marked.js** loaded from CDN for proper markdown rendering including:
- Headers (h1-h6)
- Lists (ordered and unordered)
- Tables (GFM syntax)
- Code blocks with syntax highlighting
- Blockquotes
- Links

### Configuration

```javascript
marked.setOptions({
    gfm: true,      // GitHub Flavored Markdown
    breaks: true    // Convert \n to <br>
});
```

### CDN Loading

```html
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
```

The script waits for marked.js to load before rendering:

```javascript
function init() {
    if (typeof marked !== 'undefined') {
        renderContent();
        waitForImagesAndPrint();
    } else {
        setTimeout(init, 50);  // Retry until loaded
    }
}
```

---

## Image Handling

### Inline Images

Images embedded in text use `[IMAGE:X]` and `[GRAPH:X]` markers:

```typescript
// Split text by image markers
const parts = rawText.split(/(\[(?:GRAPH|IMAGE):\d+\])/);

parts.forEach(part => {
    const imageMatch = part.match(/\[IMAGE:(\d+)\]/);

    if (imageMatch) {
        const key = 'IMAGE:' + imageMatch[1];
        if (imageMap[key]) {
            // Render inline image
            div.innerHTML = '<img src="' + imageMap[key] + '" alt="Image" />';
        }
    } else {
        // Render as markdown
        div.innerHTML = marked.parse(part);
    }
});
```

### Gallery Images

Images without inline markers are displayed in a gallery at the bottom:

```typescript
// Get gallery images (not inline)
const getGalleryImages = (msg: ChatMessage): Attachment[] => {
    if (!msg.attachments) return [];

    // Find indices of inline images
    const inlineIndices = new Set<number>();
    const regex = /\[IMAGE:(\d+)\]/g;
    let match;
    while ((match = regex.exec(msg.text)) !== null) {
        inlineIndices.add(parseInt(match[1], 10));
    }

    // Filter: images that are NOT inline and NOT graphs
    return msg.attachments.filter((att, idx) =>
        !att.isGraph &&
        !inlineIndices.has(idx) &&
        att.mimeType?.startsWith('image/') &&
        att.storageUrl
    );
};
```

### Image Map

Maps marker indices to storage URLs:

```typescript
const buildImageMap = (msg: ChatMessage): Record<string, string> => {
    const map: Record<string, string> = {};
    if (!msg.attachments) return map;

    msg.attachments.forEach((att, idx) => {
        if (att.storageUrl) {
            map[`IMAGE:${idx}`] = att.storageUrl;
            map[`GRAPH:${idx}`] = att.storageUrl;
        }
    });

    return map;
};
```

### Wait for Images Before Print

Print dialog opens only after all images are loaded:

```typescript
function waitForImagesAndPrint() {
    const images = document.querySelectorAll('img');
    let loaded = 0;
    const total = images.length;

    if (total === 0) {
        setTimeout(() => { window.focus(); window.print(); }, 100);
        return;
    }

    images.forEach(img => {
        if (img.complete) {
            loaded++;
        } else {
            img.onload = img.onerror = () => {
                loaded++;
                if (loaded === total) {
                    window.focus();
                    window.print();
                }
            };
        }
    });

    // Fallback: print after 3 seconds
    setTimeout(() => { window.focus(); window.print(); }, 3000);
}
```

---

## Print CSS

### Remove Browser Headers/Footers

```css
@media print {
    @page {
        margin: 0;      /* Removes browser headers/footers */
        size: auto;
    }
    body {
        margin: 2cm !important;  /* Content margin (replaces @page margin) */
        padding: 0 !important;
        max-width: none !important;
    }
}
```

### Page Break Control

```css
/* Keep headings with their content */
.content h1, .content h2, .content h3, .content h4, .content h5, .content h6 {
    page-break-after: avoid;
    break-after: avoid;
}

/* Don't break inside code blocks or tables */
.content pre {
    page-break-inside: avoid;
}
.content table {
    page-break-inside: avoid;
}
```

### Ink-Saving Code Blocks

Light background instead of dark:

```css
.content pre {
    background: #f5f5f5;      /* Light gray (saves ink) */
    color: #1a1a1a;           /* Dark text */
    border: 1px solid #e0e0e0;
}

/* Ensure color is preserved in print */
@media print {
    .content pre {
        background: #f5f5f5 !important;
        color: #1a1a1a !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
}
```

### Hidden Elements in Print

```css
@media print {
    .close-btn { display: none; }
    .meta { display: none; }
}
```

---

## Code Reference

### Main Function

```typescript
// utils/printMessage.ts
export const printMessage = (msg: ChatMessage): void => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('Please allow popups to print.');
        return;
    }

    const galleryImages = getGalleryImages(msg);
    const timestamp = new Date(msg.timestamp).toLocaleString();
    const imageMap = buildImageMap(msg);

    // Escape content for safe embedding
    const escapedText = JSON.stringify(msg.text);
    const escapedImageMap = JSON.stringify(imageMap);
    const escapedGalleryImages = JSON.stringify(galleryImages.map(att => att.storageUrl));

    const html = `<!DOCTYPE html>...`;  // Full HTML template

    printWindow.document.write(html);
    printWindow.document.close();
};
```

### Button Integration

```tsx
// components/MessageList.tsx
import { printMessage } from '../utils/printMessage';
import { Printer } from 'lucide-react';

<button
    onClick={() => printMessage(msg)}
    className="p-1.5 text-gray-400 hover:text-gray-600..."
    title="Print"
>
    <Printer size={14}/>
</button>
```

### Types

```typescript
interface ChatMessage {
    id: string;
    text: string;
    timestamp: number;
    attachments?: Attachment[];
}

interface Attachment {
    mimeType: string;
    storageUrl?: string;
    isGraph?: boolean;
}
```

---

## Styling Summary

| Element | Preview Style | Print Style |
|---------|---------------|-------------|
| Body | `padding: 40px`, `max-width: 800px` | `margin: 2cm` |
| Code blocks | `background: #f5f5f5` | Same (ink-saving) |
| Headings | `page-break-after: avoid` | Same |
| Close button | Visible | Hidden |
| Timestamp | Visible | Hidden |
| Images | `border-radius: 12px` | Same |

---

## Browser Compatibility

| Feature | Desktop | Mobile |
|---------|---------|--------|
| Headers/Footers removed | Yes | Varies by browser |
| Page breaks | Yes | Yes |
| Color printing | Yes | Yes |
| Popup window | Yes | May be blocked |

**Note:** Mobile browsers may still show headers/footers due to browser limitations. Desktop browsers (Chrome, Firefox, Safari) respect the `@page { margin: 0 }` rule.

---

## Unique Feature

This print system is unique because it supports **inline images within AI-generated text**. No other AI chat application offers:
- Text + images mixed in natural document flow
- Proper PDF export with inline images
- Gallery for additional images

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-12-29 | Initial implementation |
| 1.1.0 | 2025-12-29 | Added ink-saving light code blocks |
| 1.2.0 | 2025-12-29 | Fixed orphan headers with page-break-after |
| 1.3.0 | 2025-12-29 | Removed browser headers/footers |

---

*Documentation generated: 2025-12-29*
