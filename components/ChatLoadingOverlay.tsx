/**
 * Chat Loading Overlay
 * Gemini-style loading screen that covers chat area + input
 * Shows spinner when switching sessions, hides when messages load
 */

import React, { useState, useEffect, useRef } from 'react';

interface ChatLoadingOverlayProps {
    sessionId: string | null;
}

const ChatLoadingOverlay: React.FC<ChatLoadingOverlayProps> = ({ sessionId }) => {
    const [isVisible, setIsVisible] = useState(false);
    const [isFadingOut, setIsFadingOut] = useState(false);
    const prevSessionIdRef = useRef<string | null>(null);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Simple: Session change → show overlay → hide after fixed time
    useEffect(() => {
        if (sessionId && prevSessionIdRef.current !== sessionId) {
            prevSessionIdRef.current = sessionId;
            setIsVisible(true);
            setIsFadingOut(false);

            // Clear any existing timeout
            if (timeoutRef.current) clearTimeout(timeoutRef.current);

            // Fixed 500ms display, then fade out
            timeoutRef.current = setTimeout(() => {
                setIsFadingOut(true);
                setTimeout(() => {
                    setIsVisible(false);
                    setIsFadingOut(false);
                }, 200); // fade animation duration
            }, 500);
        }

        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [sessionId]);

    if (!isVisible) return null;

    return (
        <div
            className={`absolute inset-0 z-40 flex items-center justify-center bg-white dark:bg-[#0e0e10] transition-opacity duration-200 ${
                isFadingOut ? 'opacity-0' : 'opacity-100'
            }`}
        >
            {/* Gemini-style arc spinner */}
            <div className="w-7 h-7 border-[3px] border-transparent border-t-blue-400 rounded-full animate-spin" />
        </div>
    );
};

export default ChatLoadingOverlay;
