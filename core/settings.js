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
  audio: {
    originalVolume: 0.75,
    interpretationVolume: 0.35,
    playInterpretation: true,
    muteOriginalWhenSpeaking: false
  },
  privacy: {
    saveTranscript: true,
    transcriptFolder: 'Gemive/Transcripts'
  },
  advanced: {
    audioChunkMs: 100,
    jitterBufferMs: 300,
    subtitleThrottleMs: 150
  }
};

const LOCALES = new Set(['zh-Hant', 'zh-Hans', 'en']);
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function clone(value) {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function numberInRange(value, fallback, min, max) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(max, Math.max(min, next));
}

function integerInRange(value, fallback, min, max) {
  return Math.round(numberInRange(value, fallback, min, max));
}

function booleanOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function stringOr(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

function localeOr(value, fallback = 'en') {
  return LOCALES.has(value) ? value : fallback;
}

function colorOr(value, fallback) {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value) ? value : fallback;
}

function nullablePosition(value) {
  if (value == null) return null;
  const next = Number(value);
  return Number.isFinite(next) ? Math.round(next) : null;
}

export function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return clone(base);
  const result = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(base?.[key])) {
      result[key] = deepMerge(base[key], value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function normalizeTranscriptFolder(value) {
  const folder = stringOr(value, DEFAULT_SETTINGS.privacy.transcriptFolder).trim();
  return folder.replace(/^\/+/, '').replace(/\/+/g, '/') || DEFAULT_SETTINGS.privacy.transcriptFolder;
}

export function normalizeSettings(input) {
  const merged = deepMerge(DEFAULT_SETTINGS, input ?? {});

  return {
    api: {
      provider: merged.api?.provider === 'gemini' ? 'gemini' : DEFAULT_SETTINGS.api.provider,
      apiKey: stringOr(merged.api?.apiKey, DEFAULT_SETTINGS.api.apiKey),
      model: stringOr(merged.api?.model, DEFAULT_SETTINGS.api.model).trim() || DEFAULT_SETTINGS.api.model
    },
    ui: {
      locale: localeOr(merged.ui?.locale, DEFAULT_SETTINGS.ui.locale)
    },
    language: {
      sourceLanguage: stringOr(merged.language?.sourceLanguage, DEFAULT_SETTINGS.language.sourceLanguage).trim() || DEFAULT_SETTINGS.language.sourceLanguage,
      targetLanguageCode: stringOr(merged.language?.targetLanguageCode, DEFAULT_SETTINGS.language.targetLanguageCode).trim() || DEFAULT_SETTINGS.language.targetLanguageCode,
      echoTargetLanguage: booleanOr(merged.language?.echoTargetLanguage, DEFAULT_SETTINGS.language.echoTargetLanguage)
    },
    subtitles: {
      showTranslation: booleanOr(merged.subtitles?.showTranslation, DEFAULT_SETTINGS.subtitles.showTranslation),
      showSource: booleanOr(merged.subtitles?.showSource, DEFAULT_SETTINGS.subtitles.showSource),
      translationFontSize: integerInRange(merged.subtitles?.translationFontSize, DEFAULT_SETTINGS.subtitles.translationFontSize, 10, 96),
      sourceFontSize: integerInRange(merged.subtitles?.sourceFontSize, DEFAULT_SETTINGS.subtitles.sourceFontSize, 8, 72),
      translationColor: colorOr(merged.subtitles?.translationColor, DEFAULT_SETTINGS.subtitles.translationColor),
      sourceColor: colorOr(merged.subtitles?.sourceColor, DEFAULT_SETTINGS.subtitles.sourceColor),
      translationMaxLines: integerInRange(merged.subtitles?.translationMaxLines, DEFAULT_SETTINGS.subtitles.translationMaxLines, 1, 12),
      sourceMaxLines: integerInRange(merged.subtitles?.sourceMaxLines, DEFAULT_SETTINGS.subtitles.sourceMaxLines, 1, 12)
    },
    window: {
      x: nullablePosition(merged.window?.x),
      y: nullablePosition(merged.window?.y),
      width: integerInRange(merged.window?.width, DEFAULT_SETTINGS.window.width, 120, 1200),
      height: integerInRange(merged.window?.height, DEFAULT_SETTINGS.window.height, 64, 900),
      backgroundColor: colorOr(merged.window?.backgroundColor, DEFAULT_SETTINGS.window.backgroundColor),
      opacity: numberInRange(merged.window?.opacity, DEFAULT_SETTINGS.window.opacity, 0, 1),
      blur: integerInRange(merged.window?.blur, DEFAULT_SETTINGS.window.blur, 0, 80),
      borderRadius: integerInRange(merged.window?.borderRadius, DEFAULT_SETTINGS.window.borderRadius, 0, 48),
      lockPosition: booleanOr(merged.window?.lockPosition, DEFAULT_SETTINGS.window.lockPosition),
      autoCollapse: booleanOr(merged.window?.autoCollapse, DEFAULT_SETTINGS.window.autoCollapse)
    },
    audio: {
      originalVolume: numberInRange(merged.audio?.originalVolume, DEFAULT_SETTINGS.audio.originalVolume, 0, 1),
      interpretationVolume: numberInRange(merged.audio?.interpretationVolume, DEFAULT_SETTINGS.audio.interpretationVolume, 0, 1),
      playInterpretation: booleanOr(merged.audio?.playInterpretation, DEFAULT_SETTINGS.audio.playInterpretation),
      muteOriginalWhenSpeaking: booleanOr(merged.audio?.muteOriginalWhenSpeaking, DEFAULT_SETTINGS.audio.muteOriginalWhenSpeaking)
    },
    privacy: {
      saveTranscript: booleanOr(merged.privacy?.saveTranscript, DEFAULT_SETTINGS.privacy.saveTranscript),
      transcriptFolder: normalizeTranscriptFolder(merged.privacy?.transcriptFolder)
    },
    advanced: {
      audioChunkMs: integerInRange(merged.advanced?.audioChunkMs, DEFAULT_SETTINGS.advanced.audioChunkMs, 20, 1000),
      jitterBufferMs: integerInRange(merged.advanced?.jitterBufferMs, DEFAULT_SETTINGS.advanced.jitterBufferMs, 0, 3000),
      subtitleThrottleMs: integerInRange(merged.advanced?.subtitleThrottleMs, DEFAULT_SETTINGS.advanced.subtitleThrottleMs, 0, 1000)
    }
  };
}
