import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { ChatMessage, Role, Attachment, ModelId, MODELS, ChatSession, PromptSettings, AppSettings, Source } from './types';
import MessageList from './components/MessageList';
import InputArea from './components/InputArea';
import ChatLoadingOverlay from './components/ChatLoadingOverlay';
import Sidebar from './components/Sidebar';
import SettingsModal from './components/SettingsModal';
import { Lightbox } from './components/Lightbox';
import { streamChatResponse } from './services/geminiService';
import { uploadGeneratedImage } from './services/transformService';
import { ChevronDown, Zap, Brain, Menu, Image as ImageIcon, Check, Sparkles, Cpu } from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import { useFirestoreSync } from './hooks/useFirestoreSync';
import { signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import { translations, Language, TranslationKey } from './translations';

const App: React.FC = () => {
  const { user, loading: authLoading } = useAuth();

  const {
    sessions,
    messages,
    currentSessionId,
    setCurrentSessionId,
    loading: sessionsLoading,
    addMessageToDb,
    updateMessageInDb,
    createNewChatInDb,
    deleteChatInDb,
    renameChatInDb,
    fetchUserNameFromDb,
    saveUserNameToDb,
  } = useFirestoreSync();

  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelId>(ModelId.AUTO);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [suggestionText, setSuggestionText] = useState<string>('');
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  
  // Streaming State (UI Only)
  const [streamingMessage, setStreamingMessage] = useState<ChatMessage | null>(null);

  // Refs for Smooth Streaming & Data Safety
  // These exist outside the render cycle to handle high-frequency updates
  const streamBufferRef = useRef<string>("");
  const streamThinkingRef = useRef<string>("");
  const streamThinkingHeaderRef = useRef<string>("");
  const streamSourcesRef = useRef<Source[]>([]);
  const streamSuggestionsRef = useRef<string[]>([]);
  const streamAttachmentsRef = useRef<Attachment[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const isStreamingRef = useRef<boolean>(false);
  const dbDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [minFooterHeight, setMinFooterHeight] = useState<number>(100); // Default 100px
  const [routedModel, setRoutedModel] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState<boolean>(false);
  const [currentMode, setCurrentMode] = useState<'image' | 'research' | null>(null);
  const [isLoadingExistingChat, setIsLoadingExistingChat] = useState(false);

  const inputAreaRef = useRef<HTMLDivElement>(null);

  // Helper to detect system language
  const getSystemLanguage = (): string => {
      if (typeof navigator !== 'undefined') {
          const lang = navigator.language.split('-')[0];
          const supportedLanguages = ['en', 'cs', 'ro', 'de', 'it', 'ru'];
          return supportedLanguages.includes(lang) ? lang : 'en';
      }
      return 'en';
  };

  // Resolve language - if 'system', detect from browser, otherwise use saved value
  const resolveLanguage = (lang: string): string => {
      return lang === 'system' ? getSystemLanguage() : lang;
  };

  // --- SETTINGS (Stays Local) ---
  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    try {
        const saved = localStorage.getItem('stilq_settings_v1');
        if (saved) {
            return JSON.parse(saved);
        }
        // Default with system language detection
        return {
            theme: 'system',
            enterToSend: true,
            defaultVoiceURI: '',
            defaultSpeechRate: 1.0,
            language: 'system',
            showSuggestions: true
        };
    } catch {
        return {
            theme: 'system',
            enterToSend: true,
            defaultVoiceURI: '',
            defaultSpeechRate: 1.0,
            language: 'system',
            showSuggestions: true
        }; 
    }
  });

  const t = (key: TranslationKey) => {
      const lang = resolveLanguage(appSettings.language) as Language;
      return translations[lang]?.[key] || translations['en'][key];
  };

  const getModelName = (id: ModelId) => {
    switch (id) {
        case ModelId.AUTO: return t('modelAuto');
        case ModelId.FLASH: return t('modelFlash');
        case ModelId.PRO: return t('modelPro');
        case ModelId.IMAGE_GEN: return t('modelImagine');
        default: return id;
    }
  };

  // Cloud sync state - don't save until we've fetched from cloud first
  const hasCheckedCloudRef = useRef(false);
  const lastCloudValueRef = useRef<string | null>(null);
  const userNameSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch userName from Firestore on every app load - cloud is ALWAYS source of truth
  useEffect(() => {
      if (!user?.uid) {
          hasCheckedCloudRef.current = false;
          return;
      }

      fetchUserNameFromDb().then(cloudName => {
          hasCheckedCloudRef.current = true;
          lastCloudValueRef.current = cloudName; // Track what cloud had

          if (cloudName) {
              // Cloud has a value - ALWAYS use it, ignore localStorage
              setAppSettings(prev => ({ ...prev, userName: cloudName }));
          } else {
              // Cloud is empty - this is first time setup
              // Use Google name as default and save to cloud
              const defaultName = user.displayName?.split(' ')[0] || 'User';
              setAppSettings(prev => ({ ...prev, userName: defaultName }));
              saveUserNameToDb(defaultName);
              lastCloudValueRef.current = defaultName; // We just saved this
          }
      });
  }, [user?.uid]);

  // Save userName to Firestore when user changes it in settings
  useEffect(() => {
      // Don't save until we've checked cloud first (prevents overwriting with stale localStorage)
      if (!hasCheckedCloudRef.current) return;
      if (!user?.uid || appSettings.userName === undefined) return;
      // Skip if value is same as what we fetched from cloud (prevents redundant writes)
      if (appSettings.userName === lastCloudValueRef.current) return;

      // Debounce: wait 500ms after last change before saving
      if (userNameSaveTimerRef.current) clearTimeout(userNameSaveTimerRef.current);
      userNameSaveTimerRef.current = setTimeout(() => {
          saveUserNameToDb(appSettings.userName!);
          lastCloudValueRef.current = appSettings.userName!; // Update ref after save
      }, 500);

      return () => {
          if (userNameSaveTimerRef.current) clearTimeout(userNameSaveTimerRef.current);
      };
  }, [appSettings.userName, user?.uid]);

  // --- PROMPT SETTINGS (Global/Session State) ---
  const [promptSettings, setPromptSettings] = useState<PromptSettings>({
    style: 'normal',
    systemInstruction: '',
    aspectRatio: '1:1'
  });

  useEffect(() => {
    const root = window.document.documentElement;
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    const applyTheme = (isDark: boolean) => {
      root.classList.toggle('dark', isDark);
      metaThemeColor?.setAttribute('content', isDark ? '#0e0e10' : '#ffffff');
      // Force repaint to handle Tailwind transitions better
      root.style.display = 'none';
      root.offsetHeight; 
      root.style.display = '';
    };
    if (appSettings.theme === 'system') {
      const systemIsDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      applyTheme(systemIsDark);
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    } else {
      applyTheme(appSettings.theme === 'dark');
    }
  }, [appSettings.theme]);

  useEffect(() => {
    localStorage.setItem('stilq_settings_v1', JSON.stringify(appSettings));
  }, [appSettings]);

  // --- FEATURE: Handle deleted session ---
  useEffect(() => {
    if (currentSessionId && !sessions.find(s => s.id === currentSessionId)) {
      // Current session was deleted - switch to first available or reset to new chat
      setCurrentSessionId(sessions.length > 0 ? sessions[0].id : null);
    }
  }, [sessions, currentSessionId, setCurrentSessionId]);

  // Measure input area height for dynamic footer
  useEffect(() => {
    const measureInputHeight = () => {
      if (inputAreaRef.current) {
        const height = inputAreaRef.current.offsetHeight;
        setMinFooterHeight(height + 20); // Add 20px padding
      }
    };

    // Measure on mount and when window resizes
    measureInputHeight();
    window.addEventListener('resize', measureInputHeight);

    // Also measure after a short delay to ensure layout is stable
    const timer = setTimeout(measureInputHeight, 100);

    return () => {
      window.removeEventListener('resize', measureInputHeight);
      clearTimeout(timer);
    };
  }, []);

  // --- HANDLERS (Now talk to Firestore) ---

  const handleLogin = async () => {
      try { await signInWithPopup(auth, googleProvider); }
      catch (error) { console.error("Login failed", error); alert("Login failed. Check Firebase config and authorized domains."); }
  };

  const createNewChat = async () => {
      // Just reset current ID to null.
      // The actual DB creation happens in handleSendMessage
      setCurrentSessionId(null);
      setIsLoadingExistingChat(false); // New chat = no loading overlay
      setIsLoading(false);
      setReplyingTo(null);
      if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const handleEditMessage = async (messageId: string, newText: string) => {
      if (!currentSessionId) return;
      await updateMessageInDb(currentSessionId, messageId, { text: newText });
  };

  const handleReply = (message: ChatMessage) => {
    setReplyingTo(message);
  };

  const handleClearReply = () => {
    setReplyingTo(null);
  };

  const handleSuggestionClick = (text: string) => {
    setSuggestionText(text);
  };

  const handleClearSuggestion = () => {
    setSuggestionText('');
  };

  // --- MAIN SEND HANDLER (Optimized for Smoothness & Safety) ---
  const handleSendMessage = useCallback(async (text: string, attachments: Attachment[], settings: PromptSettings, mode?: 'image' | 'research') => {
    if (!user?.uid) return;

    // Auto-create chat if none exists
    let sessionId = currentSessionId;
    let isNewSession = false; // Flag to track if we just created this session

    if (!sessionId) {
      const newSession: Omit<ChatSession, 'messages'> = {
        id: Date.now().toString(),
        title: 'New Chat',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      const newId = await createNewChatInDb(newSession);
      if (!newId) return;
      setIsLoadingExistingChat(false); // New session = no loading overlay
      setCurrentSessionId(newId);
      sessionId = newId;
      isNewSession = true; // Mark as new
    }

    let finalText = replyingTo ? `> ${replyingTo.text.split('\n').join('\n> ')}\n\n${text}` : text;
    setReplyingTo(null);

    // --- FEATURE: Auto-title from first message ---
    // If it's a freshly created session OR existing session with empty messages (and title New Chat)
    const currentSession = sessions.find(s => s.id === sessionId);
    const shouldUpdateTitle = isNewSession || (messages.length === 0 && currentSession?.title === 'New Chat');
    
    if (shouldUpdateTitle) {
      const newTitle = text.slice(0, 30) + (text.length > 30 ? '...' : '');
      await renameChatInDb(sessionId, newTitle);
    }

    // Strip base64 data from attachments before saving to Firestore (keep only storageUrl)
    const attachmentsForDb = attachments.map(att => ({
      mimeType: att.mimeType,
      storageUrl: att.storageUrl,
      name: att.name
      // NO data field - would exceed Firestore 1MB limit
    }));

    const newUserMsg: ChatMessage = {
      id: Date.now().toString(),
      role: Role.USER,
      text: finalText,
      attachments: attachmentsForDb,
      timestamp: Date.now(),
    };

    // Show loading indicator IMMEDIATELY (before DB operations)
    setIsLoading(true);
    setRoutedModel(null);
    setIsGeneratingImage(false);

    await addMessageToDb(sessionId, newUserMsg);

    const botMsgId = (Date.now() + 1).toString();
    const botMsgPlaceholder: ChatMessage = {
      id: botMsgId,
      role: Role.MODEL,
      text: '',
      isStreaming: true,
      timestamp: Date.now(),
    };
    const newBotMessageId = await addMessageToDb(sessionId, botMsgPlaceholder);
    if (!newBotMessageId) {
      setIsLoading(false);
      return;
    }

    // --- STREAMING SETUP ---
    // 1. Reset Refs
    streamBufferRef.current = "";
    streamThinkingRef.current = "";
    streamThinkingHeaderRef.current = "";
    streamSourcesRef.current = [];
    streamSuggestionsRef.current = [];
    streamAttachmentsRef.current = [];
    isStreamingRef.current = true;

    // Set current mode for indicators
    setCurrentMode(mode || null);

    // Determine which model to use (Mode Overrides)
    const modelToUse = mode === 'image' ? ModelId.IMAGE_GEN
                     : mode === 'research' ? ModelId.RESEARCH
                     : selectedModel;
    
    // 2. Start Animation Loop (Instant display - no char-by-char delay)
    const updateUiLoop = () => {
        if (!isStreamingRef.current) return;

        setStreamingMessage(prev => {
            // Optimization: Only rerender if data actually changed
            if (prev?.text === streamBufferRef.current &&
                prev?.thinking === streamThinkingRef.current &&
                prev?.thinkingHeader === streamThinkingHeaderRef.current &&
                prev?.sources === streamSourcesRef.current &&
                prev?.suggestions === streamSuggestionsRef.current &&
                prev?.attachments === streamAttachmentsRef.current) {
                return prev;
            }
            return {
                id: newBotMessageId,
                role: Role.MODEL,
                text: streamBufferRef.current, // Direct display - no smooth typing delay
                thinking: streamThinkingRef.current,
                thinkingHeader: streamThinkingHeaderRef.current,
                sources: streamSourcesRef.current,
                suggestions: streamSuggestionsRef.current,
                attachments: streamAttachmentsRef.current, // Include generated images
                isStreaming: true,
                timestamp: Date.now(),
            };
        });

        animationFrameRef.current = requestAnimationFrame(updateUiLoop);
    };
    animationFrameRef.current = requestAnimationFrame(updateUiLoop);

    try {
      let firstChunk = true; 

      // Clear any stale debounce timer
      if (dbDebounceTimerRef.current) clearTimeout(dbDebounceTimerRef.current);

      // Strip base64 data from attachments - we have fileUri now, no need to send huge payload
      const attachmentsForApi = attachments.map(att => ({
        mimeType: att.mimeType,
        name: att.name,
        storageUrl: att.storageUrl,
        fileUri: att.fileUri,
        // NO data field - would make request 40MB+ for 8 images!
      }));

      const finalResponseText = await streamChatResponse(
        messages, finalText, attachmentsForApi, modelToUse, settings,
        {
            showSuggestions: appSettings.showSuggestions,
            userName: appSettings.userName // PASS USER NAME TO BACKEND
        },
        user?.uid,
        (chunk) => {
          // Hide "Loading" spinner as soon as first chunk arrives
          if (firstChunk) {
            setIsLoading(false);
            firstChunk = false;
          }

          // A. Update the NETWORK Buffer (Instant)
          streamBufferRef.current += chunk;

          // B. Debounce the Firestore write (Save money & writes)
          // We only write to DB every 2 seconds to avoid slamming it
          if (dbDebounceTimerRef.current) clearTimeout(dbDebounceTimerRef.current);
          
          dbDebounceTimerRef.current = setTimeout(() => {
            updateMessageInDb(sessionId!, newBotMessageId, { text: streamBufferRef.current });
          }, 2000); 
        },
        (sources) => {
            streamSourcesRef.current = sources;
        },
        (thoughtChunk) => {
            streamThinkingRef.current += thoughtChunk;

            // Extract headers for dynamic thinking indicator
            // Matches: **Bold Text** or ## Markdown Header
            const headerMatch = thoughtChunk.match(/(?:\*\*([^*]+)\*\*|^#{1,3}\s+(.+)$)/m);
            if (headerMatch) {
                // Group 1 = bold (**text**), Group 2 = markdown (## text)
                const header = headerMatch[1] || headerMatch[2];
                // Only use short headers (< 60 chars) to avoid long sentences
                if (header && header.trim().length < 60) {
                    streamThinkingHeaderRef.current = header.trim();
                }
            }
        },
        (suggestions) => {
            console.log("APP: Received Suggestions:", suggestions); // DEBUG LOG
            streamSuggestionsRef.current = suggestions;
            // Immediate update for suggestions (if they come in late stream)
            setStreamingMessage(prev => {
                if (!prev) return null;
                return { ...prev, suggestions: streamSuggestionsRef.current };
            });
        },
        // onImage - returns index immediately for inline markers
        // If backend provides storageUrl, use it; otherwise upload in background
        async (imageData) => {
            const imageIndex = streamAttachmentsRef.current.length;
            console.log("APP: onImage called!", imageData.mimeType, "index:", imageIndex);

            if (user?.uid && sessionId) {
                const aspectRatio = imageData.aspectRatio || settings.aspectRatio || '1:1';

                // Check if backend already uploaded (Pro Image sends storageUrl/fileUri)
                if (imageData.storageUrl) {
                    // Backend already uploaded - use directly
                    const attachment: Attachment = {
                        mimeType: imageData.mimeType,
                        storageUrl: imageData.storageUrl,
                        fileUri: imageData.fileUri,
                        aspectRatio
                    };
                    streamAttachmentsRef.current = [...streamAttachmentsRef.current, attachment];
                    console.log("APP: Using backend storageUrl:", imageData.storageUrl);
                } else {
                    // No storageUrl - need to upload (legacy handlers)
                    const placeholder: Attachment = {
                        mimeType: imageData.mimeType,
                        isPlaceholder: true,
                        aspectRatio
                    };
                    streamAttachmentsRef.current = [...streamAttachmentsRef.current, placeholder];

                    // Upload in background - don't block streaming
                    uploadGeneratedImage(imageData, user.uid, sessionId)
                        .then(attachment => {
                            console.log("APP: Upload done, storageUrl:", attachment.storageUrl);
                            streamAttachmentsRef.current = streamAttachmentsRef.current.map(att =>
                                att === placeholder
                                    ? { ...attachment, aspectRatio }
                                    : att
                            );
                        })
                        .catch(err => {
                            console.error("APP: Failed to upload generated image:", err);
                            streamAttachmentsRef.current = streamAttachmentsRef.current.filter(att => att !== placeholder);
                        });
                }
            } else {
                console.log("APP: Missing user or sessionId!", user?.uid, sessionId);
            }

            return imageIndex;
        },
        // onGraph - graphs from codeExecution (rendered inline with marker)
        // Returns index immediately, upload runs in background (non-blocking)
        async (graphData) => {
            const graphIndex = streamAttachmentsRef.current.length;
            const graphAspectRatio = graphData.aspectRatio || '4:3'; // matplotlib default

            if (user?.uid && sessionId) {
                const placeholder: Attachment = {
                    mimeType: graphData.mimeType,
                    isPlaceholder: true,
                    isGraph: true,
                    aspectRatio: graphAspectRatio
                };
                streamAttachmentsRef.current = [...streamAttachmentsRef.current, placeholder];

                // Upload in background - don't block streaming
                uploadGeneratedImage(graphData, user.uid, sessionId)
                    .then(attachment => {
                        streamAttachmentsRef.current = streamAttachmentsRef.current.map(att =>
                            att === placeholder
                                ? { ...attachment, isGraph: true, aspectRatio: graphAspectRatio }
                                : att
                        );
                    })
                    .catch(err => {
                        console.error("APP: Failed to upload graph:", err);
                        streamAttachmentsRef.current = streamAttachmentsRef.current.filter(att => att !== placeholder);
                    });
            }
            return graphIndex;
        },
        (model) => {
            setRoutedModel(model);
        },
        () => {
            setIsGeneratingImage(true);
        }
      );

      // --- CLEANUP & FINAL SYNC ---
      isStreamingRef.current = false;
      setIsLoading(false); // Ensure loading is cleared even if no text chunks arrived
      setIsGeneratingImage(false); // Reset generating image state
      setCurrentMode(null); // Reset mode after streaming
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (dbDebounceTimerRef.current) clearTimeout(dbDebounceTimerRef.current);

      // Final guaranteed DB write with COMPLETE data
      // CRITICAL: Do this BEFORE clearing local state to avoid UI flicker/data loss
      await updateMessageInDb(sessionId, newBotMessageId, {
          text: finalResponseText, // Use the resolved promise value!
          isStreaming: false,
          sources: streamSourcesRef.current,
          thinking: streamThinkingRef.current,
          suggestions: streamSuggestionsRef.current, // Save suggestions to DB
          attachments: streamAttachmentsRef.current, // Save generated images
      });

      // Now safe to clear
      setStreamingMessage(null);

    } catch (error: unknown) {
      console.error("Failed to generate response", error);

      // Cleanup on error
      isStreamingRef.current = false;
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (dbDebounceTimerRef.current) clearTimeout(dbDebounceTimerRef.current);

      setStreamingMessage(null);
      setIsLoading(false);
      setCurrentMode(null);

      const errorMessage = error instanceof Error ? error.message : "Something went wrong.";
      await updateMessageInDb(sessionId, newBotMessageId, {
        text: errorMessage,
        error: true,
        isStreaming: false
      });
    }
  }, [currentSessionId, user?.uid, messages, selectedModel, replyingTo, sessions, addMessageToDb, updateMessageInDb, renameChatInDb, createNewChatInDb, setCurrentSessionId, appSettings.showSuggestions, appSettings.userName]);


  const activeModelConfig = MODELS.find(m => m.id === selectedModel) || MODELS[0];

  const getModelColorClass = (id: ModelId) => {
    const model = MODELS.find(m => m.id === id);
    switch (model?.icon) {
      case 'Sparkles': return 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-600 dark:text-yellow-400';
      case 'Zap': return 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400';
      case 'Brain': return 'bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400';
      case 'Cpu': return 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400';
      case 'Image': return 'bg-pink-100 dark:bg-pink-500/20 text-pink-600 dark:text-pink-400';
      default: return 'bg-gray-100 dark:bg-gray-500/20 text-gray-600 dark:text-gray-400';
    }
  };

  const getModelIcon = (id: ModelId) => {
    const model = MODELS.find(m => m.id === id);
    switch (model?.icon) {
      case 'Sparkles': return <Sparkles size={20} />;
      case 'Zap': return <Zap size={20} />;
      case 'Brain': return <Brain size={20} />;
      case 'Cpu': return <Cpu size={20} />;
      case 'Image': return <ImageIcon size={20} />;
      default: return <Zap size={20} />;
    }
  };

  const getModelIconSmall = (id: ModelId) => {
    const model = MODELS.find(m => m.id === id);
    switch (model?.icon) {
      case 'Sparkles': return <Sparkles size={16} className="text-white" />;
      case 'Zap': return <Zap size={16} className="text-white" />;
      case 'Brain': return <Brain size={16} className="text-white" />;
      case 'Cpu': return <Cpu size={16} className="text-white" />;
      case 'Image': return <ImageIcon size={16} className="text-white" />;
      default: return <Zap size={16} className="text-white" />;
    }
  };

  // Create a modified user object with the preferred name for the MessageList
  const userWithPreferredName = user ? {
      ...user,
      displayName: appSettings.userName || user.displayName
  } : null;

  // Smart message list that prevents flicker during streaming transition
  const displayMessages = useMemo(() => {
    if (!streamingMessage) {
      return messages;
    }

    const currentDisplayed = [...messages];
    const existingBotMessageIndex = currentDisplayed.findIndex(
      (msg) => msg.id === streamingMessage.id
    );

    if (existingBotMessageIndex !== -1) {
      currentDisplayed[existingBotMessageIndex] = streamingMessage;
    } else {
      currentDisplayed.push(streamingMessage);
    }
    return currentDisplayed;
  }, [messages, streamingMessage]);

  // --- RENDER LOGIC ---
  if (authLoading || (user && sessionsLoading)) {
      return <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-[#0e0e10] text-gray-500">{t('loading')}</div>;
  }

  if (!user) {
      return (
        <div className="fixed inset-0 flex flex-col items-center justify-center bg-white dark:bg-[#0e0e10] text-gray-900 dark:text-white px-4">
           <div className="w-24 h-24 bg-gradient-to-br from-blue-500 to-teal-400 rounded-3xl flex items-center justify-center mb-8 shadow-2xl shadow-blue-500/20 animate-fade-in">
              <span className="text-5xl font-bold text-white">Q</span>
           </div>
           <h1 className="text-3xl font-bold mb-2 text-center">{t('welcomeTitle')}</h1>
           <p className="text-gray-500 dark:text-gray-400 mb-8 text-center">{t('welcomeSubtitle')}</p>
           <button onClick={handleLogin} className="flex items-center gap-3 px-6 py-3 bg-white dark:bg-[#2d2e33] border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm hover:bg-gray-50 dark:hover:bg-[#3d3e44] transition-all active:scale-95">
             <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
             <span className="font-medium">{t('signInGoogle')}</span>
           </button>
        </div>
      );
  }

  return (
    <div className="fixed inset-0 flex bg-white dark:bg-[#0e0e10] text-gray-900 dark:text-gray-100 font-sans overflow-hidden selection:bg-blue-500/30 animate-fade-in">
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        settings={appSettings} 
        onUpdateSettings={setAppSettings} 
        sessions={sessions} 
        onClearAllChats={() => { /* TODO */ }} 
        user={user}
        onSignOut={() => signOut(auth)}
        promptSettings={promptSettings}
        onUpdatePromptSettings={setPromptSettings}
      />
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={(id) => { setIsLoadingExistingChat(true); setCurrentSessionId(id); }}
        onNewChat={createNewChat}
        onDeleteSession={(id, e) => { e.stopPropagation(); deleteChatInDb(id); }}
        onRenameSession={renameChatInDb}
        language={resolveLanguage(appSettings.language)} // Added prop
      />
      <div className="flex-1 flex flex-col h-full relative min-w-0 bg-white dark:bg-[#0e0e10]">
          {/* TOP BAR */}
          <div className="sticky top-0 z-40 flex items-center justify-between px-3 py-1 pt-safe bg-white dark:bg-[#0e0e10]">
              <div>
                  <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 transition-all active:scale-95"><Menu size={20} /></button>
              </div>
              <div className="relative">
                  <button onClick={() => setIsModelMenuOpen(!isModelMenuOpen)} className={`flex items-center gap-2 px-4 py-2 rounded-[24px] border transition-all active:scale-95 duration-300 ${isModelMenuOpen ? 'bg-gray-100 dark:bg-[#1e1f20] border-gray-200 dark:border-gray-700 w-64 justify-between' : 'bg-gray-100 dark:bg-[#1e1f20] border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-[#2d2e33] w-auto'}`}>
                      {isModelMenuOpen ? <span className="text-sm font-bold text-gray-900 dark:text-white pl-1">{t('selectModel')}</span> : <div className="flex items-center gap-2">{getModelIconSmall(activeModelConfig.id)}<span className="text-xs font-medium tracking-wide text-gray-900 dark:text-white">{getModelName(activeModelConfig.id)}</span></div>}
                      {isModelMenuOpen ? <ChevronDown size={16} className="rotate-180 text-gray-400" /> : null}
                  </button>
                  {isModelMenuOpen && (
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 bg-white dark:bg-[#1e1f20] rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-2 animate-fade-in ring-1 ring-black/5 z-10">
                      {MODELS.map(model => (
                        <button
                          key={model.id}
                          onClick={() => { setSelectedModel(model.id); setIsModelMenuOpen(false); }}
                          className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors ${
                            selectedModel === model.id ? 'bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                          }`}
                        >
                          <div className={`p-1.5 rounded-lg ${getModelColorClass(model.id)}`}>
                            {getModelIcon(model.id)}
                          </div>
                          <div className="flex-1">
                            <div className="font-medium text-sm text-gray-900 dark:text-gray-200">{getModelName(model.id)}</div>
                            <div className="text-xs text-gray-500">{model.description}</div>
                          </div>
                          {selectedModel === model.id && <Check size={16} className="text-blue-500" />}
                        </button>
                      ))}
                    </div>
                  )}
              </div>
              <div>
                  <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="w-10 h-10 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 transition-all active:scale-95 overflow-hidden p-0"
                  >
                    {user.photoURL ? <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" /> : <span>{user.displayName ? user.displayName[0].toUpperCase() : 'U'}</span>}
                  </button>
              </div>
          </div>
          {/* Chat Area */}
          <div className="flex-1 overflow-hidden relative flex flex-col bg-white dark:bg-[#0e0e10]">
            <ChatLoadingOverlay sessionId={currentSessionId} isExistingChat={isLoadingExistingChat} />
            <MessageList
              messages={displayMessages}
              isThinking={isLoading}
              selectedModel={routedModel || selectedModel}
              isGeneratingImage={isGeneratingImage}
              currentMode={currentMode}
              onEdit={handleEditMessage}
              onReply={handleReply}
              onSuggestionClick={handleSuggestionClick}
              minFooterHeight={minFooterHeight}
              user={userWithPreferredName}
              language={resolveLanguage(appSettings.language)}
              sessionId={currentSessionId}
              onOpenLightbox={setLightboxSrc}
            />
            <div ref={inputAreaRef}>
              <InputArea
                onSend={handleSendMessage}
                isLoading={isLoading}
                selectedModel={selectedModel}
                replyingTo={replyingTo}
                onClearReply={handleClearReply}
                initialText={suggestionText}
                onClearInitialText={handleClearSuggestion}
                settings={promptSettings} // PASSING GLOBAL SETTINGS
                language={resolveLanguage(appSettings.language)} // Added prop
              />
            </div>
          </div>
      </div>
      <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
};

export default App;
