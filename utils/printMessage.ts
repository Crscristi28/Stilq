/**
 * Print Single Message Utility
 *
 * Opens a new window with nicely formatted HTML for printing.
 * User can cancel print and still see the nice document.
 * Uses marked.js (CDN) for proper markdown rendering including tables.
 */

import { ChatMessage, Attachment } from '../types';

// Get gallery images (not inline)
const getGalleryImages = (msg: ChatMessage): Attachment[] => {
  if (!msg.attachments) return [];

  const inlineIndices = new Set<number>();
  const regex = /\[IMAGE:(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(msg.text)) !== null) {
    inlineIndices.add(parseInt(match[1], 10));
  }

  return msg.attachments.filter((att, idx) =>
    !att.isGraph &&
    !inlineIndices.has(idx) &&
    att.mimeType?.startsWith('image/') &&
    att.storageUrl
  );
};

// Build image map for inline rendering
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

// Main print function
export const printMessage = (msg: ChatMessage): void => {
  const galleryImages = getGalleryImages(msg);
  const timestamp = new Date(msg.timestamp).toLocaleString();
  const imageMap = buildImageMap(msg);

  // Escape content for safe embedding in script
  const rawText = msg.text;
  const escapedText = JSON.stringify(rawText);
  const escapedImageMap = JSON.stringify(imageMap);
  const escapedGalleryImages = JSON.stringify(galleryImages.map(att => att.storageUrl));

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Print Document</title>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.7;
      color: #1a1a1a;
      background: #fff;
      padding: 40px;
      max-width: 800px;
      margin: 0 auto;
    }
    .meta {
      font-size: 12px;
      color: #6b7280;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid #e5e7eb;
    }
    .content p {
      margin-bottom: 16px;
      font-size: 15px;
    }
    .content h1, .content h2, .content h3, .content h4, .content h5, .content h6 {
      margin: 24px 0 12px;
      font-weight: 600;
      page-break-after: avoid;
      break-after: avoid;
    }
    .content h1 { font-size: 24px; }
    .content h2 { font-size: 20px; }
    .content h3 { font-size: 18px; }
    .content h4 { font-size: 16px; }
    .content ul, .content ol {
      margin: 16px 0;
      padding-left: 24px;
    }
    .content li {
      margin-bottom: 8px;
    }
    .content table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
      font-size: 14px;
    }
    .content th, .content td {
      border: 1px solid #d1d5db;
      padding: 10px 12px;
      text-align: left;
    }
    .content th {
      background: #f3f4f6;
      font-weight: 600;
    }
    .content tr:nth-child(even) {
      background: #f9fafb;
    }
    .inline-image {
      margin: 20px 0;
      page-break-inside: avoid;
    }
    .inline-image img {
      max-width: 100%;
      height: auto;
      border-radius: 12px;
      border: 1px solid #e5e7eb;
    }
    .gallery {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 24px;
    }
    .gallery img {
      max-width: 200px;
      height: auto;
      border-radius: 12px;
      border: 1px solid #e5e7eb;
    }
    .content pre {
      background: #f5f5f5;
      color: #1a1a1a;
      padding: 16px;
      border-radius: 8px;
      border: 1px solid #e0e0e0;
      overflow-x: auto;
      font-family: 'SF Mono', Monaco, Consolas, monospace;
      font-size: 13px;
      margin: 16px 0;
      white-space: pre-wrap;
    }
    .content code {
      font-family: 'SF Mono', Monaco, Consolas, monospace;
      font-size: 13px;
    }
    .content p code, .content li code {
      background: #f3f4f6;
      color: #1a1a1a;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .content blockquote {
      border-left: 4px solid #3b82f6;
      padding-left: 16px;
      margin: 16px 0;
      color: #4b5563;
      font-style: italic;
    }
    .content a { color: #3b82f6; text-decoration: none; }
    .content a:hover { text-decoration: underline; }
    .content hr {
      border: none;
      border-top: 1px solid #e5e7eb;
      margin: 24px 0;
    }
    .header-buttons {
      position: fixed;
      top: 20px;
      right: 20px;
      display: flex;
      gap: 8px;
    }
    .header-btn {
      padding: 10px 20px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
    }
    .header-btn:hover { background: #2563eb; }
    @media print {
      @page {
        margin: 0;
        size: auto;
      }
      body {
        margin: 2cm !important;
        padding: 0 !important;
        max-width: none !important;
        background-color: white !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .header-buttons { display: none; }
      .meta { display: none; }
      .content pre {
        page-break-inside: avoid;
        background: #f5f5f5 !important;
        color: #1a1a1a !important;
        border: 1px solid #e0e0e0 !important;
      }
      .content table { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="header-buttons">
    <button class="header-btn" onclick="window.print()">Print</button>
    <button class="header-btn" onclick="window.close()">Close</button>
  </div>
  <div class="meta">${timestamp}</div>
  <div class="content" id="content"></div>

  <script>
    // Data passed from React
    const rawText = ${escapedText};
    const imageMap = ${escapedImageMap};
    const galleryImages = ${escapedGalleryImages};

    // Configure marked for GFM (tables, etc.)
    marked.setOptions({
      gfm: true,
      breaks: true
    });

    // Split text by image markers and render
    function renderContent() {
      const contentDiv = document.getElementById('content');
      const parts = rawText.split(/(\\[(?:GRAPH|IMAGE):\\d+\\])/);

      parts.forEach(part => {
        const graphMatch = part.match(/\\[GRAPH:(\\d+)\\]/);
        const imageMatch = part.match(/\\[IMAGE:(\\d+)\\]/);

        if (graphMatch) {
          const key = 'GRAPH:' + graphMatch[1];
          if (imageMap[key]) {
            const div = document.createElement('div');
            div.className = 'inline-image';
            div.innerHTML = '<img src="' + imageMap[key] + '" alt="Graph" />';
            contentDiv.appendChild(div);
          }
        } else if (imageMatch) {
          const key = 'IMAGE:' + imageMatch[1];
          if (imageMap[key]) {
            const div = document.createElement('div');
            div.className = 'inline-image';
            div.innerHTML = '<img src="' + imageMap[key] + '" alt="Image" />';
            contentDiv.appendChild(div);
          }
        } else if (part.trim()) {
          const div = document.createElement('div');
          div.innerHTML = marked.parse(part);
          contentDiv.appendChild(div);
        }
      });

      // Add gallery images
      if (galleryImages.length > 0) {
        const gallery = document.createElement('div');
        gallery.className = 'gallery';
        galleryImages.forEach(url => {
          const img = document.createElement('img');
          img.src = url;
          img.alt = 'Image';
          gallery.appendChild(img);
        });
        contentDiv.appendChild(gallery);
      }
    }

    // Wait for marked to load, then render
    function init() {
      if (typeof marked !== 'undefined') {
        renderContent();
      } else {
        setTimeout(init, 50);
      }
    }

    init();
  <\/script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);

  const newWindow = window.open(blobUrl, '_blank');
  if (newWindow) {
    newWindow.addEventListener('pagehide', () => URL.revokeObjectURL(blobUrl));
  }
};
