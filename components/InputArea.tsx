import React, { useState, useRef, KeyboardEvent, ChangeEvent, useEffect } from 'react';
import { ArrowUp, Plus, X, Mic, Square, FileText, Image as ImageIcon, Loader2, Upload, Paperclip, Search, SlidersHorizontal, Ratio, Palette, ChevronLeft } from 'lucide-react';
import { Attachment, PromptSettings, ModelId, ChatMessage, AspectRatio, ImageStyle } from '../types';
import { useAuth } from '../hooks/useAuth';
import { auth, storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { translations, Language, TranslationKey } from '../translations';

const GET_FILE_URI_URL = 'https://us-central1-elenor-57bde.cloudfunctions.net/getFileUri';

/**
 * Uploads file directly to Firebase Storage, then gets fileUri from Cloud Function
 * No more base64 over HTTP - direct storage upload with no size limits
 */
const uploadAttachment = async (
  file: File,
  userId: string
): Promise<{ storageUrl: string; fileUri: string }> => {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Not authenticated");

  // 1. Upload directly to Firebase Storage
  const timestamp = Date.now();
  const storagePath = `users/${userId}/attachments/${timestamp}_${file.name}`;
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, file);
  const storageUrl = await getDownloadURL(storageRef);

  // 2. Call function to get fileUri for Gemini
  const response = await fetch(GET_FILE_URI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ storagePath, mimeType: file.type })
  });

  if (!response.ok) throw new Error(`Failed to get fileUri: ${response.status}`);

  const { fileUri } = await response.json();
  return { storageUrl, fileUri };
};

interface InputAreaProps {
  onSend: (text: string, attachments: Attachment[], settings: PromptSettings, mode?: 'image' | 'research') => void;
  isLoading: boolean;
  selectedModel: ModelId;
  replyingTo?: ChatMessage | null;
  onClearReply?: () => void;
  settings: PromptSettings; // NOW REQUIRED: Passed from parent (App.tsx)
  language: string;
}

