
import React, { useState, useEffect } from 'react';
import { X, Moon, Sun, Monitor, Keyboard, Mic, Database, Globe, Info, Trash2, Download, Check } from 'lucide-react';
import { AppSettings, ChatSession } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (newSettings: AppSettings) => void;
  sessions: ChatSession[];
  onClearAllChats: () => void;
}

type SettingsTab = 'general' | 'voice' | 'data' | 'language' | 'about';

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  sessions,
  onClearAllChats,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const loadVoices = () => {
      setVoices(window.speechSynthesis.getVoices());
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const handleExportData = () => {
    const dataStr = JSON.stringify(sessions, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `elora-backup-${new Date().toISOString().slice(0,10)}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/20 dark:bg-black/60 backdrop-blur-sm animate-fade-in" 
        onClick={onClose}
      />

      {/* Modal Content */}
      <div className="relative bg-white dark:bg-[#1e1f20] w-full max-w-2xl rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 flex flex-col md:flex-row overflow-hidden max-h-[85vh] animate-slide-up">
        
        {/* Sidebar Navigation */}
        <div className="w-full md:w-64 bg-gray-50 dark:bg-[#1a1b1e] border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-800 p-4 flex flex-row md:flex-col gap-2 overflow-x-auto md:overflow-visible scrollbar-hide shrink-0">
          <div className="text-xs font-bold text-gray-500 dark:text-gray-500 uppercase tracking-wider mb-2 hidden md:block px-2">Settings</div>
          
          {[
            { id: 'general', label: 'General', icon: Monitor },
            { id: 'voice', label: 'Voice', icon: Mic },
            { id: 'data', label: 'Data & Storage', icon: Database },
            { id: 'language', label: 'Language', icon: Globe },
            { id: 'about', label: 'About', icon: Info },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as SettingsTab)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm font-medium whitespace-nowrap ${
                activeTab === item.id 
                  ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' 
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-gray-800'
              }`}
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-4 md:p-6 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white capitalize">{activeTab === 'data' ? 'Data & Storage' : activeTab}</h2>
            <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <X size={20} />
            </button>
          </div>

          <div className="p-4 md:p-6 overflow-y-auto flex-1 space-y-8 custom-scrollbar">
            
            {/* --- GENERAL TAB --- */}
            {activeTab === 'general' && (
              <div className="space-y-6">
                {/* Theme */}
                <div className="space-y-3">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Appearance</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { val: 'system', label: 'System', icon: Monitor },
                      { val: 'dark', label: 'Dark', icon: Moon },
                      { val: 'light', label: 'Light', icon: Sun },
                    ].map((opt) => (
                      <button
                        key={opt.val}
                        onClick={() => onUpdateSettings({...settings, theme: opt.val as any})}
                        className={`flex flex-col items-center justify-center gap-2 p-3 rounded-xl border transition-all ${
                          settings.theme === opt.val 
                            ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-500/50 text-blue-600 dark:text-blue-400' 
                            : 'bg-gray-100 dark:bg-[#2d2e33] border-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#3d3e44]'
                        }`}
                      >
                        <opt.icon size={20} />
                        <span className="text-xs font-medium">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="h-px bg-gray-200 dark:bg-gray-800" />

                {/* Input Behavior */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-gray-600 dark:text-gray-300">
                      <Keyboard size={20} />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-200">Enter to Send</div>
                      <div className="text-xs text-gray-500">Press Enter to send message, Shift+Enter for new line</div>
                    </div>
                  </div>
                  <button 
                    onClick={() => onUpdateSettings({...settings, enterToSend: !settings.enterToSend})}
                    className={`w-11 h-6 rounded-full transition-colors relative ${
                      settings.enterToSend ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-700'
                    }`}
                  >
                    <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                      settings.enterToSend ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </button>
                </div>
              </div>
            )}

            {/* --- VOICE TAB --- */}
            {activeTab === 'voice' && (
              <div className="space-y-6">
                 <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">Default Voice</label>
                    <select 
                        value={settings.defaultVoiceURI} 
                        onChange={(e) => onUpdateSettings({...settings, defaultVoiceURI: e.target.value})}
                        className="w-full bg-gray-100 dark:bg-[#2d2e33] border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-gray-200 focus:outline-none focus:border-blue-500"
                    >
                        <option value="">System Default</option>
                        {voices.map((v: any) => (
                            <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
                        ))}
                    </select>
                 </div>

                 <div>
                    <div className="flex justify-between text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        <span>Default Speed</span>
                        <span className="text-blue-600 dark:text-blue-400">{settings.defaultSpeechRate}x</span>
                    </div>
                    <input 
                        type="range" min="0.5" max="2" step="0.1" 
                        value={settings.defaultSpeechRate} 
                        onChange={(e) => onUpdateSettings({...settings, defaultSpeechRate: parseFloat(e.target.value)})}
                        className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                 </div>
              </div>
            )}

            {/* --- DATA TAB --- */}
            {activeTab === 'data' && (
              <div className="space-y-6">
                 <div className="p-4 bg-gray-100 dark:bg-[#2d2e33] rounded-xl border border-gray-200 dark:border-gray-700">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-gray-200 mb-1">Export History</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Save all your conversations to a JSON file.</p>
                    <button 
                      onClick={handleExportData}
                      className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-medium transition-colors"
                    >
                      <Download size={16} /> Export JSON
                    </button>
                 </div>

                 <div className="p-4 bg-red-50 dark:bg-red-500/5 rounded-xl border border-red-100 dark:border-red-500/20">
                    <h3 className="text-sm font-bold text-red-600 dark:text-red-400 mb-1">Danger Zone</h3>
                    <p className="text-xs text-red-500/70 dark:text-red-300/70 mb-4">Permanently delete all chat history from this device. This cannot be undone.</p>
                    <button 
                      onClick={() => {
                        if(window.confirm('Are you sure you want to delete ALL history? This cannot be undone.')) {
                            onClearAllChats();
                            onClose();
                        }
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-red-500/10 hover:bg-red-50 dark:hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/30 rounded-lg text-sm font-medium transition-colors"
                    >
                      <Trash2 size={16} /> Clear All History
                    </button>
                 </div>
              </div>
            )}
            
            {/* --- LANGUAGE TAB --- */}
            {activeTab === 'language' && (
                <div className="flex flex-col items-center justify-center py-8 text-center space-y-4">
                    <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center text-blue-500 dark:text-blue-400">
                        <Globe size={32} />
                    </div>
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-200">Language Support</h3>
                        <p className="text-sm text-gray-500 max-w-xs mx-auto mt-2">
                            Multi-language UI support is currently in development. Elora models already understand and speak multiple languages automatically.
                        </p>
                    </div>
                    <div className="w-full max-w-xs bg-gray-100 dark:bg-[#2d2e33] rounded-xl p-3 border border-gray-200 dark:border-gray-700 flex items-center justify-between mt-4 opacity-60 pointer-events-none">
                        <span className="text-sm text-gray-700 dark:text-gray-300">App Language</span>
                        <span className="text-sm text-gray-500 flex items-center gap-1">English <Check size={14}/></span>
                    </div>
                </div>
            )}

            {/* --- ABOUT TAB --- */}
            {activeTab === 'about' && (
              <div className="text-center space-y-6 py-4">
                 <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-teal-400 rounded-3xl flex items-center justify-center mx-auto shadow-xl shadow-blue-500/20">
                    <span className="text-4xl font-bold text-white">E</span>
                 </div>
                 
                 <div>
                    <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-teal-400 dark:from-blue-400 dark:to-teal-400">Elora</h2>
                    <p className="text-gray-500 text-sm mt-1">Version 1.2.0</p>
                 </div>

                 <p className="text-gray-600 dark:text-gray-400 text-sm max-w-md mx-auto leading-relaxed">
                    A modern, multimodal AI interface designed for creativity and productivity. 
                    Powered by Gemini 2.5 Flash, Pro, and Imagine models.
                 </p>

                 <div className="pt-4 border-t border-gray-200 dark:border-gray-800 w-full">
                    <p className="text-xs text-gray-500 dark:text-gray-600">
                        &copy; {new Date().getFullYear()} Elora AI. All rights reserved.
                    </p>
                 </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
