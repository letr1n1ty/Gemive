import type { GemiveError, GemiveSettings, RuntimeSession, SubtitleState, TranscriptSession } from '../core/types';

export type BackgroundSessionStatus = RuntimeSession['status'];

export interface BackgroundDebugEntry {
  area?: string;
  event?: string;
  data?: unknown;
  tabId?: number | null;
}

export interface BackgroundDebugLogRecord {
  at: number;
  iso: string;
  area: string;
  event: string;
  data: unknown;
  tabId: number | null;
  sessionStatus: BackgroundSessionStatus;
}

export interface NavigationRestartRequest {
  tabId: number;
  url: string;
  reason: string;
  at: number;
}

export interface StartSessionRequest {
  tabId?: number;
  source?: 'popup' | 'overlay' | 'switch-tab';
}

export interface StopSessionOptions {
  keepOverlay?: boolean;
  reason?: string;
}

export interface OffscreenResponse<T = unknown> {
  ok: boolean;
  error?: string;
  payload?: T;
}

export interface TranscriptRecordingSession extends TranscriptSession {}

export interface SubtitleUpdateMessage {
  type: 'SUBTITLE_UPDATE';
  payload: SubtitleState;
}

export interface SettingsUpdateBroadcast {
  type: 'SETTINGS_UPDATED';
  payload: GemiveSettings;
}

export interface SessionErrorPayload extends GemiveError {}
