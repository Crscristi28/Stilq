import React, { useEffect, useRef, useState } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { ChatMessage, Role } from '../types';
import MarkdownRenderer from './MarkdownRenderer';
import { 
  AlertCircle, Sparkles, Copy, Check, 
  FileText, Pencil, Volume2, Square, 
  FileCode, FileSpreadsheet, File, Reply, Lightbulb, Settings2, X, Share2, Globe, ExternalLink, ChevronDown, ArrowDown
} from 'lucide-react';

interface MessageListProps {
  messages: ChatMessage[];
  isThinking: boolean;
  onEdit?: (id: string, newText: string) => void;
  onReply?: (msg: ChatMessage) => void;
  onSuggestionClick?: (text: string) => void;
  minFooterHeight: number;
}

// --- Helper Functions ---
const getFileIcon = (mimeType: string) => {
  if (mimeType.includes('pdf')) return FileText;
  if (mimeType.includes('spreadsheet') || mimeType.includes('csv') || mimeType.includes('excel')) return FileSpreadsheet;
  if (mimeType.includes('json') || mimeType.includes('script') || mimeType.includes('html') || mimeType.includes('xml') || mimeType.includes('code')) return FileCode;
  if (mimeType.startsWith('text/')) return FileText;
  return File;
};

const formatFileSize = (base64: string) => {
  try {
    const len = base64.length;
    const padding = (base64.match(/=+$/) || [''])[0].length;
    const bytes = (len * 0.75) - padding;
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  } catch (e) {
    return 'Unknown';
  }
};

