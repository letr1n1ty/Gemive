import type { DeepPartial, GemiveSettings, RuntimeSession } from './types';

export interface UiSettingsResponse {
  ok: boolean;
  settings?: GemiveSettings;
  error?: string;
}

export interface UiSessionResponse {
  ok: boolean;
  session?: RuntimeSession;
  error?: string;
}

export interface UiUpdateSettingsMessage {
  type: 'UPDATE_SETTINGS';
  patch: DeepPartial<GemiveSettings>;
}

export interface UiElementMap {
  [id: string]: HTMLElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement | null;
}

export interface ApiValidationResult {
  ok: boolean;
  message?: string;
}

export interface RangePatchQueue {
  pendingPatch: DeepPartial<GemiveSettings> | null;
  inFlight: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}
