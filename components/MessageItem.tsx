import React, { useEffect, useRef, useState } from 'react';
import { ChatMessage, Role, Attachment, Source } from '../types';
import MarkdownRenderer from './MarkdownRenderer';
import {
  AlertCircle, Copy, Check,
  FileText, Pencil, Volume2, Square,
  FileCode, FileSpreadsheet, File, Reply, Settings2, X, Share2, Globe, ChevronDown, Printer
} from 'lucide-react';
import { printMessage } from '../utils/printMessage';
import { previewDocument } from '../utils/previewDocument';

// --- Helper Functions ---
export const getFileIcon = (mimeType: string) => {
  if (mimeType.includes('pdf')) return FileText;
  if (mimeType.includes('spreadsheet') || mimeType.includes('csv') || mimeType.includes('excel')) return FileSpreadsheet;
  if (mimeType.includes('json') || mimeType.includes('script') || mimeType.includes('html') || mimeType.includes('xml') || mimeType.includes('code')) return FileCode;
  if (mimeType.startsWith('text/')) return FileText;
  return File;
};

export const formatFileSize = (base64: string) => {
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

// --- MessageItem Props Interface ---
export interface MessageItemProps {
  msg: ChatMessage;
  editingId: string | null;
  editText: string;
  speakingId: string | null;
  copiedId: string | null;
  voices: SpeechSynthesisVoice[];
  selectedVoiceURI: string;
  speechRate: number;
  showTTSSettingsId: string | null;
  selectedModel?: string;
  isGeneratingImage?: boolean;
  currentMode?: 'image' | 'research' | null;
  onSetEditText: (text: string) => void;
  onStartEditing: (msg: ChatMessage) => void;
  onCancelEditing: () => void;
  onSaveEdit: (id: string) => void;
  onHandleSpeak: (text: string, id: string) => void;
  onHandleCopy: (text: string, id: string) => void;
  onHandleStopSpeak: () => void;
  onHandleReply: (msg: ChatMessage) => void;
  onHandleShare: (text: string) => void;
  onToggleTTSSettings: (id: string | null) => void;
  onSaveTTSSettings: (voiceURI: string, rate: number) => void;
  onOpenLightbox?: (src: string) => void;
}

// --- MessageItem Component ---
const MessageItem: React.FC<MessageItemProps> = ({
  msg,
  editingId,
  editText,
  speakingId,
  copiedId,
  voices,
  selectedVoiceURI,
  speechRate,
  showTTSSettingsId,
  selectedModel,
  isGeneratingImage,
  currentMode,
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
  onOpenLightbox
}) => {

  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
  const [isUserExpanded, setIsUserExpanded] = useState(false);
  const [isCollapsible, setIsCollapsible] = useState(false);
  const userTextRef = useRef<HTMLDivElement>(null);
  const isUser = msg.role === Role.USER;

  // Detect if user message text overflows (needs collapse button)
  useEffect(() => {
    if (isUser && userTextRef.current && editingId !== msg.id) {
      const element = userTextRef.current;
      // Check if content overflows the clamped height (with 2px tolerance)
      const hasOverflow = element.scrollHeight > element.clientHeight + 2;
      setIsCollapsible(hasOverflow);
    }
  }, [msg.text, isUser, editingId, msg.id]);

  // --- USER MESSAGE LAYOUT (BUBBLE) ---
  if (isUser) {
    const hasAttachments = msg.attachments && msg.attachments.length > 0;
    const isSingleImage = hasAttachments && msg.attachments.length === 1 && msg.attachments[0].mimeType.startsWith('image/');

    return (
      <div className="w-full py-4 group">
        <div className="max-w-4xl mx-auto w-full px-5 md:px-8 flex flex-col items-end">

            {/* 1. Attachments Display */}
            {hasAttachments && (
                <div className="mb-1 flex justify-end max-w-full">
                    {isSingleImage ? (
                        <div className="relative rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-[#1a1b1e] max-w-[70%] max-h-[400px]">
                            <img
                                src={msg.attachments[0].storageUrl || `data:${msg.attachments[0].mimeType};base64,${msg.attachments[0].data}`}
                                alt="attachment"
                                className="w-full h-auto object-contain max-h-[400px] cursor-pointer"
                                onClick={() => onOpenLightbox?.(msg.attachments[0].storageUrl || `data:${msg.attachments[0].mimeType};base64,${msg.attachments[0].data}`)}
                            />
                        </div>
                    ) : (
                        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide max-w-full mask-fade-right">
                            {msg.attachments.map((att: Attachment, idx: number) => (
                                <div key={idx} className="relative flex-shrink-0 group/att">
                                    {att.mimeType.startsWith('image/') ? (
                                        <div className="relative h-24 w-24 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-[#1a1b1e]">
                                            <img
                                                src={att.storageUrl || `data:${att.mimeType};base64,${att.data}`}
                                                alt="attachment"
                                                className="h-full w-full object-contain cursor-pointer"
                                                onClick={() => onOpenLightbox?.(att.storageUrl || `data:${att.mimeType};base64,${att.data}`)}
                                            />
                                        </div>
                                    ) : (
                                        <div
                                            onClick={() => previewDocument(att)}
                                            className={`h-16 w-48 flex items-center gap-3 p-3 bg-white dark:bg-[#1a1b1e] border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm ${att.mimeType === 'application/pdf' ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-[#252629] transition-colors' : ''}`}
                                        >
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

            <div className="relative flex flex-col items-end gap-1 max-w-[85%] md:max-w-[75%] min-w-0">
                {/* Actions */}
                {msg.text && (
                    <div className="absolute right-full top-0 mr-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => onStartEditing(msg)} className="p-1.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" title="Edit"><Pencil size={14}/></button>
                    <button onClick={() => onHandleReply(msg)} className="p-1.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" title="Reply"><Reply size={14}/></button>
                    </div>
                )}

                {/* Text Bubble */}
                {msg.text && (
                    <div className="relative px-5 py-3.5 bg-gray-100 dark:bg-[#2d2e33] text-gray-900 dark:text-white rounded-[24px] rounded-tr-sm shadow-sm max-w-full overflow-hidden">
                        <div
                            ref={userTextRef}
                            className={`text-sm md:text-base leading-relaxed font-sans overflow-hidden transition-all duration-300 ${
                                !isUserExpanded && editingId !== msg.id ? 'line-clamp-3 md:line-clamp-5' : ''
                            }`}
                        >
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

                        {/* Expand/Collapse Toggle - Gemini style */}
                        {isCollapsible && editingId !== msg.id && (
                            <button
                                onClick={() => setIsUserExpanded(!isUserExpanded)}
                                className="absolute top-3 right-3 p-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
                                title={isUserExpanded ? "Show less" : "Show more"}
                            >
                                <ChevronDown size={16} className={`transition-transform duration-300 ${isUserExpanded ? 'rotate-180' : ''}`} />
                            </button>
                        )}
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

  // --- BOT MESSAGE LAYOUT ---
  return (
    <div className="flex flex-col w-full px-5 py-6 md:px-8 group">
      <div className="max-w-4xl mx-auto w-full">

        {/* Header */}
        <div className="flex items-center gap-3 mb-3 select-none">
            <div className="relative w-9 h-9 flex items-center justify-center">
                {/* Half-circle dashed spinner - wraps around entire 9x9 container */}
                {msg.isStreaming && (
                    <div className="absolute inset-0" style={{ animation: 'spinnerPulse 1.8s ease-in-out infinite' }}>
                        <div className="w-full h-full rounded-full border-2 border-transparent border-t-blue-300 border-r-blue-300"
                             style={{ borderStyle: 'dashed' }}>
                        </div>
                    </div>
                )}

                {/* Logo in center - 6x6 inside 9x9 container */}
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 shadow-sm overflow-hidden ${
                    msg.error
                      ? 'bg-red-100 text-red-500'
                      : msg.isStreaming && (!msg.text || msg.text.length === 0)
                        ? 'bg-gradient-to-br from-blue-500 to-purple-600 text-white animate-pulse'
                        : 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white'
                }`}>
                   {msg.error ? <AlertCircle size={14} /> : <img src="/stilq-icon.png" alt="Stilq" className="w-full h-full object-cover" />}
                </div>
            </div>

            <div className="flex items-center gap-2">
                {/* Dynamic status - shown at start of streaming before text arrives */}
                {msg.isStreaming && !msg.text && !msg.thinkingHeader && (
                    <span className="text-[10px] font-medium uppercase tracking-wide animate-shimmer bg-gradient-to-r from-gray-600 via-gray-400 to-gray-600 dark:from-gray-500 dark:via-gray-200 dark:to-gray-500 bg-[length:200%_100%] bg-clip-text text-transparent">
                        {selectedModel === 'gemini-3-pro-image-preview' ? 'Imagining' : currentMode === 'research' ? 'Deep researching' : 'Just a sec'}
                    </span>
                )}

                {/* Dynamic thinking header - shown during streaming */}
                {msg.isStreaming && msg.thinkingHeader && (
                    <span className="text-[10px] font-medium uppercase tracking-wide animate-shimmer bg-gradient-to-r from-gray-600 via-gray-400 to-gray-600 dark:from-gray-500 dark:via-gray-200 dark:to-gray-500 bg-[length:200%_100%] bg-clip-text text-transparent">
                        {msg.thinkingHeader}
                    </span>
                )}

                {/* Thinking Process button - shown when response is complete (replaces thinking header) */}
                {msg.thinking && !msg.isStreaming && (
                    <button
                        onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
                        className="flex items-center gap-1.5 ml-2 px-2 py-1 rounded-full bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 transition-colors text-[10px] font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-transparent"
                    >
                        <span>Thinking Process</span>
                        <ChevronDown size={10} className={`transition-transform duration-200 ${isThinkingExpanded ? 'rotate-180' : ''}`} />
                    </button>
                )}
            </div>
        </div>

        {/* Thinking Block */}
        {msg.thinking && isThinkingExpanded && (
            <div className="ml-0 md:ml-9 mb-4 p-4 bg-gray-50 dark:bg-[#1a1b1e] rounded-xl text-xs leading-relaxed text-gray-600 dark:text-gray-400 border-l-2 border-purple-500/50 animate-slide-down shadow-inner">
                <MarkdownRenderer content={msg.thinking} />
            </div>
        )}

        {/* Body */}
        <div className="pl-0 md:pl-9 w-full">
            {msg.isStreaming && (!msg.text || msg.text.length === 0) ? (
                <div className="h-4"></div>
            ) : (
                <>
                    <div className="text-[15px] md:text-[16px] leading-7 text-gray-800 dark:text-gray-200 markdown-body font-sans antialiased">
                         {/* Render text with inline graphs AND images */}
                         {(() => {
                             // Split text by [GRAPH:X] and [IMAGE:X] markers
                             const parts = msg.text.split(/(\[(?:GRAPH|IMAGE):\d+\])/);
                             return parts.map((part, idx) => {
                                 const graphMatch = part.match(/\[GRAPH:(\d+)\]/);
                                 const imageMatch = part.match(/\[IMAGE:(\d+)\]/);

                                 if (graphMatch) {
                                     // Render graph inline
                                     const graphIndex = parseInt(graphMatch[1], 10);
                                     const att = msg.attachments?.[graphIndex];
                                     if (att && att.isGraph) {
                                         const cssRatio = (att.aspectRatio || '1:1').replace(':', '/');
                                         if (att.isPlaceholder) {
                                             return (
                                                 <div
                                                     key={idx}
                                                     className="my-4 relative rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-[#1a1b1e] animate-pulse"
                                                     style={{ width: '400px', maxWidth: '100%', aspectRatio: cssRatio }}
                                                 >
                                                     <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                                                         <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Generating graph...</span>
                                                     </div>
                                                 </div>
                                             );
                                         }
                                         if (att.storageUrl || att.data) {
                                             const imgSrc = att.storageUrl || `data:${att.mimeType};base64,${att.data}`;
                                             return (
                                                 <div
                                                     key={idx}
                                                     className="my-4 relative rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-[#1a1b1e]"
                                                     style={{ width: '400px', maxWidth: '100%', aspectRatio: cssRatio }}
                                                 >
                                                     <img
                                                         src={imgSrc}
                                                         alt="Graph"
                                                         className="w-full h-full object-contain cursor-pointer"
                                                         onClick={() => onOpenLightbox?.(imgSrc)}
                                                     />
                                                 </div>
                                             );
                                         }
                                     }
                                     return null;
                                 }

                                 if (imageMatch) {
                                     // Render image inline
                                     const imageIndex = parseInt(imageMatch[1], 10);
                                     const att = msg.attachments?.[imageIndex];
                                     if (att && att.mimeType?.startsWith('image/')) {
                                         const cssRatio = (att.aspectRatio || '1:1').replace(':', '/');
                                         if (att.isPlaceholder) {
                                             return (
                                                 <div
                                                     key={idx}
                                                     className="my-4 relative rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-[#1a1b1e] animate-pulse"
                                                     style={{ width: '400px', maxWidth: '100%', aspectRatio: cssRatio }}
                                                 >
                                                     <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                                                         <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Generating image...</span>
                                                     </div>
                                                 </div>
                                             );
                                         }
                                         if (att.storageUrl || att.data) {
                                             const imgSrc = att.storageUrl || `data:${att.mimeType};base64,${att.data}`;
                                             return (
                                                 <div
                                                     key={idx}
                                                     className="my-4 relative rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-[#1a1b1e]"
                                                     style={{ width: '400px', maxWidth: '100%', aspectRatio: cssRatio }}
                                                 >
                                                     <img
                                                         src={imgSrc}
                                                         alt="Generated image"
                                                         className="w-full h-full object-contain cursor-pointer"
                                                         onClick={() => onOpenLightbox?.(imgSrc)}
                                                     />
                                                 </div>
                                             );
                                         }
                                     }
                                     return null;
                                 }

                                 // Render text part
                                 return part ? <MarkdownRenderer key={idx} content={part} /> : null;
                             });
                         })()}
                    </div>
                </>
            )}

            {/* Gallery: Only images WITHOUT inline markers (graphs + inline images are already rendered above) */}
            {msg.attachments && (() => {
                // Find indices of images that have inline markers
                const inlineIndices = new Set<number>();
                const markerRegex = /\[IMAGE:(\d+)\]/g;
                let match: RegExpExecArray | null;
                while ((match = markerRegex.exec(msg.text)) !== null) {
                    inlineIndices.add(parseInt(match[1], 10));
                }

                // Filter: non-graph, non-inline images only
                const galleryAttachments = msg.attachments.filter((att, attIdx) =>
                    !att.isGraph && !inlineIndices.has(attIdx)
                );

                if (galleryAttachments.length === 0) return null;

                return (
                    <div className="mt-4 flex flex-wrap gap-3">
                        {galleryAttachments.map((att: Attachment, displayIdx: number) => {
                            if (!att.mimeType?.startsWith('image/')) return null;

                            // Convert "16:9" to "16/9" for CSS aspect-ratio
                            const cssRatio = (att.aspectRatio || '1:1').replace(':', '/');

                            // Placeholder skeleton - fixed width 400px with aspect-ratio for height
                            if (att.isPlaceholder) {
                                return (
                                    <div
                                        key={displayIdx}
                                        className="relative rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-[#1a1b1e] animate-pulse"
                                        style={{ width: '400px', maxWidth: '100%', aspectRatio: cssRatio }}
                                    >
                                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Generating image...</span>
                                        </div>
                                    </div>
                                );
                            }

                            // Real image - same fixed width to prevent layout shift
                            if (att.storageUrl || att.data) {
                                const imgSrc = att.storageUrl || `data:${att.mimeType};base64,${att.data}`;
                                return (
                                    <div
                                        key={displayIdx}
                                        className="relative rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-[#1a1b1e]"
                                        style={{ width: '400px', maxWidth: '100%', aspectRatio: cssRatio }}
                                    >
                                        <img
                                            src={imgSrc}
                                            alt="Generated image"
                                            className="w-full h-full object-contain cursor-pointer"
                                            onClick={() => onOpenLightbox?.(imgSrc)}
                                        />
                                    </div>
                                );
                            }

                            return null;
                        })}
                    </div>
                );
            })()}

            {/* Footer */}
            <div className="mt-4 pt-2 flex flex-col gap-3">
                {msg.sources && msg.sources.length > 0 && (
                    <div className="w-full overflow-hidden">
                        <div className="flex items-center gap-1.5 mb-2">
                             <Globe size={12} className="text-blue-500" />
                             <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Sources</span>
                        </div>
                        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide mask-fade-right w-full">
                            {msg.sources.map((source: Source, idx: number) => (
                                <a key={idx} href={source.url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 flex flex-col justify-center px-3 py-2 w-[160px] bg-white dark:bg-[#1a1b1e] border border-gray-200 dark:border-gray-800 hover:border-blue-400 dark:hover:border-blue-500/50 rounded-xl transition-all group/source no-underline h-[52px]" title={source.title}>
                                    <span className="text-[11px] font-medium text-gray-700 dark:text-gray-200 truncate w-full block">{source.title}</span>
                                    <span className="text-[9px] text-gray-400 truncate w-full block mt-0.5 opacity-70 group-hover/source:opacity-100">{new URL(source.url).hostname.replace('www.', '')}</span>
                                </a>
                            ))}
                        </div>
                    </div>
                )}

                {!msg.isStreaming && !msg.error && (
                    <div className="flex items-center justify-between pt-2 md:pt-0">
                        <div className="flex items-center gap-1">
                             <button onClick={() => onHandleCopy(msg.text, msg.id)} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-all" title="Copy">{copiedId === msg.id ? <Check size={14} className="text-green-500"/> : <Copy size={14}/>}</button>
                             <div className="relative">
                                 <button onClick={() => speakingId === msg.id ? onHandleStopSpeak() : onHandleSpeak(msg.text, msg.id)} className={`p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-all ${speakingId === msg.id ? 'text-blue-500' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'}`}>{speakingId === msg.id ? <Square size={14} fill="currentColor"/> : <Volume2 size={14}/>}</button>
                             </div>
                             <button onClick={() => onHandleShare(msg.text)} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-all" title="Share"><Share2 size={14}/></button>
                             <button onClick={() => printMessage(msg)} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-all" title="Print"><Printer size={14}/></button>
                             <div className="relative">
                                <button onClick={() => onToggleTTSSettings(msg.id)} className={`p-1.5 rounded-full transition-all ${showTTSSettingsId === msg.id ? 'text-blue-500 bg-blue-500/10' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}`}><Settings2 size={14}/></button>
                                {showTTSSettingsId === msg.id && (
                                  <div className="absolute bottom-full left-0 mb-2 w-64 bg-white dark:bg-[#1e1f20] border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-3 z-10 animate-fade-in">
                                      <div className="flex justify-between items-center mb-2"><span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Voice Settings</span><button onClick={() => onToggleTTSSettings(null)} className="text-gray-500 hover:text-gray-900 dark:hover:text-white"><X size={12}/></button></div>
                                      <div className="space-y-3">
                                          <div><label className="text-xs text-gray-600 dark:text-gray-300 mb-1 block">Voice</label><select value={selectedVoiceURI} onChange={(e) => onSaveTTSSettings(e.target.value, speechRate)} className="w-full bg-gray-50 dark:bg-[#2d2e33] border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-xs text-gray-900 dark:text-gray-200 focus:outline-none">{voices.map((v: SpeechSynthesisVoice) => (<option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>))}</select></div>
                                          <div><div className="flex justify-between text-xs mb-1 text-gray-600 dark:text-gray-300"><span>Speed</span><span className="font-medium text-blue-600 dark:text-blue-400">{speechRate}x</span></div><input type="range" min="0.5" max="2" step="0.1" value={speechRate} onChange={(e) => onSaveTTSSettings(selectedVoiceURI, parseFloat(e.target.value))} className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"/></div>
                                      </div>
                                  </div>
                                )}
                             </div>
                             <button onClick={() => onHandleReply(msg)} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-all" title="Reply"><Reply size={14}/></button>
                        </div>
                        <span className="text-[10px] text-gray-300 dark:text-gray-600 font-medium">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default MessageItem;
