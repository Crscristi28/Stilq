import React, { useState, useEffect } from 'react';
import { 
  X, Moon, Sun, Monitor, Keyboard, Mic, Database, Globe, Info, 
  Trash2, Download, Check, User, Sparkles, MessageSquare, LogOut, 
  Sliders, Activity, ChevronRight, ArrowLeft 
} from 'lucide-react';
import { AppSettings, ChatSession, UserProfile, PromptSettings, ToneStyle } from '../types';
import { translations, Language, TranslationKey } from '../translations';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (newSettings: AppSettings) => void;
  sessions: ChatSession[];
  onClearAllChats: () => void;
  user: UserProfile | null;
  onSignOut: () => void;
  promptSettings: PromptSettings;
  onUpdatePromptSettings: (newSettings: PromptSettings) => void;
}

type SettingsTab = 'account' | 'personality' | 'preferences' | 'voice' | 'data' | 'about';

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  sessions,
  onClearAllChats,
  user,
  onSignOut,
  promptSettings,
  onUpdatePromptSettings
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('account');
  const [mobileView, setMobileView] = useState<'menu' | 'detail'>('menu');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const loadVoices = () => {
      setVoices(window.speechSynthesis.getVoices());
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  // Reset to menu when modal opens
  useEffect(() => {
    if (isOpen) {
        setMobileView('menu');
    }
  }, [isOpen]);

  const t = (key: TranslationKey) => {
    const lang = (settings.language as Language) || 'en';
    return translations[lang]?.[key] || translations['en'][key];
  };

  const navigateTo = (tab: SettingsTab) => {
    setActiveTab(tab);
    setMobileView('detail');
  };

  const handleBack = () => {
    setMobileView('menu');
  };

  // Helper to get translated tone name
  const getToneLabel = (tone: ToneStyle) => {
      switch (tone) {
          case 'normal': return t('styleNormal');
          case 'concise': return t('styleConcise');
          case 'explanatory': return t('styleExplanatory');
          case 'formal': return t('styleFormal');
          case 'learning': return t('styleLearning');
          default: return tone;
      }
  };

  const getToneDesc = (tone: ToneStyle) => {
      switch (tone) {
          case 'normal': return t('descNormal');
          case 'concise': return t('descConcise');
          case 'explanatory': return t('descExplanatory');
          case 'formal': return t('descFormal');
          case 'learning': return t('descLearning');
          default: return '';
      }
  };

  if (!isOpen) return null;

  // --- Helper Components ---

  const MenuItem = ({ 
    id, 
    icon: Icon, 
    colorClass, 
    label, 
    subLabel 
  }: { 
    id: SettingsTab, 
    icon: any, 
    colorClass: string, 
    label: string, 
    subLabel?: string 
  }) => {
    const isActive = activeTab === id;
    return (
      <button
        onClick={() => navigateTo(id)}
        className={`w-full flex items-center gap-4 p-4 transition-all ${
          isActive 
            ? 'bg-blue-50 dark:bg-blue-500/10' 
            : 'hover:bg-gray-50 dark:hover:bg-[#2d2e33]'
        }`}
      >
        <div className={`p-2 rounded-lg shrink-0 ${colorClass}`}>
          <Icon size={20} className="text-white" />
        </div>
        <div className="flex-1 text-left min-w-0">
          <div className={`text-sm font-semibold truncate ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-white'}`}>
            {label}
          </div>
          {subLabel && (
             <div className="text-xs text-gray-500 truncate mt-0.5 capitalize">{subLabel}</div>
          )}
        </div>
        <ChevronRight size={16} className="text-gray-400 shrink-0" />
      </button>
    );
  };

  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-6 mb-2 mt-6">
      {children}
    </h3>
  );

  const SettingRow = ({ 
    icon: Icon, 
    label, 
    children, 
    danger = false,
    info
  }: { 
    icon?: any, 
    label: string, 
    children: React.ReactNode, 
    danger?: boolean,
    info?: string
  }) => {
    const [showInfo, setShowInfo] = useState(false);

    return (
      <div className="bg-white dark:bg-[#1e1f20] p-4 flex items-center justify-between border-b border-gray-100 dark:border-gray-800 last:border-0 min-h-[60px]">
        <div className="flex items-center gap-3 overflow-hidden flex-1 min-w-0 pr-4">
          {Icon && <Icon size={18} className={`shrink-0 ${danger ? 'text-red-500' : 'text-gray-400'}`} />}
          <span className={`text-sm font-medium truncate ${danger ? 'text-red-600' : 'text-gray-900 dark:text-gray-200'}`}>
            {label}
          </span>
          {info && (
            <div className="relative shrink-0">
              <button 
                onClick={(e) => { e.stopPropagation(); setShowInfo(!showInfo); }}
                className="text-gray-400 hover:text-blue-500 transition-colors p-1"
              >
                <Info size={14} />
              </button>
              {showInfo && (
                <>
                  <div className="fixed inset-0 z-[70]" onClick={(e) => { e.stopPropagation(); setShowInfo(false); }} />
                  <div className="absolute left-1/2 bottom-full mb-2 -translate-x-1/2 w-48 p-3 bg-gray-900 text-white text-xs rounded-xl shadow-xl z-[71] text-center leading-relaxed animate-fade-in cursor-default">
                    {info}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {children}
        </div>
      </div>
    );
  };

  const Toggle = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
    <button 
        onClick={() => onChange(!checked)}
        className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none shrink-0 ${
            checked ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
        }`}
    >
        <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-sm ${
            checked ? 'translate-x-5' : 'translate-x-0'
        }`} />
    </button>
  );

  // --- Logic ---
  
  const handleExport = () => {
    const dataStr = JSON.stringify(sessions, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', `elora-backup-${new Date().toISOString().slice(0,10)}.json`);
    linkElement.click();
  };

  return (
    <div className="fixed inset-0 z-[60] flex justify-center items-center sm:p-4 p-0">
      <div 
        className="absolute inset-0 bg-black/40 dark:bg-black/70 backdrop-blur-sm animate-fade-in" 
        onClick={onClose}
      />

      <div className="relative bg-white dark:bg-[#1e1f20] w-full max-w-5xl h-[100dvh] sm:h-[85vh] sm:rounded-2xl shadow-2xl flex overflow-hidden animate-slide-up">
        
        {/* --- LEFT PANEL (MENU) --- */}
        <div className={`
            flex-col w-full md:w-[320px] bg-gray-50/50 dark:bg-[#161719] border-r border-gray-200 dark:border-gray-800
            ${mobileView === 'menu' ? 'flex' : 'hidden md:flex'}
        `}>
             {/* Mobile Header (Menu View) */}
             <div className="p-4 flex items-center justify-between md:hidden border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1e1f20]">
                <span className="text-lg font-bold text-gray-900 dark:text-white">Settings</span>
                <button onClick={onClose} className="p-2 bg-gray-100 dark:bg-gray-800 rounded-full text-gray-500">
                    <X size={20} />
                </button>
             </div>

             {/* Profile Card (Fixed Top of Sidebar) */}
             {user && (
                 <div className="p-6 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1e1f20]">
                    <div className="flex items-center gap-4 overflow-hidden">
                        <img 
                            src={user.photoURL || ''} 
                            alt="Profile"
                            className="w-14 h-14 rounded-full object-cover shadow-sm bg-gray-200 shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).src = 'https://ui-avatars.com/api/?name='+user.displayName }}
                        />
                        <div className="min-w-0 flex-1">
                            <h3 className="font-bold text-gray-900 dark:text-white truncate">{user.displayName}</h3>
                            <p className="text-xs text-gray-500 truncate">{user.email}</p>
                            <div className="mt-1 inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                                {t('proPlan')}
                            </div>
                        </div>
                    </div>
                 </div>
             )}

             {/* Menu List */}
             <div className="flex-1 overflow-y-auto py-2">
                 <SectionTitle>{t('headerPersonalization')}</SectionTitle>
                 <MenuItem id="account" icon={User} colorClass="bg-blue-500" label={t('tabAccount')} subLabel={settings.userName || user?.displayName?.split(' ')[0]} />
                 <MenuItem id="personality" icon={Sparkles} colorClass="bg-purple-500" label={t('tabPersonality')} subLabel={getToneLabel(promptSettings.style)} />
                 
                 <SectionTitle>{t('tabPreferences')}</SectionTitle>
                 <MenuItem id="preferences" icon={Sliders} colorClass="bg-gray-500" label={t('tabPreferences')} />
                 <MenuItem id="voice" icon={Mic} colorClass="bg-green-500" label={t('tabVoice')} />
                 
                 <SectionTitle>{t('tabData')}</SectionTitle>
                 <MenuItem id="data" icon={Database} colorClass="bg-orange-500" label={t('tabData')} />
                 <MenuItem id="about" icon={Info} colorClass="bg-slate-500" label={t('tabAbout')} />
             </div>
        </div>

        {/* --- RIGHT PANEL (CONTENT) --- */}
        <div className={`
            flex-1 flex-col bg-gray-100 dark:bg-[#101112]
            ${mobileView === 'detail' ? 'flex' : 'hidden md:flex'}
        `}>
            {/* Header */}
            <div className="h-16 px-4 md:px-6 bg-white dark:bg-[#1e1f20] border-b border-gray-200 dark:border-gray-800 flex items-center gap-3 shrink-0">
                <button onClick={handleBack} className="md:hidden p-2 -ml-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full text-gray-500 dark:text-white">
                    <ArrowLeft size={20} />
                </button>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white capitalize truncate">
                    {activeTab === 'personality' ? t('headerPersonality') : 
                     activeTab === 'account' ? t('tabAccount') :
                     activeTab === 'preferences' ? t('tabPreferences') :
                     activeTab === 'voice' ? t('tabVoice') :
                     activeTab === 'data' ? t('tabData') : t('tabAbout')}
                </h2>
                <div className="ml-auto hidden md:block">
                    <button onClick={onClose} className="p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-8">
                <div className="max-w-2xl mx-auto space-y-6">

                    {/* ACCOUNT TAB */}
                    {activeTab === 'account' && (
                        <div className="space-y-6">
                            <div className="bg-white dark:bg-[#1e1f20] p-5 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
                                <label className="block text-sm font-bold text-gray-900 dark:text-white mb-3">
                                    {t('labelNameInput')}
                                </label>
                                
                                <input 
                                    type="text"
                                    value={settings.userName ?? ''}
                                    onChange={(e) => onUpdateSettings({ ...settings, userName: e.target.value })}
                                    placeholder={user?.displayName || "Enter name"}
                                    className="w-full bg-gray-50 dark:bg-[#161719] border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-blue-500 transition-colors"
                                />
                                
                                <p className="text-xs text-gray-500 mt-3">
                                    {t('descNameInput')}
                                </p>
                            </div>
                            
                            <button 
                                onClick={onSignOut}
                                className="w-full flex items-center justify-center gap-2 py-4 bg-white dark:bg-[#1e1f20] text-red-600 font-medium rounded-2xl border border-gray-200 dark:border-gray-800 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors shadow-sm"
                            >
                                <LogOut size={18} />
                                {t('signOut')}
                            </button>
                        </div>
                    )}

                    {/* PERSONALITY TAB */}
                    {activeTab === 'personality' && (
                        <div className="space-y-6">
                            {/* Tone Grid */}
                            <div className="bg-white dark:bg-[#1e1f20] p-4 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
                                <label className="text-xs font-bold text-gray-500 uppercase mb-3 block">{t('labelTone')}</label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {['normal', 'concise', 'explanatory', 'formal', 'learning'].map((tone: any) => (
                                        <button
                                            key={tone}
                                            onClick={() => onUpdatePromptSettings({ ...promptSettings, style: tone })}
                                            className={`px-4 py-3 rounded-xl text-sm font-medium border text-left transition-all flex flex-col gap-1 ${
                                                promptSettings.style === tone
                                                    ? 'bg-purple-50 dark:bg-purple-500/10 border-purple-500 text-purple-700 dark:text-purple-300'
                                                    : 'border-transparent bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                                            }`}
                                        >
                                            <div className="font-bold">{getToneLabel(tone)}</div>
                                            <div className="text-xs opacity-70 font-normal leading-relaxed">{getToneDesc(tone)}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Creativity */}
                            <div className="bg-white dark:bg-[#1e1f20] p-4 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
                                <div className="flex justify-between mb-4">
                                    <label className="text-sm font-bold text-gray-900 dark:text-white">{t('labelCreativity')}</label>
                                    <span className="text-xs font-mono bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                                        {promptSettings.temperature}
                                    </span>
                                </div>
                                <input
                                    type="range" min="0" max="1" step="0.1"
                                    value={promptSettings.temperature}
                                    onChange={(e) => onUpdatePromptSettings({ ...promptSettings, temperature: parseFloat(e.target.value) })}
                                    className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-blue-500"
                                />
                                <div className="flex justify-between text-[10px] text-gray-400 mt-2 font-bold uppercase">
                                    <span>Precise</span>
                                    <span>Creative</span>
                                </div>
                            </div>

                            {/* System Instructions */}
                            <div className="bg-white dark:bg-[#1e1f20] p-4 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
                                <label className="text-xs font-bold text-gray-500 uppercase mb-2 block">{t('labelInstructions')}</label>
                                <textarea
                                    value={promptSettings.systemInstruction || ''}
                                    onChange={(e) => onUpdatePromptSettings({ ...promptSettings, systemInstruction: e.target.value })}
                                    className="w-full h-40 bg-gray-50 dark:bg-[#161719] rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none text-gray-900 dark:text-white"
                                    placeholder={t('placeholderInstructions')}
                                />
                            </div>
                        </div>
                    )}

                    {/* PREFERENCES TAB */}
                    {activeTab === 'preferences' && (
                        <div className="bg-white dark:bg-[#1e1f20] rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
                            <SettingRow label={t('appearance')} icon={Moon}>
                                <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
                                    {[
                                      { val: 'system', icon: Monitor },
                                      { val: 'dark', icon: Moon },
                                      { val: 'light', icon: Sun },
                                    ].map((opt: any) => (
                                      <button
                                        key={opt.val}
                                        onClick={() => onUpdateSettings({...settings, theme: opt.val})}
                                        className={`p-1.5 rounded-md transition-all ${
                                          settings.theme === opt.val 
                                            ? 'bg-white dark:bg-gray-600 shadow-sm text-blue-600 dark:text-white' 
                                            : 'text-gray-400'
                                        }`}
                                      >
                                        <opt.icon size={16} />
                                      </button>
                                    ))}
                                </div>
                            </SettingRow>

                            <SettingRow label={t('language')} icon={Globe}>
                                <div className="relative">
                                    <select 
                                        value={settings.language}
                                        onChange={(e) => onUpdateSettings({...settings, language: e.target.value as Language})}
                                        className="bg-transparent text-sm font-medium text-blue-600 dark:text-blue-400 outline-none text-right appearance-none pr-6 cursor-pointer"
                                    >
                                        <option value="en">English</option>
                                        <option value="cs">Čeština</option>
                                        <option value="ro">Română</option>
                                        <option value="de">Deutsch</option>
                                        <option value="it">Italiano</option>
                                        <option value="ru">Русский</option>
                                    </select>
                                    <ChevronRight size={14} className="absolute right-0 top-1/2 -translate-y-1/2 text-blue-600 dark:text-blue-400 pointer-events-none" />
                                </div>
                            </SettingRow>

                            <SettingRow label={t('showSuggestions')} icon={MessageSquare} info={t('descSuggestions')}>
                                <Toggle checked={settings.showSuggestions} onChange={(v) => onUpdateSettings({...settings, showSuggestions: v})} />
                            </SettingRow>

                            <SettingRow label={t('enterToSend')} icon={Keyboard}>
                                <Toggle checked={settings.enterToSend} onChange={(v) => onUpdateSettings({...settings, enterToSend: v})} />
                            </SettingRow>
                        </div>
                    )}

                    {/* VOICE TAB */}
                    {activeTab === 'voice' && (
                        <div className="space-y-6">
                            <div className="bg-white dark:bg-[#1e1f20] p-4 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
                                <label className="text-sm font-bold mb-2 block text-gray-900 dark:text-white">{t('labelDefaultVoice')}</label>
                                <div className="relative">
                                    <select 
                                        value={settings.defaultVoiceURI} 
                                        onChange={(e) => onUpdateSettings({...settings, defaultVoiceURI: e.target.value})}
                                        className="w-full bg-gray-50 dark:bg-[#161719] border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm appearance-none outline-none focus:border-blue-500 text-gray-900 dark:text-white"
                                    >
                                        <option value="">{t('optSystemDefault')}</option>
                                        {voices.map((v: any) => (
                                            <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
                                        ))}
                                    </select>
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                                        <Activity size={16} />
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white dark:bg-[#1e1f20] p-4 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
                                <label className="text-sm font-bold mb-4 block flex justify-between text-gray-900 dark:text-white">
                                    {t('labelSpeakingRate')}
                                    <span className="text-blue-500">{settings.defaultSpeechRate}x</span>
                                </label>
                                <input 
                                    type="range" min="0.5" max="2" step="0.1" 
                                    value={settings.defaultSpeechRate} 
                                    onChange={(e) => onUpdateSettings({...settings, defaultSpeechRate: parseFloat(e.target.value)})}
                                    className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-blue-500"
                                />
                            </div>
                        </div>
                    )}

                    {/* DATA TAB */}
                    {activeTab === 'data' && (
                        <div className="space-y-4">
                            <button 
                                onClick={handleExport}
                                className="w-full flex items-center justify-between p-4 bg-white dark:bg-[#1e1f20] rounded-2xl border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors shadow-sm group"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg">
                                        <Download size={18} />
                                    </div>
                                    <div className="text-left">
                                        <div className="text-sm font-bold text-gray-900 dark:text-white">{t('btnDownload')}</div>
                                        <div className="text-xs text-gray-500">{t('descExport')}</div>
                                    </div>
                                </div>
                                <ChevronRight size={18} className="text-gray-400 group-hover:translate-x-1 transition-transform" />
                            </button>

                            <button 
                                onClick={() => {
                                    if(window.confirm(t('descClearAll'))) {
                                        onClearAllChats();
                                        onClose();
                                    }
                                }}
                                className="w-full flex items-center justify-between p-4 bg-white dark:bg-[#1e1f20] rounded-2xl border border-red-100 dark:border-red-500/30 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors shadow-sm group"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 rounded-lg">
                                        <Trash2 size={18} />
                                    </div>
                                    <div className="text-left">
                                        <div className="text-sm font-bold text-red-600 dark:text-red-400">{t('clearAll')}</div>
                                        <div className="text-xs text-red-500/70">{t('descDanger')}</div>
                                    </div>
                                </div>
                                <ChevronRight size={18} className="text-red-400 group-hover:translate-x-1 transition-transform" />
                            </button>
                        </div>
                    )}
                    
                    {/* ABOUT TAB */}
                    {activeTab === 'about' && (
                      <div className="text-center space-y-6 py-6">
                         <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-teal-400 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-blue-500/20 rotate-3">
                            <span className="text-4xl font-bold text-white">E</span>
                         </div>
                         
                         <div>
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Elora</h2>
                            <p className="text-blue-500 text-xs font-bold tracking-widest uppercase mt-1">Version 1.2.0 • Beta</p>
                         </div>

                         <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed max-w-sm mx-auto">
                            {t('descAbout')}
                         </p>
                      </div>
                    )}

                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
