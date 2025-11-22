import React, { useEffect, useRef, useState } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { ChatMessage, Role } from '../types';
import MarkdownRenderer from './MarkdownRenderer';
import { 
  AlertCircle, Sparkles, Copy, Check, 
  FileText, Pencil, Volume2, Square, 
  FileCode, FileSpreadsheet, File, Reply, Lightbulb, Settings2, X, Share2
} from 'lucide-react';

interface MessageListProps {
  messages: ChatMessage[];
  isThinking: boolean;
  onEdit?: (id: string, newText: string) => void;
  onReply?: (msg: ChatMessage) => void;
  onSuggestionClick?: (text: string) => void;
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

  // Don't render content if it's a placeholder waiting for text.
  if (msg.role === Role.MODEL && msg.isStreaming && (!msg.text || msg.text.length === 0)) {
      return null;
  }
  
  const isUser = msg.role === Role.USER;

  return (
    <div className={`flex gap-3 md:gap-4 max-w-4xl mx-auto w-full px-4 py-4 ${
      isUser ? 'justify-end' : 'justify-start'
    }`}>
      {/* Avatar for Model */}
      {!isUser && (
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 shadow-lg ${
            msg.error ? 'bg-red-100 dark:bg-red-500/20 text-red-500 dark:text-red-400' : 'bg-gradient-to-br from-blue-500 to-purple-600 text-white'
        }`}>
           {msg.error ? <AlertCircle size={18} /> : <Sparkles size={16} />}
        </div>
      )}

      <div className={`flex flex-col max-w-[85%] md:max-w-[75%] space-y-1 ${
        isUser ? 'items-end' : 'items-start'
      }`}>
        
        {/* Message Bubble */}
        {editingId === msg.id ? (
           <div className="w-full min-w-[280px] bg-white dark:bg-[#2d2e33] rounded-2xl p-3 border border-gray-200 dark:border-gray-600 shadow-lg animate-fade-in">
              <textarea
                value={editText}
                onChange={(e) => onSetEditText(e.target.value)}
                className="w-full bg-transparent text-gray-900 dark:text-gray-100 resize-none focus:outline-none text-sm leading-relaxed scrollbar-hide"
                rows={Math.max(2, editText.split('\n').length)}
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-3">
                <button 
                  onClick={onCancelEditing}
                  className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => onSaveEdit(msg.id)}
                  className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors flex items-center gap-1"
                >
                  <Check size={12} /> Save
                </button>
              </div>
           </div>
        ) : (
          <div className="group relative flex flex-col items-start gap-2 max-w-full">
            {/* Edit and Reply buttons for User messages - positioned to the left */}
            {isUser && (
                <div className="absolute right-full top-0 mr-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={() => onStartEditing(msg)}
                        className="p-1.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        title="Edit message"
                    >
                        <Pencil size={14} />
                    </button>
                    <button
                        onClick={() => onHandleReply(msg)}
                        className="p-1.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        title="Reply"
                    >
                        <Reply size={14} />
                    </button>
                </div>
            )}

            {/* Message Bubble */}
            <div className={`relative ${isUser ? 'px-4' : 'pr-4 pl-1'} py-3 shadow-sm ${
              isUser
                ? 'bg-gray-100 dark:bg-[#2d2e33] text-gray-900 dark:text-gray-100 rounded-2xl rounded-br-sm'
                : 'text-gray-900 dark:text-gray-100 w-full overflow-hidden'
            }`}>
                {/* Attachments Display */}
                {msg.attachments && msg.attachments.length > 0 && (
                    <div className={`mb-3 flex flex-wrap gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
                        {msg.attachments.map((att: any, idx: number) => (
                            <div key={idx} className="relative group">
                                {att.mimeType.startsWith('image/') ? (
                                    <img
                                        src={att.storageUrl || `data:${att.mimeType};base64,${att.data}`}
                                        alt={att.name || 'attachment'}
                                        className="h-24 w-24 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                                    />
                                ) : (
                                    <div className="flex items-center gap-2 p-2 bg-white dark:bg-black/20 rounded-lg border border-gray-200 dark:border-gray-700/50">
                                        {React.createElement(getFileIcon(att.mimeType), { size: 20, className: "text-gray-500" })}
                                        <div className="flex flex-col max-w-[120px]">
                                            <span className="text-xs font-medium truncate">{att.name || 'File'}</span>
                                            <span className="text-[10px] text-gray-500">{formatFileSize(att.data || '')}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                <div className={`text-sm leading-relaxed overflow-x-auto ${isUser ? 'whitespace-pre-wrap' : ''}`}>
                  {isUser ? msg.text : <MarkdownRenderer content={msg.text} />}
                </div>
            </div>

            {/* Timestamp */}
            {!msg.isStreaming && (
            <div className={`text-[10px] text-gray-400 dark:text-gray-600 select-none ${isUser ? 'self-end mr-1' : 'ml-1'}`}>
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {msg.error && <span className="text-red-500 ml-2">Failed to send</span>}
            </div>
            )}

            {/* Action Bar - AI Messages */}
            {!isUser && !msg.error && !msg.isStreaming && (
                <div className="flex items-center gap-1 mt-1 ml-1 text-gray-400 transition-opacity duration-200 opacity-100 md:opacity-0 md:group-hover:opacity-100">
                  <button
                      onClick={() => onHandleCopy(msg.text, msg.id)}
                      className="p-1.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg"
                      title="Copy"
                  >
                      {copiedId === msg.id ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                  </button>

                  <div className="relative">
                    <button
                        onClick={() => speakingId === msg.id ? onHandleStopSpeak() : onHandleSpeak(msg.text, msg.id)}
                        className={`p-1.5 transition-colors rounded-lg ${speakingId === msg.id ? 'text-blue-500 animate-pulse' : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'}`}
                        title={speakingId === msg.id ? "Stop speaking" : "Read aloud"}
                    >
                        {speakingId === msg.id ? <Square size={14} fill="currentColor" /> : <Volume2 size={14} />}
                    </button>
                  </div>

                  {/* TTS Settings Button */}
                  <div className="relative">
                    <button
                        onClick={() => onToggleTTSSettings(msg.id)}
                        className={`p-1.5 rounded-lg transition-colors ${
                            showTTSSettingsId === msg.id ? 'text-blue-400 bg-blue-500/10' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                        }`}
                        title="Voice settings"
                    >
                        <Settings2 size={14} />
                    </button>
                    {/* TTS Settings Popover */}
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
                                      {voices.map((v) => (
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

                  <button
                      onClick={() => onHandleReply(msg)}
                      className="p-1.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg"
                      title="Reply"
                  >
                      <Reply size={14} />
                  </button>

                  {/* Share Button */}
                  <button
                      onClick={() => onHandleShare(msg.text)}
                      className="p-1.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg"
                      title="Share"
                  >
                      <Share2 size={14} />
                  </button>
                </div>
            )}

            {/* Suggestion Chips */}
            {!isUser && !msg.error && !msg.isStreaming && msg.suggestions && msg.suggestions.length > 0 && (
               <div className="flex flex-wrap gap-2 mt-1 ml-2 animate-slide-up">
                  {msg.suggestions.map((suggestion: string, idx: number) => (
                     <button
                        key={idx}
                        onClick={() => onSuggestionClick && onSuggestionClick(suggestion)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white dark:bg-[#2d2e33] border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#3d3e44] hover:border-blue-300 dark:hover:border-blue-500/50 transition-all shadow-sm group/chip"
                     >
                        <Lightbulb size={12} className="text-gray-400 group-hover/chip:text-yellow-500 transition-colors" />
                        {suggestion}
                     </button>
                  ))}
               </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// --- Main MessageList Component ---
const MessageList: React.FC<MessageListProps> = ({ messages, isThinking, onEdit, onReply, onSuggestionClick }) => {
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [speakingId, setSpeakingId] = useState<string | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);

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

    // Auto-scroll logic
    useEffect(() => {
        if (messages.length > 0) {
            setTimeout(() => {
                virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, align: 'end', behavior: 'smooth' });
            }, 100);
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
        <Virtuoso
            ref={virtuosoRef}
            data={messages}
            className="flex-1 w-full scrollbar-hide" // Use flex-1 to fill remaining space correctly
            atBottomThreshold={60}
            followOutput="smooth"
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
                Header: () => <div className="h-32" />,
                Footer: () => (
                  <div className="pb-4">
                    {/* Thinking Indicator */}
                    {showThinkingDots && (
                       <div className="flex gap-4 max-w-4xl mx-auto w-full px-4 py-4">
                           <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0 mt-1 shadow-lg text-white">
                              <Sparkles size={16} />
                           </div>
                           <div className="flex items-center gap-1 bg-white dark:bg-[#2d2e33] rounded-2xl rounded-tl-none px-4 py-3 w-16 h-[46px] shadow-sm border border-gray-100 dark:border-gray-800">
                              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                           </div>
                       </div>
                    )}
                  </div>
                )
            }}
        />
    );
};

export default MessageList;