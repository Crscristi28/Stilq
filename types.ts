
export enum Role {
  USER = 'user',
  MODEL = 'model',
}

export enum ModelId {
  LITE = 'gemini-2.5-flash-lite', // The Router/Suggester
  FLASH = 'gemini-2.5-flash', // The Standard Chat
  PRO = 'gemini-3-pro-preview', // The Brain
  IMAGE_GEN = 'gemini-2.5-flash-image', // The Artist
}

export interface Attachment {
  mimeType: string;
  data?: string; // base64 (Local preview)
  storageUrl?: string; // Firebase Storage URL (Remote persistence)
  name?: string;
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
    id: ModelId.FLASH,
    name: 'Elora Flash',
    description: 'Fast, efficient, and versatile',
    icon: 'Zap',
  },
  {
    id: ModelId.PRO,
    name: 'Elora Pro',
    description: 'Advanced reasoning and complex tasks',
    icon: 'Brain',
  },
  {
    id: ModelId.IMAGE_GEN,
    name: 'Elora Imagine',
    description: 'Generate images from text',
    icon: 'Image',
  },
];

// --- Prompt Engineering Types ---

export type ToneStyle = 'normal' | 'learning' | 'concise' | 'explanatory' | 'formal';
export type AspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';

export interface PromptSettings {
  style: ToneStyle;
  systemInstruction?: string;
  temperature: number;
  topP: number;
  aspectRatio?: AspectRatio;
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
}
