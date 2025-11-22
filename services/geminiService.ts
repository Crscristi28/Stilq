import { Attachment, ChatMessage, ModelId, PromptSettings, TONE_PROMPTS } from "../types";

// Cloud Function URLs
const BASE_URL = 'https://us-central1-elenor-57bde.cloudfunctions.net';
const STREAM_CHAT_URL = `${BASE_URL}/streamChat`;
const DETECT_INTENT_URL = `${BASE_URL}/detectIntent`;
const SUGGESTIONS_URL = `${BASE_URL}/generateSuggestions`;

/**
 * Detects User Intent using Cloud Function
 * Returns 'IMAGE' if the user wants to generate/edit an image, otherwise 'CHAT'.
 */
const detectIntent = async (newMessage: string, lastHistory: ChatMessage[]): Promise<'IMAGE' | 'CHAT'> => {
  try {
    const response = await fetch(DETECT_INTENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newMessage,
        lastHistory: lastHistory.slice(-2).map(m => ({
          role: m.role,
          text: m.text
        }))
      }),
    });

    if (!response.ok) {
      return 'CHAT'; // Default to chat on error
    }

    const data = await response.json();
    return data.intent === 'IMAGE' ? 'IMAGE' : 'CHAT';
  } catch (e) {
    return 'CHAT'; // Default to chat on error
  }
};

/**
 * Streams a chat response from Gemini via Cloud Function (secure).
 * NOW WITH AGENT CAPABILITIES: Auto-switches to Image Gen model if needed.
 */
export const streamChatResponse = async (
  history: ChatMessage[],
  newMessage: string,
  attachments: Attachment[],
  modelId: ModelId,
  settings: PromptSettings,
  onChunk: (text: string) => void
): Promise<string> => {
  // --- AGENT ROUTING START ---
  // If the user is NOT already in Image Gen mode, let's check if they WANT to be.
  let activeModelId = modelId;

  if (modelId !== ModelId.IMAGE_GEN) {
    const intent = await detectIntent(newMessage, history);
    if (intent === 'IMAGE') {
      activeModelId = ModelId.IMAGE_GEN;
      // Automatically switch to image generation
    }
  }
  // --- AGENT ROUTING END ---

  // Construct System Instruction
  let finalSystemInstruction = TONE_PROMPTS[settings.style];
  if (settings.systemInstruction) {
    finalSystemInstruction = finalSystemInstruction
      ? `${finalSystemInstruction}\n\nAdditional Instructions:\n${settings.systemInstruction}`
      : settings.systemInstruction;
  }

  try {
    // Call Cloud Function with SSE streaming
    const response = await fetch(STREAM_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        history: history.map(msg => ({
          role: msg.role,
          text: msg.text,
        })),
        newMessage,
        attachments,
        modelId: activeModelId,
        settings: {
          temperature: settings.temperature,
          topP: settings.topP,
          systemInstruction: finalSystemInstruction,
          aspectRatio: settings.aspectRatio,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Cloud Function error: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('No response body from Cloud Function');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Decode the SSE chunk
      const chunk = decoder.decode(value, { stream: true });

      // SSE format: "data: {json}\n\n"
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));

          if (data.error) {
            throw new Error(data.error);
          }

          if (data.text) {
            fullText += data.text;
            onChunk(data.text);
          }

          if (data.done) {
            return fullText;
          }
        }
      }
    }

    return fullText;

  } catch (error: any) {
    console.error("Gemini API Error:", error);

    let errorMessage = error.message || "Unknown error occurred";

    // Try to parse inner JSON error message if it exists
    try {
      if (errorMessage.trim().startsWith('{')) {
        const parsed = JSON.parse(errorMessage);
        if (parsed.error && parsed.error.message) {
          errorMessage = parsed.error.message;

          if (parsed.error.code === 429 || parsed.error.status === 'RESOURCE_EXHAUSTED') {
            throw new Error("Traffic limit reached. Please wait a moment before sending another message.");
          }
        }
      }
    } catch (e) {
      // If parsing fails, use original string
    }

    // Direct string checks
    if (errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('quota')) {
      throw new Error("Traffic limit reached. Please wait a moment before sending another message.");
    }

    if (errorMessage.includes('404') || errorMessage.includes('not found')) {
      throw new Error(`The model ${modelId} is currently unavailable or not supported.`);
    }

    throw new Error(errorMessage);
  }
};

/**
 * Generates quick follow-up suggestions via Cloud Function.
 * Uses gemini-2.0-flash-lite for speed and low cost.
 */
export const generateSuggestions = async (
  lastUserMessage: string,
  lastBotResponse: string
): Promise<string[]> => {
  try {
    const response = await fetch(SUGGESTIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lastUserMessage,
        lastBotResponse
      }),
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data.suggestions || [];
  } catch (e) {
    console.warn("Failed to generate suggestions", e);
    return [];
  }
};

/**
 * Converts a File to base64 string for sending to backend.
 */
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:image/png;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
  });
};
