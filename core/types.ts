// Core type definitions for Gemive (TypeScript foundation layer)

export type Locale = 'zh-Hant' | 'zh-Hans' | 'en';

export type SessionStatus =
  | 'idle'
  | 'starting'
  | 'capturing'
  | 'connecting'
  | 'translating'
  | 'stopping'
  | 'error';

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export interface ApiConfig {
  provider: 'gemini';
  apiKey: string;
  model: string;
}

export interface LanguageConfig {
  sourceLanguage: string;
  targetLanguageCode: string;
  echoTargetLanguage: boolean;
}

export interface AudioConfig {
  originalVolume: number;
  interpretationVolume: number;
  playInterpretation: boolean;
  muteOriginalWhenSpeaking?: boolean;
}

export interface PrivacyConfig {
  saveTranscript: boolean;
  transcriptFolder?: string;
}

export interface AdvancedConfig {
  audioChunkMs: number;
  jitterBufferMs: number;
  subtitleThrottleMs: number;
}

export interface WindowConfig {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
  backgroundColor: string;
  opacity: number;
  blur: number;
  borderRadius: number;
  lockPosition: boolean;
  autoCollapse: boolean;
}

export interface SubtitleTextState {
  text: string;
  languageCode?: string;
}

export interface SubtitleState {
  source?: SubtitleTextState;
  translation?: SubtitleTextState;
}

export interface RuntimeSession {
  status: SessionStatus;
  tabId: number | null;
  tabUrl?: string;
  startedAt?: number | null;
  lastError?: unknown;
}

export interface GemiveSettings {
  api: ApiConfig;
  ui: { locale: Locale };
  language: LanguageConfig;
  audio: AudioConfig;
  subtitles: Record<string, unknown>;
  window: WindowConfig;
  privacy: PrivacyConfig;
  advanced: AdvancedConfig;
}

export type MessageType =
  | 'GET_SETTINGS'
  | 'UPDATE_SETTINGS'
  | 'GET_STATUS'
  | 'START_SESSION'
  | 'STOP_SESSION'
  | 'START_OFFSCREEN_SESSION'
  | 'STOP_OFFSCREEN_SESSION'
  | 'SESSION_STATUS'
  | 'SESSION_ERROR'
  | 'SUBTITLE_UPDATE'
  | 'AUDIO_LEVEL_UPDATE'
  | 'OVERLAY_SHOW'
  | 'OVERLAY_HIDE'
  | 'SETTINGS_UPDATED'
  | 'DEBUG_LOG';