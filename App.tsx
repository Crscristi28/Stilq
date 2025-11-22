import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ChatMessage, Role, Attachment, ModelId, MODELS, ChatSession, PromptSettings, AppSettings, UserProfile } from './types';
import MessageList from './components/MessageList';
import InputArea from './components/InputArea';
import Sidebar from './components/Sidebar';
import SettingsModal from './components/SettingsModal';
import { streamChatResponse, generateSuggestions } from './services/geminiService';
import { ChevronDown, Zap, Brain, Menu, Image as ImageIcon, Check } from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import { useFirestoreSync } from './hooks/useFirestoreSync';
import { signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from './firebase';

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
  } = useFirestoreSync();

  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelId>(ModelId.FLASH);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [suggestionText, setSuggestionText] = useState<string>('');
  const [streamingMessage, setStreamingMessage] = useState<ChatMessage | null>(null);

  // --- SETTINGS (Stays Local) ---
  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    try {
        const saved = localStorage.getItem('elora_settings_v1');
        return saved ? JSON.parse(saved) : { theme: 'dark', enterToSend: true, defaultVoiceURI: '', defaultSpeechRate: 1.0, language: 'en' };
    } catch { return { theme: 'dark', enterToSend: true, defaultVoiceURI: '', defaultSpeechRate: 1.0, language: 'en' }; }
  });

  useEffect(() => {
    const root = window.document.documentElement;
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    const applyTheme = (isDark: boolean) => {
      root.classList.toggle('dark', isDark);
      metaThemeColor?.setAttribute('content', isDark ? '#0e0e10' : '#ffffff');
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
    localStorage.setItem('elora_settings_v1', JSON.stringify(appSettings));
  }, [appSettings]);

  // --- FEATURE: Handle deleted session ---
  useEffect(() => {
    if (!sessions.find(s => s.id === currentSessionId) && sessions.length > 0) {
      setCurrentSessionId(sessions[0].id);
    }
  }, [sessions, currentSessionId, setCurrentSessionId]);

  // --- HANDLERS (Now talk to Firestore) ---

  const handleLogin = async () => {
      try { await signInWithPopup(auth, googleProvider); }
      catch (error) { console.error("Login failed", error); alert("Login failed. Check Firebase config and authorized domains."); }
  };

  const createNewChat = async () => {
      const newSession: Omit<ChatSession, 'messages'> = {
          id: Date.now().toString(),
          title: 'New Chat',
          createdAt: Date.now(),
          updatedAt: Date.now()
      };
      const newId = await createNewChatInDb(newSession);
      if (newId) setCurrentSessionId(newId);
      setIsLoading(false);
      setReplyingTo(null);
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

  // --- DEBOUNCE LOGIC (The Fix) ---
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleSendMessage = useCallback(async (text: string, attachments: Attachment[], settings: PromptSettings) => {
    if (!user?.uid) return;

    // Auto-create chat if none exists
    let sessionId = currentSessionId;
    if (!sessionId) {
      const newSession: Omit<ChatSession, 'messages'> = {
        id: Date.now().toString(),
        title: 'New Chat',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      const newId = await createNewChatInDb(newSession);
      if (!newId) return;
      setCurrentSessionId(newId);
      sessionId = newId;
    }

    let finalText = replyingTo ? `> ${replyingTo.text.split('\n').join('\n> ')}\n\n${text}` : text;
    setReplyingTo(null);

    // --- FEATURE: Auto-title from first message ---
    const currentSession = sessions.find(s => s.id === sessionId);
    const shouldUpdateTitle = messages.length === 0 && currentSession?.title === 'New Chat';
    if (shouldUpdateTitle) {
      const newTitle = text.slice(0, 30) + (text.length > 30 ? '...' : '');
      await renameChatInDb(sessionId, newTitle);
    }

    const newUserMsg: ChatMessage = {
      id: Date.now().toString(),
      role: Role.USER,
      text: finalText,
      attachments,
      timestamp: Date.now(),
    };
    await addMessageToDb(sessionId, newUserMsg);

    setIsLoading(true);

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

    try {
      let fullResponse = "";

      // Clear any existing debounce timer before starting a new stream
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      await streamChatResponse(
        messages, finalText, attachments, selectedModel, settings,
        (chunk) => {
          fullResponse += chunk;

          // Update LOCAL state immediately for smooth UI streaming
          setStreamingMessage({
            id: newBotMessageId,
            role: Role.MODEL,
            text: fullResponse,
            isStreaming: true,
            timestamp: Date.now(),
          });

          // Debounce the Firestore write operation (save money)
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
          }

          debounceTimerRef.current = setTimeout(() => {
            console.log("Debounced write to Firestore...");
            updateMessageInDb(sessionId, newBotMessageId, { text: fullResponse });
          }, 1500); // Write to DB every 1.5 seconds of inactivity
        }
      );

      // --- FINALIZATION ---
      // Clear the timer one last time
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Clear streaming state (now rely on Firestore)
      setStreamingMessage(null);

      // Perform one final, guaranteed write with the complete response
      await updateMessageInDb(sessionId, newBotMessageId, { text: fullResponse, isStreaming: false });

      // Turn off loading indicator BEFORE generating suggestions (prevents thinking dots)
      setIsLoading(false);

      // Generate suggestions quietly in background (no loading indicator, no scroll jump)
      if (!fullResponse.includes("data:image") && fullResponse.length > 50) {
          const suggestions = await generateSuggestions(finalText, fullResponse);
          if (suggestions.length > 0) {
              await updateMessageInDb(sessionId, newBotMessageId, { suggestions });
          }
      }

    } catch (error: any) {
      console.error("Failed to generate response", error);
      setStreamingMessage(null); // Clear streaming state on error
      setIsLoading(false); // Turn off loading on error
      await updateMessageInDb(sessionId, newBotMessageId, {
        text: error.message || "Something went wrong.",
        error: true,
        isStreaming: false
      });
    }
  }, [currentSessionId, user?.uid, messages, selectedModel, replyingTo, sessions, addMessageToDb, updateMessageInDb, renameChatInDb, createNewChatInDb, setCurrentSessionId]);

  const activeModelConfig = MODELS.find(m => m.id === selectedModel) || MODELS[0];

  const getModelColorClass = (id: ModelId) => {
    const model = MODELS.find(m => m.id === id);
    switch (model?.icon) {
      case 'Zap': return 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400';
      case 'Brain': return 'bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400';
      case 'Image': return 'bg-pink-100 dark:bg-pink-500/20 text-pink-600 dark:text-pink-400';
      default: return 'bg-gray-100 dark:bg-gray-500/20 text-gray-600 dark:text-gray-400';
    }
  };

  const getModelIcon = (id: ModelId) => {
    const model = MODELS.find(m => m.id === id);
    switch (model?.icon) {
      case 'Zap': return <Zap size={20} />;
      case 'Brain': return <Brain size={20} />;
      case 'Image': return <ImageIcon size={20} />;
      default: return <Zap size={20} />;
    }
  };

  const getModelIconSmall = (id: ModelId) => {
    const model = MODELS.find(m => m.id === id);
    switch (model?.icon) {
      case 'Zap': return <Zap size={16} className="text-white" />;
      case 'Brain': return <Brain size={16} className="text-white" />;
      case 'Image': return <ImageIcon size={16} className="text-white" />;
      default: return <Zap size={16} className="text-white" />;
    }
  };

  // --- RENDER LOGIC ---
  if (authLoading || (user && sessionsLoading)) {
      return <div className="fixed inset-0 flex items-center justify-center bg-white dark:bg-[#0e0e10] text-gray-500">Loading...</div>;
  }

  if (!user) {
      return (
        <div className="fixed inset-0 flex flex-col items-center justify-center bg-white dark:bg-[#0e0e10] text-gray-900 dark:text-white px-4">
           <div className="w-24 h-24 bg-gradient-to-br from-blue-500 to-teal-400 rounded-3xl flex items-center justify-center mb-8 shadow-2xl shadow-blue-500/20 animate-fade-in">
              <span className="text-5xl font-bold text-white">E</span>
           </div>
           <h1 className="text-3xl font-bold mb-2 text-center">Welcome to Elora</h1>
           <p className="text-gray-500 dark:text-gray-400 mb-8 text-center">A modern AI experience. Sign in to continue.</p>
           <button onClick={handleLogin} className="flex items-center gap-3 px-6 py-3 bg-white dark:bg-[#2d2e33] border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm hover:bg-gray-50 dark:hover:bg-[#3d3e44] transition-all active:scale-95">
             <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
             <span className="font-medium">Sign in with Google</span>
           </button>
        </div>
      );
  }

  return (
    <div className="fixed inset-0 flex bg-white dark:bg-[#0e0e10] text-gray-900 dark:text-gray-100 font-sans overflow-hidden selection:bg-blue-500/30">
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} settings={appSettings} onUpdateSettings={setAppSettings} sessions={sessions} onClearAllChats={() => { /* TODO: Cloud function to clear all */ }} />
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        sessions={sessions}
        currentSessionId={currentSessionId!}
        onSelectSession={setCurrentSessionId}
        onNewChat={createNewChat}
        onDeleteSession={(id, e) => { e.stopPropagation(); deleteChatInDb(id); }}
        onRenameSession={renameChatInDb}
        onOpenSettings={() => setIsSettingsOpen(true)}
        user={user}
        onSignOut={() => signOut(auth)}
      />
      <div className="flex-1 flex flex-col relative min-w-0 bg-white dark:bg-[#0e0e10]">
          {/* FLOATING ISLAND HEADER */}
          <div className="fixed top-0 left-0 right-0 z-50 flex items-start justify-between px-4 pointer-events-none pt-safe">
              <div className="mt-3 pointer-events-auto">
                  <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2.5 rounded-full bg-white/10 backdrop-blur-md shadow-sm border border-white/20 text-gray-700 dark:text-gray-200 hover:bg-white/20 transition-all active:scale-95"><Menu size={20} /></button>
              </div>
              <div className="relative pointer-events-auto mt-2">
                  <button onClick={() => setIsModelMenuOpen(!isModelMenuOpen)} className={`flex items-center gap-2 px-4 py-2 rounded-[24px] backdrop-blur-xl shadow-lg border transition-all active:scale-95 duration-300 ${isModelMenuOpen ? 'bg-black/80 dark:bg-[#1e1f20]/90 border-gray-200 dark:border-gray-700 w-64 justify-between' : 'bg-black/50 dark:bg-white/10 border-transparent hover:bg-black/70 text-white w-auto'}`}>
                      {isModelMenuOpen ? <span className="text-sm font-bold text-white pl-1">Select Model</span> : <div className="flex items-center gap-2">{getModelIconSmall(activeModelConfig.id)}<span className="text-xs font-medium tracking-wide text-white">{activeModelConfig.name}</span></div>}
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
                            <div className="font-medium text-sm text-gray-900 dark:text-gray-200">{model.name}</div>
                            <div className="text-xs text-gray-500">{model.description}</div>
                          </div>
                          {selectedModel === model.id && <Check size={16} className="text-blue-500" />}
                        </button>
                      ))}
                    </div>
                  )}
              </div>
              <div className="mt-3 pointer-events-auto">
                  <button className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-md shadow-sm border border-white/20 text-gray-700 dark:text-gray-200 hover:bg-white/20 transition-all active:scale-95">{user.photoURL ? <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover rounded-full" /> : <span>{user.displayName ? user.displayName[0].toUpperCase() : 'U'}</span>}</button>
              </div>
          </div>
          {/* Chat Area */}
          <div className="flex-1 overflow-hidden relative flex flex-col bg-white dark:bg-[#0e0e10]" style={{ maskImage: 'linear-gradient(to bottom, transparent 0px, black 120px)' }}>
            <MessageList
              messages={streamingMessage ? [...messages, streamingMessage] : messages}
              isThinking={isLoading}
              onEdit={handleEditMessage}
              onReply={handleReply}
              onSuggestionClick={handleSuggestionClick}
            />
            <InputArea onSend={handleSendMessage} isLoading={isLoading} selectedModel={selectedModel} replyingTo={replyingTo} onClearReply={handleClearReply} initialText={suggestionText} onClearInitialText={handleClearSuggestion} />
          </div>
      </div>
    </div>
  );
};

export default App;
