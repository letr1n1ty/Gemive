import { deepMerge, normalizeSettings } from '../core/settings.js';

const SETTINGS_KEY = 'gemive.settings';

function getChromeUiLanguage() {
  try {
    if (globalThis.chrome?.i18n?.getUILanguage) return chrome.i18n.getUILanguage();
  } catch {}
  try {
    if (globalThis.navigator?.language) return navigator.language;
  } catch {}
  return 'en';
}

function normalizeChromeLocale(locale = getChromeUiLanguage()) {
  return String(locale || '').trim().toLowerCase().replace('_', '-');
}

export function detectDefaultUiLocale(locale = getChromeUiLanguage()) {
  const value = normalizeChromeLocale(locale);
  if (!value) return 'en';
  if (value.includes('hant') || value === 'zh-tw' || value === 'zh-hk' || value === 'zh-mo') return 'zh-Hant';
  if (value.includes('hans') || value === 'zh-cn' || value === 'zh-sg') return 'zh-Hans';
  if (value === 'zh') return 'zh-Hant';
  return 'en';
}

export function detectDefaultTargetLanguageCode(locale = getChromeUiLanguage()) {
  return detectDefaultUiLocale(locale);
}

function withDetectedInitialSettings(storedSettings) {
  const hasStoredUiLocale = Boolean(storedSettings?.ui?.locale);
  const hasStoredTarget = Boolean(storedSettings?.language?.targetLanguageCode);
  const normalized = normalizeSettings(storedSettings);

  if (!hasStoredUiLocale) {
    normalized.ui.locale = detectDefaultUiLocale();
  }

  if (!hasStoredTarget) {
    normalized.language.targetLanguageCode = detectDefaultTargetLanguageCode();
  }

  return normalized;
}

export async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return withDetectedInitialSettings(stored[SETTINGS_KEY]);
}

export async function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
  return normalized;
}

export async function updateSettings(patch) {
  const current = await getSettings();
  const next = deepMerge(current, patch);
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function resetSettings() {
  const next = withDetectedInitialSettings(null);
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