// --- MessageItem Component ---
const MessageItem = ({
  msg,
  editingId,
  editText,
  speakingId,
  copiedId,
  voices,
  selectedVoiceURI,
  speechRate,
  showTTSSettingsId,
  onSetEditText,
  onStartEditing,
  onCancelEditing,
  onSaveEdit,
  onHandleSpeak,
  onHandleCopy,
  onHandleStopSpeak,
  onHandleReply,
  onHandleShare,
  onToggleTTSSettings,
  onSaveTTSSettings,
  onSuggestionClick
}: any) => {
  
  // Local state for Thinking Process toggle
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);

  // Don't render content if it's a placeholder waiting for text.
  if (msg.role === Role.MODEL && msg.isStreaming && (!msg.text || msg.text.length === 0)) {
      return null;
  }
  
  const isUser = msg.role === Role.USER;

  // --- USER MESSAGE LAYOUT (BUBBLE) ---
  if (isUser) {
    const hasAttachments = msg.attachments && msg.attachments.length > 0;
    const isSingleImage = hasAttachments && msg.attachments.length === 1 && msg.attachments[0].mimeType.startsWith('image/');

    return (
      <div className="w-full py-4 hover:bg-gray-50/50 dark:hover:bg-white/[0.02] transition-colors group">
        <div className="max-w-4xl mx-auto w-full px-5 md:px-8 flex flex-col items-end">

            {/* 1. Attachments Display (Adaptive) */}
            {hasAttachments && (
                <div className="mb-1 flex justify-end max-w-full">
                    {isSingleImage ? (
                        // SINGLE IMAGE: Hero style, adaptive height
                        <div className="relative rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-[#1a1b1e] max-w-[70%] max-h-[400px]">
                            <img
                                src={msg.attachments[0].storageUrl || `data:${msg.attachments[0].mimeType};base64,${msg.attachments[0].data}`}
                                alt="attachment"
                                className="w-full h-auto object-contain max-h-[400px]"
                            />
                        </div>
                    ) : (
                        // MULTIPLE ATTACHMENTS: Horizontal Carousel
                        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide max-w-full mask-fade-right">
                            {msg.attachments.map((att: any, idx: number) => (
                                <div key={idx} className="relative flex-shrink-0 group/att">
                                    {att.mimeType.startsWith('image/') ? (
                                        <div className="relative h-24 w-24 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-[#1a1b1e]">
                                            <img
                                                src={att.storageUrl || `data:${att.mimeType};base64,${att.data}`}
                                                alt="attachment"
                                                className="h-full w-full object-contain"
                                            />
                                        </div>
                                    ) : (
                                        <div className="h-16 w-48 flex items-center gap-3 p-3 bg-white dark:bg-[#1a1b1e] border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
                                            <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-gray-500 dark:text-gray-400">
                                                {React.createElement(getFileIcon(att.mimeType), { size: 20 })}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-xs font-medium text-gray-900 dark:text-gray-200 truncate">{att.name}</div>
                                                <div className="text-[10px] text-gray-500 uppercase">{att.mimeType.split('/')[1]}</div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="relative flex flex-col items-end gap-1 max-w-[85%] md:max-w-[75%]">
                {/* Left Side Actions (Absolute) */}
                {msg.text && (
                    <div className="absolute right-full top-0 mr-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={() => onStartEditing(msg)}
                        className="p-1.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        title="Edit"
                    >
                        <Pencil size={14}/>
                    </button>
                    <button
                        onClick={() => onHandleReply(msg)}
                        className="p-1.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        title="Reply"
                    >
                        <Reply size={14}/>
                    </button>
                    </div>
                )}

                {/* 2. Text Bubble (Only if text exists) */}
                {msg.text && (
                    <div className="relative px-5 py-3.5 bg-gray-100 dark:bg-[#2d2e33] text-gray-900 dark:text-white rounded-[24px] rounded-tr-sm shadow-sm">
                        <div className="text-sm md:text-base leading-relaxed font-sans">
                            {editingId === msg.id ? (
                                <div className="min-w-[200px]">
                                    <textarea
                                        value={editText}
                                        onChange={(e) => onSetEditText(e.target.value)}
                                        className="w-full bg-transparent border-none focus:ring-0 text-gray-900 dark:text-white resize-none"
                                        rows={3}
                                        autoFocus
                                    />
                                    <div className="flex justify-end gap-2 mt-2">
                                        <button onClick={onCancelEditing} className="text-xs opacity-70">Cancel</button>
                                        <button onClick={() => onSaveEdit(msg.id)} className="text-xs font-bold text-blue-600 dark:text-blue-300">Save</button>
                                    </div>
                                </div>
                            ) : <MarkdownRenderer content={msg.text} />}
                        </div>
                    </div>
                )}

                {/* Timestamp */}
                {!msg.isStreaming && (
                    <div className="text-[10px] text-gray-400 pr-1 mt-1">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                )}
            </div>
        </div>
      </div>
    );
  }

  // --- BOT MESSAGE LAYOUT (GEMINI STYLE) ---
  return (
    <div className="flex flex-col w-full px-5 py-6 md:px-8 hover:bg-gray-50/50 dark:hover:bg-white/[0.02] transition-colors group">
      <div className="max-w-4xl mx-auto w-full">
        
        {/* HEADER: Avatar + Name + Thinking Toggle */}
        <div className="flex items-center gap-3 mb-3 select-none">
            {/* Avatar */}
            <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 shadow-sm ${
                msg.error ? 'bg-red-100 text-red-500' : 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white'
            }`}>
               {msg.error ? <AlertCircle size={14} /> : <Sparkles size={12} />}
            </div>

            {/* Name & Model Badge */}
            <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-gray-900 dark:text-gray-100">Elora</span>
                {/* Streaming Indicator */}
                {msg.isStreaming && !msg.text && (
                     <span className="text-xs text-gray-400 animate-pulse">Thinking...</span>
                )}
                
                {/* THINKING PROCESS TOGGLE */}
                {msg.thinking && (
                    <button 
                        onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
                        className="flex items-center gap-1.5 ml-2 px-2 py-1 rounded-full bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 transition-colors text-[10px] font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-transparent"
                    >
                        <Sparkles size={10} className="text-purple-500" />
                        <span>Thinking Process</span>
                        <ChevronDown size={10} className={`transition-transform duration-200 ${isThinkingExpanded ? 'rotate-180' : ''}`} />
                    </button>
                )}
            </div>
        </div>

        {/* THINKING CONTENT BLOCK (Expandable) */}
        {msg.thinking && isThinkingExpanded && (
            <div className="ml-0 md:ml-9 mb-4 p-4 bg-gray-50 dark:bg-[#1a1b1e] rounded-xl text-xs leading-relaxed text-gray-600 dark:text-gray-400 border-l-2 border-purple-500/50 animate-slide-down font-mono whitespace-pre-wrap shadow-inner">
                {msg.thinking}
            </div>
        )}

        {/* BODY: Clean Text (No Bubble) */}
        <div className="pl-0 md:pl-9 w-full">
            <div className="text-[15px] md:text-[16px] leading-7 text-gray-800 dark:text-gray-200 markdown-body font-sans antialiased">
                 <MarkdownRenderer content={msg.text} />
            </div>
            
            {/* Suggestion Chips (Integrated directly below text) */}
            {!msg.isStreaming && msg.suggestions && msg.suggestions.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-4 animate-fade-in">
                    {msg.suggestions.map((suggestion: string, idx: number) => (
                        <button
                            key={idx}
                            onClick={() => onSuggestionClick && onSuggestionClick(suggestion)}
                            className="px-3 py-1.5 rounded-xl bg-transparent border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                        >
                            {suggestion}
                        </button>
                    ))}
                </div>
            )}

            {/* FOOTER: Sources + Timestamp + Actions */}
            <div className="mt-4 pt-2 flex flex-col gap-3">
                
                {/* Sources Carousel (If present) */}
                {msg.sources && msg.sources.length > 0 && (
                    <div className="w-full overflow-hidden">
                        <div className="flex items-center gap-1.5 mb-2">
                             <Globe size={12} className="text-blue-500" />
                             <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Sources</span>
                        </div>
                        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide mask-fade-right w-full">
                            {msg.sources.map((source: any, idx: number) => (
                                <a
                                    key={idx}
                                    href={source.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex-shrink-0 flex flex-col justify-center px-3 py-2 w-[160px] bg-white dark:bg-[#1a1b1e] border border-gray-200 dark:border-gray-800 hover:border-blue-400 dark:hover:border-blue-500/50 rounded-xl transition-all group/source no-underline h-[52px]"
                                    title={source.title}
                                >
                                    <span className="text-[11px] font-medium text-gray-700 dark:text-gray-200 truncate w-full block">{source.title}</span>
                                    <span className="text-[9px] text-gray-400 truncate w-full block mt-0.5 opacity-70 group-hover/source:opacity-100">
                                        {new URL(source.url).hostname.replace('www.', '')}
                                    </span>
                                </a>
                            ))}
                        </div>
                    </div>
                )}

                {/* Action Bar Row */}
                {!msg.isStreaming && !msg.error && (
                    <div className="flex items-center justify-between pt-2 md:pt-0">
                        <div className="flex items-center gap-1">
                             {/* Copy */}
                             <button onClick={() => onHandleCopy(msg.text, msg.id)} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-all" title="Copy">
                                 {copiedId === msg.id ? <Check size={14} className="text-green-500"/> : <Copy size={14}/>}
                             </button>
                             
                             {/* Speak */}
                             <div className="relative">
                                 <button onClick={() => speakingId === msg.id ? onHandleStopSpeak() : onHandleSpeak(msg.text, msg.id)} className={`p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-all ${speakingId === msg.id ? 'text-blue-500' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'}`}>
                                     {speakingId === msg.id ? <Square size={14} fill="currentColor"/> : <Volume2 size={14}/>}
                                 </button>
                             </div>

                             {/* Share */}
                             <button onClick={() => onHandleShare(msg.text)} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-all" title="Share">
                                 <Share2 size={14}/>
                             </button>

                             {/* TTS Settings (Fixed) */}
                             <div className="relative">
                                <button 
                                    onClick={() => onToggleTTSSettings(msg.id)}
                                    className={`p-1.5 rounded-full transition-all ${showTTSSettingsId === msg.id ? 'text-blue-500 bg-blue-500/10' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                                >
                                    <Settings2 size={14}/>
                                </button>
                                {showTTSSettingsId === msg.id && (
                                  <div className="absolute bottom-full left-0 mb-2 w-64 bg-white dark:bg-[#1e1f20] border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-3 z-10 animate-fade-in">
                                      <div className="flex justify-between items-center mb-2">
                                          <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Voice Settings</span>
                                          <button onClick={() => onToggleTTSSettings(null)} className="text-gray-500 hover:text-gray-900 dark:hover:text-white"><X size={12}/></button>
                                      </div>
                                      <div className="space-y-3">
                                          <div>
                                              <label className="text-xs text-gray-600 dark:text-gray-300 mb-1 block">Voice</label>
                                              <select
                                                  value={selectedVoiceURI}
                                                  onChange={(e) => onSaveTTSSettings(e.target.value, speechRate)}
                                                  className="w-full bg-gray-50 dark:bg-[#2d2e33] border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-xs text-gray-900 dark:text-gray-200 focus:outline-none"
                                              >
                                                  {voices.map((v: any) => (
                                                      <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
                                                  ))}
                                              </select>
                                          </div>
                                          <div>
                                              <div className="flex justify-between text-xs mb-1 text-gray-600 dark:text-gray-300">
                                                  <span>Speed</span>
                                                  <span className="font-medium text-blue-600 dark:text-blue-400">{speechRate}x</span>
                                              </div>
                                              <input
                                                  type="range" min="0.5" max="2" step="0.1"
                                                  value={speechRate}
                                                  onChange={(e) => onSaveTTSSettings(selectedVoiceURI, parseFloat(e.target.value))}
                                                  className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                              />
                                          </div>
                                      </div>
                                  </div>
                                )}
                             </div>

                             {/* Reply Button (Added) */}
                             <button onClick={() => onHandleReply(msg)} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-all" title="Reply">
                                 <Reply size={14}/>
                             </button>
                        </div>
                        
                        {/* Timestamp */}
                        <span className="text-[10px] text-gray-300 dark:text-gray-600 font-medium">
                             {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </div>
                )}

            </div>
        </div>
      </div>
    </div>
  );
};

// --- Main MessageList Component ---
const MessageList: React.FC<MessageListProps> = ({ messages, isThinking, onEdit, onReply, onSuggestionClick, minFooterHeight }) => {
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [speakingId, setSpeakingId] = useState<string | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);

    // Dynamic footer states
    const [footerHeight, setFooterHeight] = useState<string>(`${minFooterHeight}px`);
    const [isFooterBig, setIsFooterBig] = useState<boolean>(false);
    const justSentMessageRef = useRef<boolean>(false); // Prevent immediate shrink after setting big

    // TTS Settings State
    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [selectedVoiceURI, setSelectedVoiceURI] = useState('');
    const [speechRate, setSpeechRate] = useState(1);
    const [showTTSSettingsId, setShowTTSSettingsId] = useState<string | null>(null);

    // Load voices on mount
    useEffect(() => {
        const loadVoices = () => {
            const availableVoices = window.speechSynthesis.getVoices();
            setVoices(availableVoices);
            // Load saved settings
            try {
                const saved = localStorage.getItem('elora_settings_v1');
                if (saved) {
                    const settings = JSON.parse(saved);
                    setSelectedVoiceURI(settings.defaultVoiceURI || '');
                    setSpeechRate(settings.defaultSpeechRate || 1);
                }
            } catch(e) {}
        };
        loadVoices();
        if (window.speechSynthesis.onvoiceschanged !== undefined) {
            window.speechSynthesis.onvoiceschanged = loadVoices;
        }
    }, []);

    // Update footer height when minFooterHeight changes (only if footer is not big)
    useEffect(() => {
        if (!isFooterBig) {
            setFooterHeight(`${minFooterHeight}px`);
        }
    }, [minFooterHeight, isFooterBig]);

    // Auto-scroll logic - Focus Mode: user messages go to TOP
    useEffect(() => {
        if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            // Only scroll when user sends a message - position it at TOP
            if (lastMessage.role === Role.USER) {
                // Set footer to 55vh for Focus Mode
                setFooterHeight('55vh');
                setIsFooterBig(true);
                justSentMessageRef.current = true;

                setTimeout(() => {
                    virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, align: 'start', behavior: 'smooth' });
                }, 100);

                // Allow scrolling to shrink footer after 800ms (after scroll animation completes)
                setTimeout(() => {
                    justSentMessageRef.current = false;
                }, 800);
            }
        }
    }, [messages.length]);

    const handleStartEditing = (msg: ChatMessage) => {
        setEditingId(msg.id);
        setEditText(msg.text);
    };

    const handleCancelEditing = () => {
        setEditingId(null);
        setEditText('');
    };

    const handleSaveEdit = (id: string) => {
        if (onEdit && editText.trim() !== '') {
            onEdit(id, editText);
        }
        setEditingId(null);
    };

    const handleCopy = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const handleSpeak = (text: string, id: string) => {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        
        // Load saved settings if available
        const savedVoice = localStorage.getItem('elora_settings_v1');
        if (savedVoice) {
            try {
                const settings = JSON.parse(savedVoice);
                if (settings.defaultSpeechRate) utterance.rate = settings.defaultSpeechRate;
                if (settings.defaultVoiceURI) {
                    const voices = window.speechSynthesis.getVoices();
                    const foundVoice = voices.find(v => v.voiceURI === settings.defaultVoiceURI);
                    if (foundVoice) utterance.voice = foundVoice;
                }
            } catch(e) {}
        }

        utterance.onend = () => setSpeakingId(null);
        utterance.onerror = () => setSpeakingId(null);
        setSpeakingId(id);
        window.speechSynthesis.speak(utterance);
    };

    const handleStopSpeak = () => {
        window.speechSynthesis.cancel();
        setSpeakingId(null);
    };
    
    const handleReply = (msg: ChatMessage) => {
        if (onReply) onReply(msg);
    };

    const handleToggleTTSSettings = (id: string | null) => {
        setShowTTSSettingsId(id);
    };

    const handleSaveTTSSettings = (voiceURI: string, rate: number) => {
        setSelectedVoiceURI(voiceURI);
        setSpeechRate(rate);
        // Save to localStorage
        try {
            const saved = localStorage.getItem('elora_settings_v1');
            const settings = saved ? JSON.parse(saved) : {};
            settings.defaultVoiceURI = voiceURI;
            settings.defaultSpeechRate = rate;
            localStorage.setItem('elora_settings_v1', JSON.stringify(settings));
        } catch(e) {}
    };

    const handleShare = async (text: string) => {
        if (navigator.share) {
            try {
                await navigator.share({ text });
            } catch(e) {
                // User cancelled or error
            }
        } else {
            // Fallback: copy to clipboard
            navigator.clipboard.writeText(text);
            alert('Copied to clipboard!');
        }
    };

    const scrollToBottom = () => {
        virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, align: 'start', behavior: 'smooth' });
    };

    // Handle scrolling state change - shrink footer when user scrolls
    const handleScrollingStateChange = (isScrolling: boolean) => {
        // Only shrink if user is scrolling, footer is big, AND we're not in the immediate post-send period
        if (isScrolling && isFooterBig && !justSentMessageRef.current) {
            setFooterHeight(`${minFooterHeight}px`);
            setIsFooterBig(false);
        }
    };

    // Handle scroll position - toggle scroll-to-bottom button visibility
    const handleAtBottomStateChange = (atBottom: boolean) => {
        setShowScrollToBottom(!atBottom);
    };
    
    // Determine when to show the "Thinking" indicator.
    // Show ONLY before bot responds - never show after streaming or during suggestions
    const lastMessage = messages[messages.length - 1];
    const hasBotResponse = lastMessage?.role === Role.MODEL && lastMessage.text.length > 0;
    const showThinkingDots = isThinking && !hasBotResponse;

    // If empty, render Welcome Screen directly
    if (messages.length === 0 && !isThinking) {
        return (
            <div className="flex-1 w-full flex flex-col items-center justify-center p-4 text-center overflow-y-auto">
                <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-teal-400 rounded-2xl flex items-center justify-center mb-6 shadow-xl shadow-blue-500/20">
                    <span className="text-3xl font-bold text-white">E</span>
                </div>
                <h1 className="text-3xl md:text-4xl font-bold mb-3 bg-clip-text text-transparent bg-gradient-to-r from-blue-500 to-teal-400 dark:from-blue-400 dark:to-teal-400">
                    Hello, User
                </h1>
                <p className="text-gray-500 dark:text-gray-400 max-w-md text-lg">
                    Experience the power of multimodal AI. Ask questions, upload images, and explore ideas with Elora's advanced models.
                </p>
            </div>
        );
    }

    // Otherwise render the list
    return (
        <div className="flex-1 w-full relative flex flex-col">
            <Virtuoso
                ref={virtuosoRef}
                data={messages}
                className="flex-1 w-full scrollbar-hide"
                atBottomThreshold={60}
                followOutput={false}
                isScrolling={handleScrollingStateChange}
                atBottomStateChange={handleAtBottomStateChange}
                itemContent={(index, msg) => (
                    <MessageItem
                        key={msg.id}
                        msg={msg}
                        editingId={editingId}
                        editText={editText}
                        speakingId={speakingId}
                        copiedId={copiedId}
                        voices={voices}
                        selectedVoiceURI={selectedVoiceURI}
                        speechRate={speechRate}
                        showTTSSettingsId={showTTSSettingsId}
                        onSetEditText={setEditText}
                        onStartEditing={handleStartEditing}
                        onCancelEditing={handleCancelEditing}
                        onSaveEdit={handleSaveEdit}
                        onHandleSpeak={handleSpeak}
                        onHandleStopSpeak={handleStopSpeak}
                        onHandleCopy={handleCopy}
                        onHandleReply={handleReply}
                        onHandleShare={handleShare}
                        onToggleTTSSettings={handleToggleTTSSettings}
                        onSaveTTSSettings={handleSaveTTSSettings}
                        onSuggestionClick={onSuggestionClick}
                    />
                )}
                components={{
                    Header: () => <div className="h-30" />,
                    Footer: () => (
                      <div style={{ height: footerHeight }}>
                        {/* Thinking Indicator */}
                        {showThinkingDots && (
                           <div className="max-w-4xl mx-auto w-full px-5 py-6">
                               <div className="flex items-center gap-3">
                                   <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white shadow-sm animate-pulse">
                                      <Sparkles size={12} />
                                   </div>
                                   <span className="text-sm font-medium text-gray-400">Thinking...</span>
                               </div>
                           </div>
                        )}
                      </div>
                    )
                }}
            />
            {showScrollToBottom && (
                <button
                    onClick={scrollToBottom}
                    className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 p-2 bg-white dark:bg-[#1a1b1e] text-gray-600 dark:text-gray-200 rounded-full shadow-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all"
                    title="Scroll to bottom"
                >
                    <ArrowDown size={20} />
                </button>
            )}
        </div>
    );
};

export default MessageList;