export const DEFAULT_SETTINGS = {
  api: {
    provider: 'gemini',
    apiKey: '',
    model: 'gemini-3.5-live-translate-preview'
  },
  ui: {
    locale: 'en'
  },
  language: {
    sourceLanguage: 'auto',
    targetLanguageCode: 'en',
    echoTargetLanguage: false
  },
  subtitles: {
    showTranslation: true,
    showSource: true,
    translationFontSize: 24,
    sourceFontSize: 15,
    translationColor: '#ffffff',
    sourceColor: '#d1d5db',
    translationMaxLines: 6,
    sourceMaxLines: 4
  },
  window: {
    x: null,
    y: null,
    width: 160,
    height: 90,
    backgroundColor: '#000000',
    opacity: 0.72,
    blur: 22,
    borderRadius: 24,
    lockPosition: false,
    autoCollapse: false
  },
  automation: {
    autoShowOverlay: false,
    autoShowDomains: 'youtube.com\nmeet.google.com'
  },
  audio: {
    originalVolume: 0.75,
    interpretationVolume: 0.35,
    playInterpretation: true,
    muteOriginalWhenSpeaking: false
  },
  privacy: {
    saveTranscript: true,
    autoExportTranscript: true,
    transcriptFolder: 'Gemive/Transcripts'
  },
  debug: {
    saveLogs: false
  },
  advanced: {
    audioChunkMs: 100,
    jitterBufferMs: 300,
    subtitleThrottleMs: 150
  }
};

export function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object') return structuredClone(base);
  const result = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = deepMerge(base?.[key] ?? {}, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function normalizeSettings(input) {
  return deepMerge(DEFAULT_SETTINGS, input ?? {});
}
