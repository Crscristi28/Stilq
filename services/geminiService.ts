import { Attachment, ChatMessage, ModelId, PromptSettings, TONE_PROMPTS, Source } from "../types";

// Cloud Function URLs
const BASE_URL = 'https://us-central1-elenor-57bde.cloudfunctions.net';
const STREAM_CHAT_URL = `${BASE_URL}/streamChat`;
const SUGGESTIONS_URL = `${BASE_URL}/generateSuggestions`;

/**
 * Streams a chat response from Gemini via Cloud Function (secure).
 * NOW WITH AGENT CAPABILITIES: Uses server-side routing or tool calling.
 */
export const streamChatResponse = async (
  history: ChatMessage[],
  newMessage: string,
  attachments: Attachment[],
  modelId: ModelId,
  settings: PromptSettings,
  appSettings: { showSuggestions: boolean; userName?: string }, // Updated type here
  onChunk: (text: string) => void,
  onSources?: (sources: Source[]) => void,
  onThinking?: (text: string) => void,
  onSuggestions?: (suggestions: string[]) => void
): Promise<string> => {
  
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
        modelId, // Pass the selected model directly - Server handles routing!
        settings: {
          temperature: settings.temperature,
          topP: settings.topP,
          systemInstruction: finalSystemInstruction,
          aspectRatio: settings.aspectRatio,
          showSuggestions: appSettings.showSuggestions, // Pass the toggle to backend
          userName: appSettings.userName, // Pass user name to backend
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
    let buffer = ""; // Buffer for handling split chunks

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Decode the SSE chunk and append to buffer
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // Split by newlines to get complete SSE messages
      const lines = buffer.split('\n');
      
      // Keep the last line in the buffer (it might be incomplete)
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));

            if (data.error) {
              throw new Error(data.error);
            }

            if (data.thinking && onThinking) {
                onThinking(data.thinking);
            }

            if (data.text) {
              fullText += data.text;
              onChunk(data.text);
            }

            // Handle image event (instant display, not token-by-token)
            if (data.image) {
              const imgMarkdown = `\n![Generated Image](data:${data.image.mimeType};base64,${data.image.data})\n`;
              fullText += imgMarkdown;
              onChunk(imgMarkdown);
            }

            if (data.sources && onSources) {
              onSources(data.sources);
            }

            if (data.suggestions) {
              console.log("GeminiService: Received Suggestions:", data.suggestions); // DEBUG LOG
              if (onSuggestions) {
                  onSuggestions(data.suggestions);
              }
            }

            if (data.done) {
              return fullText;
            }
          } catch (e) {
            console.error("GeminiService: Parse Error on line:", line, e); // DEBUG LOG
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
 * @deprecated - Use server-side pipeline instead. Kept for legacy compatibility only.
 */
export const generateSuggestions = async (
  lastUserMessage: string,
  lastBotResponse: string
): Promise<string[]> => {
  // Logic deprecated in favor of server-side streaming
  return [];
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
