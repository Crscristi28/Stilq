import React, { useState, useMemo } from 'react';
import { Plus, MessageSquare, Trash2, X, Sparkles, Settings, ChevronDown, Image as ImageIcon, LogOut } from 'lucide-react';
import { ChatSession, Role, UserProfile } from '../types';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: ChatSession[];
  currentSessionId: string;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string, e: React.MouseEvent) => void;
  onRenameSession: (id: string, newTitle: string) => void;
  onOpenSettings: () => void;
  user: UserProfile | null;
  onSignOut: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  sessions,
  currentSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  onRenameSession,
  onOpenSettings,
  user,
  onSignOut,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  // Sort sessions by newest first
  const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  const handleStartEdit = (session: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation(); 
    setEditingId(session.id);
    setEditTitle(session.title);
  };

  const handleSaveEdit = (id: string) => {
    if (editTitle.trim()) {
        onRenameSession(id, editTitle.trim());
    }
    setEditingId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') {
        handleSaveEdit(id);
    } else if (e.key === 'Escape') {
        setEditingId(null);
    }
  };

  const toggleImages = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setExpandedSessionId(prev => prev === sessionId ? null : sessionId);
  };

  // Extract images from session messages (memoized to avoid re-parsing constantly)
  // Note: In Firestore version, messages are not stored in sessions, so this will be empty
  const sessionImagesMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    sessions.forEach(session => {
        const images: string[] = [];
        // Only process if messages exist (they won't in Firestore version)
        if (session.messages && Array.isArray(session.messages)) {
            session.messages.forEach(msg => {
                if (msg.role === Role.MODEL) {
                    // Regex to find markdown images: ![alt](url)
                    // We specifically look for data:image urls which are generated images
                    const regex = /!\[.*?\]\((data:image\/.*?;base64,.*?)\)/g;
                    let match;
                    while ((match = regex.exec(msg.text)) !== null) {
                        images.push(match[1]);
                    }
                }
            });
        }
        if (images.length > 0) {
            map[session.id] = images;
        }
    });
    return map;
  }, [sessions]);

  return (
    <>
      {/* Mobile Overlay */}
      <div
        className={`fixed inset-0 bg-black/60 dark:bg-black/60 z-40 transition-opacity duration-300 md:hidden ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sidebar Container */}
      <aside
        className={`fixed md:relative z-50 w-[280px] h-full bg-gray-50 dark:bg-[#1a1b1e] border-r border-gray-200 dark:border-gray-800/50 flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.2,0,0,1)] transform ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:w-0 md:border-none md:overflow-hidden'
        }`}
        aria-label="Sidebar"
      >
        {/* Header */}
        <div className="p-4 shrink-0">
          <div className="flex items-center justify-between mb-6 md:hidden">
             <span className="font-bold text-lg text-gray-900 dark:text-gray-200">Menu</span>
             <button 
               onClick={onClose} 
               className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
               aria-label="Close sidebar"
             >
               <X size={20}/>
             </button>
          </div>
          
          <button
            onClick={() => {
              onNewChat();
              if (window.innerWidth < 768) onClose();
            }}
            className="w-full flex items-center gap-3 px-4 py-3 bg-white dark:bg-[#2d2e33] hover:bg-gray-100 dark:hover:bg-[#3d3e44] text-gray-700 dark:text-gray-200 rounded-[16px] transition-colors shadow-sm border border-gray-200 dark:border-gray-700/30 group focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Start a new chat"
          >
            <div className="bg-blue-500/10 p-1 rounded-lg group-hover:bg-blue-500/20 transition-colors">
                <Plus size={18} className="text-blue-500 dark:text-blue-400" />
            </div>
            <span className="font-medium text-sm">New chat</span>
          </button>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto px-3 pb-4 scrollbar-hide space-y-1" role="list">
          <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wider" id="recent-chats-heading">Recent</div>
          
          {sortedSessions.length === 0 ? (
            <div className="px-4 py-8 text-center">
                <div className="w-12 h-12 bg-gray-200 dark:bg-gray-800/50 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Sparkles size={20} className="text-gray-400 dark:text-gray-600"/>
                </div>
                <p className="text-gray-500 text-sm">No chat history yet.</p>
            </div>
          ) : (
            sortedSessions.map((session) => {
              const isActive = currentSessionId === session.id;
              const generatedImages = sessionImagesMap[session.id] || [];
              const hasImages = generatedImages.length > 0;
              const isImagesExpanded = expandedSessionId === session.id;

              return (
                <div 
                  key={session.id}
                  className={`flex flex-col rounded-xl transition-all duration-200 ${
                    isActive
                      ? 'bg-gray-200 dark:bg-[#2d2e33] shadow-sm'
                      : 'hover:bg-gray-200/50 dark:hover:bg-gray-800/50'
                  }`}
                  role="listitem"
                >
                  <div className={`group w-full flex items-center gap-1 pr-2 ${
                    isActive ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}>
                      <div className="flex-1 min-w-0">
                        {editingId === session.id ? (
                            <div className="px-3 py-2">
                                <input
                                    autoFocus
                                    type="text"
                                    value={editTitle}
                                    onChange={(e) => setEditTitle(e.target.value)}
                                    onBlur={() => handleSaveEdit(session.id)}
                                    onKeyDown={(e) => handleKeyDown(e, session.id)}
                                    className="w-full bg-white dark:bg-[#1a1b1e] text-gray-900 dark:text-white text-sm px-2 py-1 rounded border border-blue-500 focus:outline-none"
                                />
                            </div>
                        ) : (
                            <button
                                onClick={() => {
                                    onSelectSession(session.id);
                                    if (window.innerWidth < 768) onClose();
                                }}
                                onDoubleClick={(e) => handleStartEdit(session, e)}
                                className="w-full flex items-center gap-3 px-3 py-3 text-left rounded-l-xl focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500/50"
                                aria-label={`Load chat: ${session.title || 'New Chat'}`}
                                aria-current={isActive ? 'page' : undefined}
                                title="Double click to rename"
                            >
                                <MessageSquare size={16} className={`shrink-0 ${isActive ? 'text-blue-500 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`} />
                                <span className="truncate text-sm font-medium block w-full">
                                    {session.title || 'New Chat'}
                                </span>
                            </button>
                        )}
                      </div>
                      
                      {/* Image Toggle Button */}
                      {hasImages && editingId !== session.id && (
                          <button
                              onClick={(e) => toggleImages(e, session.id)}
                              className={`p-1.5 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${
                                  isImagesExpanded 
                                    ? 'bg-blue-500/10 text-blue-500 dark:text-blue-400' 
                                    : 'text-gray-400 dark:text-gray-500 hover:bg-gray-300/50 dark:hover:bg-gray-700/50'
                              }`}
                              title="Toggle generated images"
                          >
                              {isImagesExpanded ? <ChevronDown size={14} /> : <ImageIcon size={14} />}
                          </button>
                      )}

                      {/* Delete Button */}
                      {editingId !== session.id && (
                        <button
                            type="button"
                            onClick={(e) => onDeleteSession(session.id, e)}
                            className={`p-1.5 rounded-lg hover:bg-red-500/10 dark:hover:bg-red-500/20 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-500/50 ${
                            isActive ? 'md:opacity-0 md:group-hover:opacity-100' : ''
                            }`}
                            aria-label={`Delete chat: ${session.title || 'New Chat'}`}
                        >
                            <Trash2 size={14} />
                        </button>
                      )}
                  </div>

                  {/* Generated Images Grid (Accordion) */}
                  {hasImages && isImagesExpanded && (
                      <div className="px-3 pb-3 pt-1 animate-slide-up">
                          <div className="grid grid-cols-3 gap-2">
                              {generatedImages.map((imgSrc, idx) => (
                                  <div key={idx} className="relative aspect-square rounded-lg overflow-hidden bg-black/10 dark:bg-white/5 border border-gray-200 dark:border-gray-700 group/img">
                                      <img 
                                        src={imgSrc} 
                                        alt={`Generated ${idx}`} 
                                        className="w-full h-full object-cover"
                                      />
                                      {/* Hover overlay */}
                                      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-colors" />
                                  </div>
                              ))}
                          </div>
                          <div className="mt-2 text-[10px] text-center text-gray-400 dark:text-gray-500">
                              {generatedImages.length} generated image{generatedImages.length !== 1 ? 's' : ''}
                          </div>
                      </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        
        {/* Footer/Info - User Profile & Settings */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-800/50 shrink-0">
             <div className="w-full flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-gray-200 dark:hover:bg-[#2d2e33] transition-colors group">
                {/* User Avatar */}
                {user?.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt="Profile"
                    className="w-8 h-8 rounded-full ring-2 ring-white dark:ring-black/50 group-hover:ring-gray-300 dark:group-hover:ring-gray-600 object-cover"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center text-xs font-bold text-white ring-2 ring-white dark:ring-black/50 group-hover:ring-gray-300 dark:group-hover:ring-gray-600">
                    {user?.displayName ? user.displayName[0].toUpperCase() : 'U'}
                  </div>
                )}

                {/* User Info */}
                <div className="flex-1 flex flex-col min-w-0">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200 group-hover:text-gray-900 dark:group-hover:text-white truncate">
                      {user?.displayName || 'User'}
                    </span>
                    <span className="text-xs text-gray-500 group-hover:text-gray-700 dark:group-hover:text-gray-400 truncate">
                      {user?.email || 'Pro Plan'}
                    </span>
                </div>

                {/* Settings Button */}
                <button
                  onClick={onOpenSettings}
                  className="p-1.5 rounded-lg hover:bg-gray-300/50 dark:hover:bg-gray-700/50 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  title="Settings"
                >
                  <Settings size={16} />
                </button>

                {/* Sign Out Button */}
                <button
                  onClick={onSignOut}
                  className="p-1.5 rounded-lg hover:bg-red-500/10 dark:hover:bg-red-500/20 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/50"
                  title="Sign Out"
                >
                  <LogOut size={16} />
                </button>
             </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;