import type { GemiveError, GemiveSettings, SubtitleState } from '../core/types';

export interface AudioRouterStartPayload {
  streamId: string;
  tabId: number;
  settings: GemiveSettings;
}

export interface AudioRouterStopOptions {
  requestedByUser?: boolean;
  silent?: boolean;
}

export interface AudioFrameWorkletMessage {
  type: 'AUDIO_FRAME';
  samples: Float32Array;
}

export interface RmsWorkletMessage {
  type: 'RMS';
  rms: number;
}

export type AudioWorkletMessage = AudioFrameWorkletMessage | RmsWorkletMessage;

export interface Pcm16ChunkerOptions {
  inputSampleRate: number;
  outputSampleRate?: number;
  chunkMs?: number;
}

export interface Pcm16Chunk {
  pcm: Int16Array;
  base64: string;
  durationMs: number;
}

export interface Pcm16PlayerOptions {
  sampleRate?: number;
  jitterBufferMs?: number;
  volume?: number;
}

export interface GeminiLiveClientOptions {
  apiKey: string;
  model: string;
  targetLanguageCode: string;
  echoTargetLanguage: boolean;
  onServerContent?: (serverContent: unknown) => void;
  onAudio?: (base64: string) => void;
  onOpen?: () => void;
  onReady?: () => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (error: Error | GemiveError) => void;
  onDebug?: (event: string, data?: unknown) => void;
}

export interface GeminiRealtimeAudioInput {
  realtimeInput: {
    audio: {
      data: string;
      mimeType: 'audio/pcm;rate=16000';
    };
  };
}

export interface GeminiSetupMessage {
  setup: {
    model: string;
    inputAudioTranscription: Record<string, never>;
    outputAudioTranscription: Record<string, never>;
    generationConfig: {
      responseModalities: ['AUDIO'];
      translationConfig: {
        targetLanguageCode: string;
        echoTargetLanguage: boolean;
      };
    };
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: boolean;
      };
    };
  };
}

export interface TranscriptBufferLike {
  updateFromServerContent(serverContent: unknown): SubtitleState | null;
}
