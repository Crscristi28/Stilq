/**
 * PDF Preview Utility
 * Opens PDF in HTML window with same styling as printMessage (only Close button)
 */

import { Attachment } from '../types';

export const previewDocument = (att: Attachment): void => {
  // Only PDF
  if (att.mimeType !== 'application/pdf') return;

  const url = att.storageUrl || '';
  const name = att.name || 'Document';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #fff;
    }
    .pdf-container {
      width: 100%;
      height: 100vh;
    }
    .pdf-container embed {
      width: 100%;
      height: 100%;
    }
    .header-buttons {
      position: fixed;
      top: 20px;
      right: 20px;
      display: flex;
      gap: 8px;
      z-index: 100;
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
  </style>
</head>
<body>
  <div class="header-buttons">
    <button class="header-btn" onclick="window.close()">Close</button>
  </div>
  <div class="pdf-container">
    <embed src="${url}" type="application/pdf" />
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);

  const newWindow = window.open(blobUrl, '_blank');
  if (newWindow) {
    newWindow.addEventListener('pagehide', () => URL.revokeObjectURL(blobUrl));
  }
};