const InputArea: React.FC<InputAreaProps> = ({ onSend, isLoading, selectedModel, replyingTo, onClearReply, settings, language }) => {
  const { user } = useAuth();
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadingIndexes, setUploadingIndexes] = useState<Set<number>>(new Set());
  const [isListening, setIsListening] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  // Menu & Mode State
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [settingsMenuState, setSettingsMenuState] = useState<'main' | 'ratio' | 'style' | null>(null);
  const [activeMode, setActiveMode] = useState<'image' | 'research' | null>(null);
  const [localAspectRatio, setLocalAspectRatio] = useState<AspectRatio>('1:1');
  const [localImageStyle, setLocalImageStyle] = useState<ImageStyle>('none');
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const baseInputRef = useRef('');
  const menuRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);

  const isImageGen = selectedModel === ModelId.IMAGE_GEN || activeMode === 'image';

  const t = (key: TranslationKey) => {
      const lang = (language as Language) || 'en';
      return translations[lang]?.[key] || translations['en'][key];
  };

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  // Close menus on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target as Node)) {
        setSettingsMenuState(null);
      }
    };

    if (isMenuOpen || settingsMenuState) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen, settingsMenuState]);

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
    const isMobile = window.innerWidth < 768;
    if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
      e.preventDefault();
      handleSend();
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
      alert(t('speechUnsupported'));
      return;
    }
    baseInputRef.current = input;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognitionRef.current = recognition;
    recognition.onstart = () => setIsListening(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: { results: { [index: number]: { [index: number]: { transcript: string } }; length: number } }) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      const separator = baseInputRef.current && !baseInputRef.current.endsWith(' ') ? ' ' : '';
      setInput(baseInputRef.current + separator + transcript);
    };
    recognition.onerror = (event: { error: string }) => {
      console.error("Speech recognition error", event.error);
      setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);
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

      // Create attachments with local preview (URL.createObjectURL - fast, no base64)
      const newAttachments: Attachment[] = filesToProcess.map(file => ({
        mimeType: file.type,
        data: '',
        name: file.name,
        storageUrl: URL.createObjectURL(file), // Local preview
        _file: file // Store File object for upload
      }));

      setAttachments(prev => [...prev, ...newAttachments]);

      // Mark as uploading
      const uploadingSet = new Set<number>();
      for (let i = 0; i < newAttachments.length; i++) {
        uploadingSet.add(startIndex + i);
      }
      setUploadingIndexes(prev => new Set([...prev, ...uploadingSet]));

      // Upload each file
      filesToProcess.forEach(async (file, i) => {
        const attachmentIndex = startIndex + i;
        try {
          const { storageUrl, fileUri } = await uploadAttachment(file, user.uid);
          setAttachments(prev => prev.map((a, idx) =>
            idx === attachmentIndex
              ? { ...a, storageUrl, fileUri, _file: undefined }
              : a
          ));
        } catch (err) {
          console.error("Failed to upload", file.name, err);
        } finally {
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
    
    const finalSettings: PromptSettings = {
        ...settings,
        ...(activeMode === 'image' && { 
            aspectRatio: localAspectRatio,
            imageStyle: localImageStyle
        })
    };

    onSend(input, attachments, finalSettings, activeMode || undefined);
    
    setInput('');
    setAttachments([]);
    setActiveMode(null);
    
    if (textareaRef.current) {
        textareaRef.current.style.height = '24px';
        textareaRef.current.blur();
    }
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
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
      handleFileSelect({ target: { files: e.dataTransfer.files } } as any);
    }
  };

  const handleMenuAction = (action: 'files' | 'image' | 'research') => {
    setIsMenuOpen(false);
    if (action === 'files') {
      fileInputRef.current?.click();
    } else {
      setActiveMode(action);
    }
  };

  const clearMode = () => setActiveMode(null);

  const hasContent = input.trim().length > 0 || attachments.length > 0;
  const isUploading = uploadingIndexes.size > 0;

  const ratioOptions: { id: AspectRatio; label: TranslationKey }[] = [
      { id: '1:1', label: 'ratioSquare' }, { id: '16:9', label: 'ratioLandscape' },
      { id: '9:16', label: 'ratioPortrait' }, { id: '4:3', label: 'ratioWide' }, { id: '3:4', label: 'ratioTall' },
  ];

  const styleOptions: { id: ImageStyle; label: TranslationKey }[] = [
      { id: 'none', label: 'styleNone' }, { id: 'photorealistic', label: 'stylePhotorealistic' },
      { id: 'anime', label: 'styleAnime' }, { id: 'digital-art', label: 'styleDigitalArt' },
      { id: 'oil-painting', label: 'styleOilPainting' }, { id: 'sketch', label: 'styleSketch' },
  ];
  
  const getStyleLabel = (styleId: ImageStyle) => {
    const option = styleOptions.find(s => s.id === styleId);
    return option ? t(option.label) : 'None';
  }


  return (
    <div
        className={`bg-white dark:bg-[#0e0e10] px-3 relative transition-colors duration-200 ${isDragging ? 'bg-gray-50 dark:bg-[#1a1b1e]' : ''}`}
        style={{ paddingBottom: '6px' }}
        onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-white/95 dark:bg-[#0e0e10]/95 border-t-2 border-blue-500/50 flex flex-col items-center justify-center text-blue-500 dark:text-blue-400 animate-fade-in backdrop-blur-sm rounded-t-2xl pointer-events-none">
           <div className="p-4 rounded-full bg-blue-500/10 mb-2 animate-bounce shadow-lg shadow-blue-500/20"><Upload size={32} /></div>
           <span className="font-semibold text-lg tracking-wide">{t('dragDrop')}</span>
        </div>
      )}
      <div className="max-w-3xl mx-auto w-full flex flex-col justify-center bg-gray-100 dark:bg-[#2d2e33] rounded-[28px] p-2 transition-all border border-transparent focus-within:border-gray-300 dark:focus-within:border-gray-600 relative">
        {isMenuOpen && (
          <div ref={menuRef} className="absolute bottom-[calc(100%+8px)] left-0 bg-white dark:bg-[#1e1e1e] border border-gray-200 dark:border-[#2e2e2e] rounded-xl shadow-2xl py-1.5 min-w-[200px] z-50 overflow-hidden">
            <button onClick={() => handleMenuAction('research')} className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-[#2c2c2c] transition-colors text-gray-800 dark:text-white text-[14px]"><Search size={18} className="text-gray-500 dark:text-gray-400" />{t('actionResearch')}</button>
            <button onClick={() => handleMenuAction('image')} className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-[#2c2c2c] transition-colors text-gray-800 dark:text-white text-[14px]"><ImageIcon size={18} className="text-gray-500 dark:text-gray-400" />{t('actionCreateImage')}</button>
            <button onClick={() => handleMenuAction('files')} className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-[#2c2c2c] transition-colors text-gray-800 dark:text-white text-[14px]"><Paperclip size={18} className="text-gray-500 dark:text-gray-400" />{t('actionAddFiles')}</button>
          </div>
        )}
        <div className="px-2 pt-1">
            {replyingTo && (
                <div className="w-full mb-2 px-1 animate-slide-up">
                  <div className="flex items-center justify-between p-2 rounded-lg bg-gray-200 dark:bg-[#1a1b1e] border-l-4 border-blue-500">
                      <div className="flex-1 min-w-0">
                          <div className="text-xs font-bold text-blue-600 dark:text-blue-400 mb-0.5">Replying to {replyingTo.role === 'user' ? 'You' : 'Stilq'}</div>
                          <div className="text-xs text-gray-600 dark:text-gray-300 truncate">{replyingTo.text}</div>
                      </div>
                      <button onClick={onClearReply} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-md hover:bg-gray-300 dark:hover:bg-gray-700"><X size={14} /></button>
                  </div>
                </div>
            )}
            {activeMode && (
              <div className="w-full mb-2 px-1 animate-slide-up flex flex-wrap gap-2">
                 <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-100 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400">
                    {activeMode === 'image' ? <ImageIcon size={14} /> : <Search size={14} />}
                    <span className="text-xs font-medium capitalize">{activeMode === 'image' ? t('actionCreateImage') : t('actionResearch')}</span>
                    <button onClick={clearMode} className="ml-1 p-0.5 hover:bg-blue-200 dark:hover:bg-blue-800 rounded-full transition-colors"><X size={12} /></button>
                 </div>
                 {activeMode === 'image' && (
                     <div className="relative" ref={settingsMenuRef}>
                         <button onClick={() => setSettingsMenuState(settingsMenuState ? null : 'main')} className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border transition-colors ${settingsMenuState ? 'bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-black dark:text-white' : 'bg-gray-100 dark:bg-[#3d3e44] border-transparent text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#4d4e55]'}`}>
                             <SlidersHorizontal size={14} />
                             <span className="text-xs font-medium">{localAspectRatio}{localImageStyle !== 'none' ? ` • ${getStyleLabel(localImageStyle)}` : ''}</span>
                         </button>
                         {settingsMenuState && (
                            <div className="absolute bottom-[calc(100%+4px)] left-1/2 -translate-x-1/2 bg-white dark:bg-[#1e1e1e] border border-gray-200 dark:border-[#2e2e2e] rounded-xl shadow-xl py-1.5 min-w-[200px] z-50 overflow-hidden animate-fade-in">
                                {settingsMenuState === 'main' && (
                                    <>
                                        <button onClick={() => setSettingsMenuState('ratio')} className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-[#2c2c2c] transition-colors text-gray-800 dark:text-gray-300 text-[13px]">
                                            <div className="flex items-center gap-2"><Ratio size={14} /> {t('aspectRatio')}</div>
                                            <span className="text-gray-500">{localAspectRatio} &gt;</span>
                                        </button>
                                        <button onClick={() => setSettingsMenuState('style')} className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-[#2c2c2c] transition-colors text-gray-800 dark:text-gray-300 text-[13px]">
                                            <div className="flex items-center gap-2"><Palette size={14} /> {t('imageStyle')}</div>
                                            <span className="text-gray-500">{getStyleLabel(localImageStyle)} &gt;</span>
                                        </button>
                                    </>
                                )}
                                {settingsMenuState === 'ratio' && (
                                    <>
                                        <button onClick={() => setSettingsMenuState('main')} className="w-full text-left px-3 py-1.5 flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white text-[11px]"><ChevronLeft size={14}/> {t('back')}</button>
                                        <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
                                        {ratioOptions.map(opt => (
                                            <button key={opt.id} onClick={() => { setLocalAspectRatio(opt.id); setSettingsMenuState('main'); }} className={`w-full text-left px-3 py-2 text-[13px] hover:bg-gray-100 dark:hover:bg-[#2c2c2c] transition-colors ${localAspectRatio === opt.id ? 'text-blue-500 dark:text-blue-400 font-medium' : 'text-gray-800 dark:text-gray-300'}`}>
                                                {t(opt.label)} ({opt.id})
                                            </button>
                                        ))}
                                    </>
                                )}
                                {settingsMenuState === 'style' && (
                                    <>
                                        <button onClick={() => setSettingsMenuState('main')} className="w-full text-left px-3 py-1.5 flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white text-[11px]"><ChevronLeft size={14}/> {t('back')}</button>
                                        <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
                                        {styleOptions.map(opt => (
                                            <button key={opt.id} onClick={() => { setLocalImageStyle(opt.id); setSettingsMenuState('main'); }} className={`w-full text-left px-3 py-2 text-[13px] hover:bg-gray-100 dark:hover:bg-[#2c2c2c] transition-colors ${localImageStyle === opt.id ? 'text-blue-500 dark:text-blue-400 font-medium' : 'text-gray-800 dark:text-gray-300'}`}>
                                                {t(opt.label)}
                                            </button>
                                        ))}
                                    </>
                                )}
                            </div>
                         )}
                     </div>
                 )}
              </div>
            )}
            {attachments.length > 0 && (
                <div className="flex gap-3 overflow-x-auto mb-2 py-2 scrollbar-hide w-full">
                {attachments.map((att, i) => (
                    <div key={i} className="relative group flex-shrink-0">
                    {att.mimeType.startsWith('image/') ? (
                        <div className="relative">
                        <img src={att.storageUrl || `data:${att.mimeType};base64,${att.data}`} alt="preview" className="h-16 w-16 object-cover rounded-xl border border-gray-300 dark:border-gray-700"/>
                        {uploadingIndexes.has(i) && <div className="absolute inset-0 bg-black/50 rounded-xl flex items-center justify-center"><Loader2 size={20} className="text-white animate-spin" /></div>}
                        </div>
                    ) : (
                        <div className="relative h-16 w-16 bg-gray-200 dark:bg-gray-800 rounded-xl border border-gray-300 dark:border-gray-700 flex flex-col items-center justify-center text-center p-1">
                        <FileText size={24} className="text-gray-500 dark:text-gray-400 mb-1"/><span className="text-[9px] text-gray-600 dark:text-gray-300 truncate w-full leading-tight px-0.5">{att.name?.slice(0, 10)}</span>
                        {uploadingIndexes.has(i) && <div className="absolute inset-0 bg-black/50 rounded-xl flex items-center justify-center"><Loader2 size={20} className="text-white animate-spin" /></div>}
                        </div>
                    )}
                    <button onClick={() => removeAttachment(i)} className="absolute -top-2 -right-2 bg-gray-300 dark:bg-gray-700 text-gray-700 dark:text-white rounded-full p-1 border border-gray-400 dark:border-gray-600 shadow-md hover:bg-gray-400 dark:hover:bg-gray-600 transition-colors z-10"><X size={10} /></button>
                    </div>
                ))}
                </div>
            )}
        </div>
        <div className="flex items-end gap-2 w-full">
            <button onClick={() => setIsMenuOpen(!isMenuOpen)} className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors flex-shrink-0 ${isMenuOpen ? 'bg-gray-200 dark:bg-[#3d3e44] text-black dark:text-white' : 'hover:bg-gray-200 dark:hover:bg-[#3d3e44] text-gray-500 dark:text-gray-300'}`} title="Add..."><Plus size={22} className={`transition-transform duration-200 ${isMenuOpen ? 'rotate-45' : ''}`} /></button>
            <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept="image/*,video/*,application/pdf,text/plain,text/csv,.pdf,.txt,.js,.ts,.py,.java,.c,.cpp,.h,.html,.css,.json,.md" multiple />
            <textarea ref={textareaRef} value={input} onChange={handleInput} onKeyDown={handleKeyDown} placeholder={isImageGen ? t('imagePlaceholder') : t('placeholder')} className={`flex-1 bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none resize-none overflow-y-auto leading-6 text-[16px] py-1.5 ${isListening ? 'animate-pulse placeholder-blue-500 dark:placeholder-blue-400' : ''}`} rows={1} style={{ height: '28px', maxHeight: '120px' }} />
            {(!input.trim() || isListening) && !hasContent && (
                <button onClick={toggleListening} className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 flex-shrink-0 ${isListening ? 'text-red-500 animate-pulse' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-[#3d3e44]'}`} title="Dictate">{isListening ? <Square size={18} fill="currentColor" /> : <Mic size={22} />}</button>
            )}
            <button onClick={handleSend} disabled={!hasContent || isLoading || isUploading} className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 flex-shrink-0 ${hasContent && !isLoading && !isUploading ? 'bg-black dark:bg-white text-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-200 shadow-md scale-100' : 'bg-gray-200 dark:bg-[#3d3e44] text-gray-400 dark:text-gray-500 cursor-not-allowed scale-90'}`} title={isUploading ? 'Uploading files...' : ''}>{isUploading ? <Loader2 size={20} className="animate-spin" /> : isImageGen ? <ImageIcon size={20} /> : <ArrowUp size={22} strokeWidth={2.5} />}</button>
        </div>
      </div>
      <div className="text-center mt-3 text-[10px] text-gray-500 dark:text-gray-600 font-medium tracking-wide">{t('footerDisclaimer')}</div>
    </div>
  );
};

export default InputArea;
