import React, { useState, useRef, KeyboardEvent, ChangeEvent, useEffect } from 'react';
import { ArrowUp, Plus, X, Mic, Square, FileText, Image as ImageIcon, Loader2, Upload } from 'lucide-react';
import { Attachment, PromptSettings, ModelId, ChatMessage } from '../types';
import { fileToBase64 } from '../services/geminiService';
import { useAuth } from '../hooks/useAuth';
import { storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// MIME type to file extension mapping
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv'
};

/**
 * Uploads attachment to Firebase Storage
 * Returns the download URL
 */
const uploadAttachmentToStorage = async (
  base64Data: string,
  mimeType: string,
  userId: string,
  originalName?: string
): Promise<string> => {
  try {
    // Validate size (20MB limit)
    if (base64Data.length > 28 * 1024 * 1024) {
      throw new Error("File too large (max 20MB)");
    }

    // Decode base64
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType });

    // Get file extension
    let fileName = '';
    const timestamp = Date.now();

    if (originalName) {
        // Use original extension if available
        const parts = originalName.split('.');
        if (parts.length > 1) {
            const ext = parts.pop();
            fileName = `${timestamp}_${parts.join('.')}.${ext}`;
        } else {
             fileName = `${timestamp}_${originalName}`;
        }
    } else {
         // Fallback to MIME mapping
         const ext = MIME_TO_EXT[mimeType] || 'bin';
         fileName = `${timestamp}.${ext}`;
    }

    // Upload to Storage
    const storageRef = ref(storage, `users/${userId}/uploads/${fileName}`);
    await uploadBytes(storageRef, blob);

    // Get download URL
    return await getDownloadURL(storageRef);
  } catch (e: any) {
    console.error("Upload failed:", e);
    throw new Error(`Upload failed: ${e.message}`);
  }
};

interface InputAreaProps {
  onSend: (text: string, attachments: Attachment[], settings: PromptSettings) => void;
  isLoading: boolean;
  selectedModel: ModelId;
  replyingTo?: ChatMessage | null;
  onClearReply?: () => void;
  initialText?: string; // New prop to populate text
  onClearInitialText?: () => void; // Callback to clear prop after setting
  settings: PromptSettings; // NOW REQUIRED: Passed from parent (App.tsx)
}

