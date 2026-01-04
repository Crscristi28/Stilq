import React, { useEffect, useRef, useState } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { ChatMessage, Role, UserProfile } from '../types';
import { ArrowDown } from 'lucide-react';
import { translations, Language } from '../translations';
import MessageItem from './MessageItem';

interface MessageListProps {
  messages: ChatMessage[];
  isThinking: boolean;
  selectedModel?: string;
  isGeneratingImage?: boolean;
  currentMode?: 'image' | 'research' | null;
  onEdit?: (id: string, newText: string) => void;
  onReply?: (msg: ChatMessage) => void;
  onSuggestionClick?: (text: string) => void;
  minFooterHeight: number;
  user?: UserProfile | null;
  language: string;
  sessionId?: string | null;
  onOpenLightbox?: (src: string) => void;
}

// --- Main MessageList Component ---
const MessageList: React.FC<MessageListProps> = ({ messages, isThinking, selectedModel, isGeneratingImage, currentMode, onEdit, onReply, onSuggestionClick, minFooterHeight, user, language, sessionId, onOpenLightbox }) => {
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [speakingId, setSpeakingId] = useState<string | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    const [footerHeight, setFooterHeight] = useState<string>(`${minFooterHeight}px`);
    const [isFooterBig, setIsFooterBig] = useState<boolean>(false);
    const justSentMessageRef = useRef<boolean>(false);
    const prevSessionIdRef = useRef<string | null>(null);
    const needsScrollRef = useRef<boolean>(false);
    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [selectedVoiceURI, setSelectedVoiceURI] = useState('');
    const [speechRate, setSpeechRate] = useState(1);
    const [showTTSSettingsId, setShowTTSSettingsId] = useState<string | null>(null);

    const t = (key: keyof typeof translations['en']) => {
        const lang = (language as Language) || 'en';
        return translations[lang]?.[key] || translations['en'][key];
    };

    useEffect(() => {
        const loadVoices = () => {
            const availableVoices = window.speechSynthesis.getVoices();
            setVoices(availableVoices);
            try {
                const saved = localStorage.getItem('stilq_settings_v1');
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

    useEffect(() => {
        if (!isFooterBig) {
            setFooterHeight(`${minFooterHeight}px`);
        }
    }, [minFooterHeight, isFooterBig]);

    // Step 1: Detect session change, mark that we need scroll
    useEffect(() => {
        if (sessionId && prevSessionIdRef.current !== sessionId) {
            prevSessionIdRef.current = sessionId;
            needsScrollRef.current = true;
        }
    }, [sessionId]);

    // Step 2: When messages loaded and we need scroll, do it
    useEffect(() => {
        if (needsScrollRef.current && messages.length > 0) {
            needsScrollRef.current = false;

            const timer = setTimeout(() => {
                virtuosoRef.current?.scrollToIndex({
                    index: messages.length - 1,
                    align: 'start',
                    behavior: 'auto'
                });
            }, 100);

            return () => clearTimeout(timer);
        }
    }, [messages.length]);

    useEffect(() => {
        if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            if (lastMessage.role === Role.USER) {
                setFooterHeight('60vh');
                setIsFooterBig(true);
                justSentMessageRef.current = true;
                setTimeout(() => {
                    virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, align: 'start', behavior: 'smooth' });
                }, 100);
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
        const savedVoice = localStorage.getItem('stilq_settings_v1');
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
            const saved = localStorage.getItem('stilq_settings_v1');
            const settings = saved ? JSON.parse(saved) : {};
            settings.defaultVoiceURI = voiceURI;
            settings.defaultSpeechRate = rate;
            localStorage.setItem('stilq_settings_v1', JSON.stringify(settings));
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
        virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, align: 'start', behavior: 'auto' });
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

    // --- WELCOME SCREEN ---
    if (messages.length === 0 && !isThinking) {
        const userName = user?.displayName ? user.displayName.split(' ')[0] : 'User';
        return (
            <div className="flex-1 w-full flex flex-col items-start justify-start pt-48 px-6 md:px-10 overflow-y-auto">
                <h1 className="text-xl md:text-2xl font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-blue-500 to-teal-400 dark:from-blue-400 dark:to-teal-400">
                    {t('greetingHello')} {userName}
                </h1>
                <p className="text-3xl md:text-4xl text-gray-900 dark:text-white font-medium">
                    {t('greetingSubtitle')}
                </p>
            </div>
        );
    }

    return (
        <div className="flex-1 w-full relative flex flex-col">
            <Virtuoso
                ref={virtuosoRef}
                data={messages}
                computeItemKey={(_, msg) => msg.id}
                increaseViewportBy={800}
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
                        selectedModel={selectedModel}
                        isGeneratingImage={isGeneratingImage}
                        currentMode={currentMode}
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
                        onOpenLightbox={onOpenLightbox}
                    />
                )}
                components={{ Footer: () => <div style={{ height: footerHeight }} /> }}
            />
            {showScrollToBottom && (
                <button onClick={scrollToBottom} className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 p-2 bg-white dark:bg-[#1a1b1e] text-gray-600 dark:text-gray-200 rounded-full shadow-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all" title="Scroll to bottom"><ArrowDown size={20} /></button>
            )}
        </div>
    );
};

export default MessageList;
