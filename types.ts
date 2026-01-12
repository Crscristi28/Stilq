
export enum Role {
  USER = 'user',
  MODEL = 'model',
}

export enum ModelId {
  AUTO = 'auto', // The Smart Router
  LITE = 'gemini-2.5-flash-lite', // The Router/Suggester
  FLASH = 'gemini-3-flash-preview', // The Standard Chat
  PRO = 'gemini-3-pro-preview', // The Brain (low limits)
  PRO_25 = 'gemini-2.5-pro', // Stable Pro (high limits)
  PRO_IMAGE = 'gemini-3-pro-image-preview', // Creative model (text + image output)
  IMAGE_GEN = 'gemini-2.5-flash-image', // The Artist
  RESEARCH = 'research', // Deep Research (maps to gemini-2.5-pro on backend)
}

export interface Attachment {
  mimeType: string;
  data?: string; // base64 (Local preview)
  storageUrl?: string; // Firebase Storage URL (Remote persistence)
  fileUri?: string; // Google AI File API URI (for Gemini, no size limit)
  name?: string;
  isPlaceholder?: boolean; // For skeleton loading states
  aspectRatio?: string; // For placeholders to match dimensions (e.g. "16:9")
  isGraph?: boolean; // True for graphs from codeExecution (rendered inline with marker)
}

export interface Source {
  title: string;
  url: string;
}

export interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  attachments?: Attachment[];
  isStreaming?: boolean;
  timestamp: number;
  error?: boolean;
  suggestions?: string[]; // New field for follow-up questions
  sources?: Source[]; // New field for citations/sources
  thinking?: string; // The internal monologue/reasoning process
  thinkingHeader?: string; // Current thinking step (extracted bold header)
}

export interface ChatSession {
  id: string;
  userId?: string; // Link to Firebase User ID
  title: string;
  messages: ChatMessage[]; // Note: In Firestore, this will be a subcollection, not an array field
  createdAt: number;
  updatedAt: number;
  modelId?: ModelId;
}

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  isPro?: boolean; // For Stripe/Monetization
}

export interface ModelConfig {
  id: ModelId;
  name: string;
  description: string;
  icon: string;
}

export const MODELS: ModelConfig[] = [
  {
    id: ModelId.AUTO,
    name: 'Stilq Auto',
    description: 'Smartly selects the best model for you',
    icon: 'Sparkles',
  },
  {
    id: ModelId.FLASH,
    name: 'Stilq Flash',
    description: 'Fast, efficient, and versatile',
    icon: 'Zap',
  },
  {
    id: ModelId.PRO,
    name: 'Stilq Pro',
    description: 'Advanced reasoning and complex tasks',
    icon: 'Brain',
  },
  {
    id: ModelId.PRO_25,
    name: 'Stilq Pro 2.5',
    description: 'Stable Pro with high limits',
    icon: 'Cpu',
  },
  {
    id: ModelId.PRO_IMAGE,
    name: 'Stilq Creative',
    description: 'Stories with native image generation',
    icon: 'Palette',
  },
];

// --- Prompt Engineering Types ---

export type ToneStyle = 'normal' | 'learning' | 'concise' | 'explanatory' | 'formal';
export type AspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
export type ImageStyle = 'none' | 'photorealistic' | 'anime' | 'digital-art' | 'oil-painting' | 'sketch';

export interface PromptSettings {
  style: ToneStyle;
  systemInstruction?: string;
  aspectRatio?: AspectRatio;
  imageStyle?: ImageStyle;
}

export const TONE_PROMPTS: Record<ToneStyle, string> = {
  normal: '',
  learning: 'You are a patient and educational tutor. Break down complex topics into simple, understandable parts. Use analogies where helpful and check for understanding.',
  concise: 'Be extremely brief and direct. Eliminate all unnecessary fluff and filler. Provide only the essential information requested.',
  explanatory: 'Provide comprehensive and detailed explanations. Cover the background, context, and nuances of the topic. Use examples to illustrate key points.',
  formal: 'Maintain a strictly professional and formal tone. Use precise terminology, structured formatting, and avoid colloquialisms.',
};

// --- App Settings ---

export interface AppSettings {
  theme: 'system' | 'dark' | 'light';
  enterToSend: boolean;
  defaultVoiceURI: string;
  defaultSpeechRate: number;
  language: string;
  showSuggestions: boolean;
  userName?: string; // Added user alias
}

// --- Gemini API Types ---

export interface GeminiContentPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  executableCode?: { code: string; language: string };
  codeExecutionResult?: { output: string };
}

export interface GeminiGroundingChunk {
  web?: { uri: string; title: string };
}

export interface GeminiCandidate {
  content?: {
    parts?: GeminiContentPart[];
  };
  groundingMetadata?: {
    groundingChunks?: GeminiGroundingChunk[];
  };
}

export interface GeminiResponse {
  text?: string;
  response?: {
    candidates?: GeminiCandidate[];
    usageMetadata?: {
      promptTokenCount: number;
      candidatesTokenCount: number;
    };
  };
}

// --- Tool Types ---

export interface FunctionParameter {
  type: string;
  description: string;
  enum?: string[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, FunctionParameter>;
    required: string[];
  };
}

export interface GeminiTool {
  googleSearch?: Record<string, never>;
  codeExecution?: Record<string, never>;
  urlContext?: Record<string, never>;
  functionDeclarations?: FunctionDeclaration[];
}

// --- Component Types ---

export interface SettingsOption {
  value: string;
  label: string;
}

export interface VoiceOption {
  voiceURI: string;
  name: string;
  lang: string;
}

// --- Speech Recognition Types ---

export interface SpeechRecognitionResult {
  transcript: string;
  confidence: number;
}

export interface SpeechRecognitionEvent {
  results: {
    [index: number]: {
      [index: number]: SpeechRecognitionResult;
    };
    length: number;
  };
  resultIndex: number;
}

export interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}