const InputArea: React.FC<InputAreaProps> = ({ onSend, isLoading, selectedModel, replyingTo, onClearReply, initialText, onClearInitialText, settings }) => {
  const { user } = useAuth();
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadingIndexes, setUploadingIndexes] = useState<Set<number>>(new Set());
  const [isListening, setIsListening] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const baseInputRef = useRef('');

  const isImageGen = selectedModel === ModelId.IMAGE_GEN;

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  // Handle external initial text (e.g. suggestions)
  useEffect(() => {
    if (initialText) {
        setInput(initialText);
        if (onClearInitialText) onClearInitialText();
        // Focus the textarea after a short delay to ensure UI is ready
        setTimeout(() => {
             textareaRef.current?.focus();
             adjustHeight();
        }, 50);
    }
  }, [initialText, onClearInitialText]);

  const handleInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    adjustHeight();
  };

  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [input]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Check if on mobile (screen width < 768px)
    const isMobile = window.innerWidth < 768;

    if (e.key === 'Enter' && !e.shiftKey) {
      if (!isMobile) {
          // Desktop: Prevent default (newline) and send
          e.preventDefault();
          handleSend();
      }
      // Mobile: Do nothing (let default behavior happen = newline)
    }
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    baseInputRef.current = input;
    
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      
      const separator = baseInputRef.current && !baseInputRef.current.endsWith(' ') ? ' ' : '';
      setInput(baseInputRef.current + separator + transcript);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };

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
        try {
          const base64 = await fileToBase64(file);
          newAttachments.push({
            mimeType: file.type,
            data: base64,
            name: file.name
          });
        } catch (err) {
          console.error("Failed to read file", err);
        }
      }

      // 2. Add ALL attachments at once
      setAttachments(prev => [...prev, ...newAttachments]);

      // 3. Mark ALL as uploading
      const uploadingSet = new Set<number>();
      for (let i = 0; i < newAttachments.length; i++) {
        uploadingSet.add(startIndex + i);
      }
      setUploadingIndexes(prev => new Set([...prev, ...uploadingSet]));

      // 4. Upload ALL in parallel
      newAttachments.forEach(async (att, i) => {
        const attachmentIndex = startIndex + i;
        try {
          console.log('Uploading', att.name, 'to Storage...');
          const storageUrl = await uploadAttachmentToStorage(att.data!, att.mimeType, user.uid, att.name);
          console.log('Uploaded:', att.name, '→', storageUrl);

          // 5. Add storageUrl (keep data for Gemini)
          setAttachments(prev => prev.map((a, idx) =>
            idx === attachmentIndex
              ? { ...a, storageUrl }
              : a
          ));

          // 6. Remove from uploading
          setUploadingIndexes(prev => {
            const updated = new Set(prev);
            updated.delete(attachmentIndex);
            return updated;
          });
        } catch (err: any) {
          console.error("Failed to upload", att.name, err);
          setUploadingIndexes(prev => {
            const updated = new Set(prev);
            updated.delete(attachmentIndex);
            return updated;
          });
        }
      });

      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = () => {
    if ((!input.trim() && attachments.length === 0) || isLoading) return;

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    }

    onSend(input, attachments, settings);
    setInput('');
    setAttachments([]);
    if (textareaRef.current) {
        textareaRef.current.style.height = '24px';
        textareaRef.current.blur();
    }
  };

  // --- Drag and Drop Handlers ---
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    // Prevent flickering when dragging over children
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (!user?.uid) {
      alert("Please sign in to upload files");
      return;
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const filesToProcess = Array.from(e.dataTransfer.files);
      const startIndex = attachments.length;

      // 1. Convert ALL files to base64 first
      const newAttachments: Attachment[] = [];
      for (const file of filesToProcess) {
        try {
          const base64 = await fileToBase64(file);
          newAttachments.push({
            mimeType: file.type,
            data: base64,
            name: file.name
          });
        } catch (err) {
          console.error("Failed to read file", err);
        }
      }

      // 2. Add ALL attachments at once
      setAttachments(prev => [...prev, ...newAttachments]);

      // 3. Mark ALL as uploading
      const uploadingSet = new Set<number>();
      for (let i = 0; i < newAttachments.length; i++) {
        uploadingSet.add(startIndex + i);
      }
      setUploadingIndexes(prev => new Set([...prev, ...uploadingSet]));

      // 4. Upload ALL in parallel
      newAttachments.forEach(async (att, i) => {
        const attachmentIndex = startIndex + i;
        try {
          console.log('Uploading', att.name, 'to Storage...');
          const storageUrl = await uploadAttachmentToStorage(att.data!, att.mimeType, user.uid, att.name);
          console.log('Uploaded:', att.name, '→', storageUrl);

          // 5. Add storageUrl (keep data for Gemini)
          setAttachments(prev => prev.map((a, idx) =>
            idx === attachmentIndex
              ? { ...a, storageUrl }
              : a
          ));

          // 6. Remove from uploading
          setUploadingIndexes(prev => {
            const updated = new Set(prev);
            updated.delete(attachmentIndex);
            return updated;
          });
        } catch (err: any) {
          console.error("Failed to upload", att.name, err);
          setUploadingIndexes(prev => {
            const updated = new Set(prev);
            updated.delete(attachmentIndex);
            return updated;
          });
        }
      });
    }
  };

  const hasContent = input.trim().length > 0 || attachments.length > 0;
  const isUploading = uploadingIndexes.size > 0;

  return (
    <div
        className={`bg-white dark:bg-[#0e0e10] px-3 pt-3 relative transition-colors duration-200 ${isDragging ? 'bg-gray-50 dark:bg-[#1a1b1e]' : ''}`}
        style={{ paddingBottom: '6px' }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
    >
      {/* Drag Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-white/95 dark:bg-[#0e0e10]/95 border-t-2 border-blue-500/50 flex flex-col items-center justify-center text-blue-500 dark:text-blue-400 animate-fade-in backdrop-blur-sm rounded-t-2xl pointer-events-none">
           <div className="p-4 rounded-full bg-blue-500/10 mb-2 animate-bounce shadow-lg shadow-blue-500/20">
             <Upload size={32} />
           </div>
           <span className="font-semibold text-lg tracking-wide">Drop files to attach</span>
        </div>
      )}
      
      {/* Quote Reply Preview */}
      {replyingTo && (
        <div className="max-w-3xl mx-auto w-full mb-2 px-1 animate-slide-up">
          <div className="flex items-center justify-between p-2 rounded-lg bg-gray-100 dark:bg-[#1a1b1e] border-l-4 border-blue-500">
             <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-blue-600 dark:text-blue-400 mb-0.5">
                   Replying to {replyingTo.role === 'user' ? 'You' : 'Elora'}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-300 truncate">
                   {replyingTo.text}
                </div>
             </div>
             <button 
               onClick={onClearReply}
               className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700"
             >
               <X size={14} />
             </button>
          </div>
        </div>
      )}

      {/* Attachment Previews */}
      {attachments.length > 0 && (
        <div className="flex gap-3 overflow-x-auto px-4 mb-3 py-2 scrollbar-hide max-w-3xl mx-auto w-full">
          {attachments.map((att, i) => (
            <div key={i} className="relative group flex-shrink-0">
              {att.mimeType.startsWith('image/') ? (
                <div className="relative">
                  <img
                    src={att.storageUrl || `data:${att.mimeType};base64,${att.data}`}
                    alt="preview"
                    className="h-16 w-16 object-cover rounded-xl border border-gray-300 dark:border-gray-700"
                  />
                  {uploadingIndexes.has(i) && (
                    <div className="absolute inset-0 bg-black/50 rounded-xl flex items-center justify-center">
                      <Loader2 size={20} className="text-white animate-spin" />
                    </div>
                  )}
                </div>
              ) : (
                <div className="relative h-16 w-16 bg-gray-100 dark:bg-gray-800 rounded-xl border border-gray-300 dark:border-gray-700 flex flex-col items-center justify-center text-center p-1">
                   <FileText size={24} className="text-gray-500 dark:text-gray-400 mb-1"/>
                   <span className="text-[9px] text-gray-600 dark:text-gray-300 truncate w-full leading-tight px-0.5">{att.name?.slice(0, 10)}</span>
                   {uploadingIndexes.has(i) && (
                    <div className="absolute inset-0 bg-black/50 rounded-xl flex items-center justify-center">
                      <Loader2 size={20} className="text-white animate-spin" />
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={() => removeAttachment(i)}
                className="absolute -top-2 -right-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-white rounded-full p-1 border border-gray-300 dark:border-gray-600 shadow-md hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors z-10"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="max-w-3xl mx-auto w-full flex items-end gap-2 justify-center">
        
        {/* Plus / File Button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-10 h-10 rounded-full bg-gray-100 dark:bg-[#2d2e33] hover:bg-gray-200 dark:hover:bg-[#3d3e44] text-gray-500 dark:text-gray-300 flex items-center justify-center transition-colors flex-shrink-0 mb-1"
          title="Add File"
        >
          <Plus size={22} />
        </button>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          className="hidden"
          accept="image/*,application/pdf,text/plain,text/csv,.pdf,.txt,.js,.ts,.py,.java,.c,.cpp,.h,.html,.css,.json,.md"
          multiple
        />

        {/* Input Pill (Expanded to fill more space) */}
        <div className="flex-1 max-w-[80%] bg-gray-100 dark:bg-[#2d2e33] rounded-[24px] min-h-[50px] flex items-center px-4 py-2 transition-all border border-transparent focus-within:border-gray-300 dark:focus-within:border-gray-600">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={isImageGen ? "Describe the image you want to generate..." : "Message Elora..."}
            className={`flex-1 bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none resize-none overflow-y-auto leading-6 text-[16px] py-1 ${isListening ? 'animate-pulse placeholder-blue-500 dark:placeholder-blue-400' : ''}`}
            rows={1}
            style={{ height: '24px', maxHeight: '120px' }}
          />
          
          {/* Mic Icon (inside pill) - Hidden when typing */}
          {(!input.trim() || isListening) && (
            <button
                onClick={toggleListening}
                className={`ml-2 p-1 rounded-full transition-all duration-200 ${
                isListening 
                    ? 'text-red-500 animate-pulse' 
                    : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'
                }`}
                title="Dictate"
            >
                {isListening ? <Square size={18} fill="currentColor" /> : <Mic size={22} />}
            </button>
          )}
        </div>

        {/* Send Button (Circular) */}
        <button
          onClick={handleSend}
          disabled={!hasContent || isLoading || isUploading}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 flex-shrink-0 mb-1 ${
            hasContent && !isLoading && !isUploading
              ? 'bg-black dark:bg-white text-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-200 shadow-lg scale-100'
              : 'bg-gray-100 dark:bg-[#2d2e33] text-gray-400 dark:text-gray-500 cursor-not-allowed'
          }`}
          title={isUploading ? 'Uploading files...' : ''}
        >
          {isUploading ? <Loader2 size={20} className="animate-spin" /> : isImageGen ? <ImageIcon size={20} /> : <ArrowUp size={22} strokeWidth={2.5} />}
        </button>
      </div>
      
      <div className="text-center mt-3 text-[10px] text-gray-500 dark:text-gray-600 font-medium tracking-wide">
        Elora can make mistakes, so double-check important information.
      </div>
    </div>
  );
};

export default InputArea;
