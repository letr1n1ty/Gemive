import type { DeepPartial, GemiveSettings, RuntimeSession, SubtitleState } from './types';

export const MESSAGE_TYPES = [
  'GET_SETTINGS',
  'UPDATE_SETTINGS',
  'GET_STATUS',
  'START_SESSION',
  'STOP_SESSION',
  'START_OFFSCREEN_SESSION',
  'STOP_OFFSCREEN_SESSION',
  'SESSION_STATUS',
  'SESSION_ERROR',
  'SUBTITLE_UPDATE',
  'AUDIO_LEVEL_UPDATE',
  'OVERLAY_SHOW',
  'OVERLAY_HIDE',
  'OVERLAY_RESET_POSITION',
  'SETTINGS_UPDATED',
  'DEBUG_LOG',
  'GET_DEBUG_LOGS',
  'CLEAR_DEBUG_LOGS'
] as const;

export type RuntimeMessageType = typeof MESSAGE_TYPES[number];

export interface StartSessionPayload {
  tabId?: number;
  source?: 'popup' | 'overlay' | 'switch-tab';
}

export interface StopSessionPayload {
  keepOverlay?: boolean;
  reason?: string;
}

export interface StartOffscreenSessionPayload {
  streamId: string;
  tabId: number;
  settings: GemiveSettings;
}

export type RuntimeMessage =
  | { type: 'GET_SETTINGS' }
  | { type: 'UPDATE_SETTINGS'; patch: DeepPartial<GemiveSettings> }
  | { type: 'GET_STATUS' }
  | { type: 'START_SESSION'; payload?: StartSessionPayload }
  | { type: 'STOP_SESSION'; payload?: StopSessionPayload }
  | { type: 'START_OFFSCREEN_SESSION'; target: 'offscreen'; payload: StartOffscreenSessionPayload }
  | { type: 'STOP_OFFSCREEN_SESSION'; target: 'offscreen' }
  | { type: 'SESSION_STATUS'; payload: Partial<RuntimeSession> & { source?: string } }
  | { type: 'SESSION_ERROR'; error?: unknown; payload?: unknown; area?: string }
  | { type: 'SUBTITLE_UPDATE'; payload: SubtitleState }
  | { type: 'AUDIO_LEVEL_UPDATE'; rms: number }
  | { type: 'OVERLAY_SHOW'; payload?: { settings?: GemiveSettings; collapse?: boolean } }
  | { type: 'OVERLAY_HIDE' }
  | { type: 'OVERLAY_RESET_POSITION' }
  | { type: 'SETTINGS_UPDATED'; payload: GemiveSettings }
  | { type: 'DEBUG_LOG'; payload?: Record<string, unknown> }
  | { type: 'GET_DEBUG_LOGS' }
  | { type: 'CLEAR_DEBUG_LOGS' };

export function isRuntimeMessageType(value: unknown): value is RuntimeMessageType {
  return typeof value === 'string' && MESSAGE_TYPES.includes(value as RuntimeMessageType);
}
