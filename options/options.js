import { DEFAULT_SETTINGS } from '../core/settings.js';
import { MESSAGE } from '../core/message-types.js';
import { clearTranscripts, getTranscripts } from '../storage/transcript-store.js';
import { UI_LOCALES, formatUiLocaleLabel, localizeDocument, resolveLocale, t } from '../core/i18n.js';
import { parseApiKeys } from '../core/api-keys.js';
import { renderLanguageSelect } from '../core/language-select.js';
import {
  buildTranscriptArchiveFilename,
  downloadMarkdownFile,
  formatTranscriptArchiveMarkdown,
  sanitizeDownloadFolder
} from '../core/transcript-export.js';

const ids = [
  'uiLocale', 'apiKey', 'toggleApiVisibility', 'saveApiKey', 'apiKeyCheck', 'apiHint', 'targetLanguage', 'echoTargetLanguage',
  'originalVolume', 'originalVolumeValue', 'interpretationVolume', 'interpretationVolumeValue',
  'playInterpretation', 'showSource', 'autoCollapseOverlay', 'autoShowOverlay', 'autoShowDomains', 'autoShowDomainInput', 'addAutoShowDomain', 'autoShowDomainChips', 'translationFontSize', 'sourceFontSize', 'translationMaxLines', 'sourceMaxLines',
  'translationColor', 'sourceColor', 'windowWidth', 'windowHeight', 'backgroundColor', 'opacity', 'opacityValue',
  'blur', 'blurValue', 'borderRadius', 'saveTranscript', 'transcriptFolder', 'exportTranscript', 'clearTranscript', 'resetExperience',
  'debugLogging', 'refreshDebugLogs', 'copyDebugLogs', 'clearDebugLogs', 'debugLogs', 'saveState'
];
const els = Object.fromEntries(ids.map((id) => [id, document.querySelector(`#${id}`)]));
let settings = null;
let locale = 'zh-Hant';
let saveTimer = null;

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function setState(key, vars = {}) {
  els.saveState.textContent = t(locale, key, vars);
}

function renderUiLocales() {
  els.uiLocale.innerHTML = '';
  for (const item of UI_LOCALES) {
    els.uiLocale.appendChild(new Option(formatUiLocaleLabel(item.code), item.code));
  }
}

function applyLocale() {
  locale = resolveLocale(settings);
  localizeDocument(locale);
  document.title = t(locale, 'appTitle');
  renderLanguages();
}

function formatDebugLogs(logs) {
  return (logs || []).map((entry) => {
    const data = entry.data === undefined ? '' : ` ${JSON.stringify(entry.data)}`;
    return `[${entry.iso || new Date(entry.at).toISOString()}] [${entry.area}] ${entry.event}${data}`;
  }).join('\n');
}

async function refreshDebugLogs() {
  const response = await sendMessage({ type: MESSAGE.GET_DEBUG_LOGS });
  els.debugLogs.value = response?.ok ? formatDebugLogs(response.logs) : t(locale, 'failedToLoadLogs', { message: response?.error || 'unknown error' });
}

function setApiValidationState(state, message = '') {
  els.apiKeyCheck.classList.remove('neutral', 'valid', 'invalid', 'checking');
  els.apiKeyCheck.classList.add(state);
  els.apiKeyCheck.title = message || state;
  els.apiKeyCheck.setAttribute('aria-label', message || state);
  if (message) els.apiHint.textContent = message;
}

function describeApiKeyCount(count) {
  if (count <= 1) return '';
  return t(locale, 'apiMultipleCount', { count });
}

async function validateOneApiKey(apiKey) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, {
    method: 'GET',
    cache: 'no-store'
  });
  if (response.ok) return { ok: true };
  let detail = '';
  try {
    const body = await response.json();
    detail = body?.error?.message || '';
  } catch {}
  return { ok: false, message: detail || `HTTP ${response.status}` };
}

async function validateApiKey(apiKeyText) {
  const keys = parseApiKeys(apiKeyText);
  if (!keys.length) return { ok: false, message: t(locale, 'apiEmpty') };

  const failures = [];
  for (let index = 0; index < keys.length; index += 1) {
    try {
      const result = await validateOneApiKey(keys[index]);
      if (!result.ok) failures.push({ index, message: result.message });
    } catch (error) {
      failures.push({ index, message: error?.message || String(error) });
    }
  }

  if (!failures.length) {
    const suffix = describeApiKeyCount(keys.length);
    return { ok: true, message: suffix || t(locale, 'apiVerified') };
  }

  const first = failures[0];
  return {
    ok: false,
    message: `${t(locale, 'apiValidationFailed')}：${t(locale, 'apiKeyIndex', { index: first.index + 1 })} ${first.message || ''}`
  };
}

function normalizeDomain(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^\*\./, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .toLowerCase();
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    url.hash = '';
    if ((url.pathname && url.pathname !== '/') || url.search) {
      return `${url.origin}${url.pathname}${url.search}`;
    }
    return normalizeDomain(url.hostname);
  } catch {
    return '';
  }
}

function normalizeAutoShowRule(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) || /^[^/\s]+\.[^/\s]+\/.+/.test(raw)) {
    return normalizeUrl(raw);
  }
  return normalizeDomain(raw);
}

function sanitizeAutoShowDomains(value) {
  const items = String(value || '')
    .split(/[\n,]+/)
    .map(normalizeAutoShowRule)
    .filter(Boolean)
    .filter((rule) => rule !== '*' && rule !== '.');
  return [...new Set(items)].join('\n');
}

function parseAutoShowDomains(value) {
  const normalized = sanitizeAutoShowDomains(value);
  return normalized ? normalized.split('\n') : [];
}

function setAutoShowDomainsValue(domains) {
  const normalized = sanitizeAutoShowDomains(domains.join('\n'));
  els.autoShowDomains.value = normalized;
  return normalized;
}

function renderAutoShowDomains(value) {
  const domains = parseAutoShowDomains(value);
  setAutoShowDomainsValue(domains);
  els.autoShowDomainChips.innerHTML = '';

  if (!domains.length) {
    const empty = document.createElement('div');
    empty.className = 'domain-chip-empty';
    empty.textContent = t(locale, 'autoShowDomainEmpty');
    els.autoShowDomainChips.appendChild(empty);
    return;
  }

  for (const domain of domains) {
    const chip = document.createElement('span');
    chip.className = 'domain-chip';

    const text = document.createElement('span');
    text.textContent = domain;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = t(locale, 'removeAutoShowDomain', { domain });
    remove.setAttribute('aria-label', t(locale, 'removeAutoShowDomain', { domain }));
    remove.addEventListener('click', () => removeAutoShowDomain(domain));

    chip.append(text, remove);
    els.autoShowDomainChips.appendChild(chip);
  }
}

async function persistAutoShowDomains(domains) {
  const normalized = setAutoShowDomainsValue(domains);
  renderAutoShowDomains(normalized);
  await updateSettings({ automation: { autoShowDomains: normalized } }, true, { rerender: false });
}

async function addAutoShowDomains(rawValue = els.autoShowDomainInput.value) {
  const incoming = parseAutoShowDomains(rawValue);
  if (!incoming.length) return;
  const current = parseAutoShowDomains(els.autoShowDomains.value);
  await persistAutoShowDomains([...current, ...incoming]);
  els.autoShowDomainInput.value = '';
  els.autoShowDomainInput.focus();
}

async function removeAutoShowDomain(domain) {
  const current = parseAutoShowDomains(els.autoShowDomains.value);
  await persistAutoShowDomains(current.filter((item) => item !== domain));
}

async function exportTranscripts() {
  const originalText = els.exportTranscript.textContent;
  els.exportTranscript.disabled = true;
  els.exportTranscript.textContent = t(locale, 'exporting');
  try {
    const transcripts = await getTranscripts();
    const folder = sanitizeDownloadFolder(els.transcriptFolder.value || settings?.privacy?.transcriptFolder);
    await updateSettings({ privacy: { transcriptFolder: folder } }, true, { rerender: false });
    await downloadMarkdownFile({
      markdown: formatTranscriptArchiveMarkdown(transcripts),
      filename: buildTranscriptArchiveFilename(folder)
    });
    els.saveState.textContent = t(locale, 'exportedTo', { folder });
  } catch (error) {
    els.saveState.textContent = t(locale, 'exportFailed', { message: error?.message || String(error) });
  } finally {
    els.exportTranscript.disabled = false;
    els.exportTranscript.textContent = originalText || t(locale, 'exportTranscripts');
  }
}

function renderLanguages() {
  renderLanguageSelect(els.targetLanguage, {
    locale,
    selectedValue: els.targetLanguage?.value || settings?.language?.targetLanguageCode
  });
}

function renderSettings(next) {
  settings = next;
  locale = resolveLocale(settings);
  applyLocale();
  els.uiLocale.value = locale;
  els.apiKey.value = settings.api.apiKey || '';
  setApiValidationState('neutral', settings.api.apiKey ? `${t(locale, 'apiHintSaved')} ${describeApiKeyCount(parseApiKeys(settings.api.apiKey).length)}`.trim() : t(locale, 'apiHintDefault'));
  els.targetLanguage.value = settings.language.targetLanguageCode;
  els.echoTargetLanguage.checked = settings.language.echoTargetLanguage;
  els.originalVolume.value = Math.round(settings.audio.originalVolume * 100);
  els.originalVolumeValue.textContent = `${els.originalVolume.value}%`;
  els.interpretationVolume.value = Math.round(settings.audio.interpretationVolume * 100);
  els.interpretationVolumeValue.textContent = `${els.interpretationVolume.value}%`;
  els.playInterpretation.checked = settings.audio.playInterpretation;
  els.showSource.checked = settings.subtitles.showSource;
  els.autoCollapseOverlay.checked = Boolean(settings.window.autoCollapse);
  els.autoShowOverlay.checked = Boolean(settings.automation?.autoShowOverlay);
  renderAutoShowDomains(settings.automation?.autoShowDomains || '');
  els.translationFontSize.value = settings.subtitles.translationFontSize;
  els.sourceFontSize.value = settings.subtitles.sourceFontSize;
  els.translationMaxLines.value = settings.subtitles.translationMaxLines ?? 6;
  els.sourceMaxLines.value = settings.subtitles.sourceMaxLines ?? 4;
  els.translationColor.value = settings.subtitles.translationColor;
  els.sourceColor.value = settings.subtitles.sourceColor;
  els.windowWidth.value = settings.window.width;
  els.windowHeight.value = settings.window.height ?? 260;
  els.backgroundColor.value = settings.window.backgroundColor;
  els.opacity.value = Math.round((settings.window.opacity ?? 0.72) * 100);
  els.opacityValue.textContent = `${els.opacity.value}%`;
  els.blur.value = Math.round(settings.window.blur ?? 22);
  els.blurValue.textContent = `${els.blur.value}px`;
  els.borderRadius.value = settings.window.borderRadius;
  els.saveTranscript.checked = Boolean(settings.privacy?.saveTranscript);
  els.transcriptFolder.value = settings.privacy.transcriptFolder || 'Gemive/Transcripts';
  els.debugLogging.checked = Boolean(settings.debug?.saveLogs);
}

async function updateSettings(patch, immediate = false, { rerender = true } = {}) {
  clearTimeout(saveTimer);
  const run = async () => {
    const response = await sendMessage({ type: MESSAGE.UPDATE_SETTINGS, patch });
    if (response?.ok) {
      if (rerender) renderSettings(response.settings);
      else settings = response.settings;
      setState('saved');
      return response.settings;
    }
    els.saveState.textContent = response?.error || t(locale, 'saveFailed');
    return null;
  };
  if (immediate) return await run();
  saveTimer = setTimeout(run, 180);
  return null;
}

async function saveAndValidateApiKey() {
  const apiKey = els.apiKey.value.trim();
  setApiValidationState('checking', `${t(locale, 'saveVerify')}…`);
  const nextSettings = await updateSettings({ api: { apiKey } }, true, { rerender: false });
  if (!nextSettings) return;
  const validation = await validateApiKey(apiKey);
  if (validation.ok) {
    setApiValidationState('valid', '');
    els.apiHint.textContent = validation.message || t(locale, 'apiHintDefault');
    els.saveState.textContent = '';
  } else {
    setApiValidationState('invalid', validation.message);
    setState('apiSavedFailed');
  }
}

function bind() {
  els.uiLocale.addEventListener('change', async () => {
    await updateSettings({ ui: { locale: els.uiLocale.value } }, true);
    await refreshDebugLogs();
  });
  els.saveApiKey.addEventListener('click', saveAndValidateApiKey);
  els.toggleApiVisibility.addEventListener('click', () => {
    const showing = els.apiKey.type === 'text';
    els.apiKey.type = showing ? 'password' : 'text';
    const key = showing ? 'showApiKey' : 'hideApiKey';
    els.toggleApiVisibility.setAttribute('title', t(locale, key));
    els.toggleApiVisibility.setAttribute('aria-label', t(locale, key));
    els.toggleApiVisibility.classList.toggle('is-visible', !showing);
  });
  els.apiKey.addEventListener('input', () => setApiValidationState('neutral', t(locale, 'apiHintPending')));
  els.targetLanguage.addEventListener('change', () => updateSettings({ language: { targetLanguageCode: els.targetLanguage.value } }, true));
  els.echoTargetLanguage.addEventListener('change', () => updateSettings({ language: { echoTargetLanguage: els.echoTargetLanguage.checked } }, true));
  els.originalVolume.addEventListener('input', () => {
    els.originalVolumeValue.textContent = `${els.originalVolume.value}%`;
    updateSettings({ audio: { originalVolume: Number(els.originalVolume.value) / 100 } }, false, { rerender: false });
  });
  els.interpretationVolume.addEventListener('input', () => {
    els.interpretationVolumeValue.textContent = `${els.interpretationVolume.value}%`;
    updateSettings({ audio: { interpretationVolume: Number(els.interpretationVolume.value) / 100 } }, false, { rerender: false });
  });
  els.playInterpretation.addEventListener('change', () => updateSettings({ audio: { playInterpretation: els.playInterpretation.checked } }, true));
  els.showSource.addEventListener('change', () => updateSettings({ subtitles: { showSource: els.showSource.checked } }, true));
  els.autoCollapseOverlay.addEventListener('change', () => updateSettings({ window: { autoCollapse: els.autoCollapseOverlay.checked } }, true));
  els.autoShowOverlay.addEventListener('change', () => updateSettings({ automation: { autoShowOverlay: els.autoShowOverlay.checked } }, true));
  els.addAutoShowDomain.addEventListener('click', () => addAutoShowDomains());
  els.autoShowDomainInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    addAutoShowDomains();
  });
  els.autoShowDomainInput.addEventListener('paste', () => {
    setTimeout(() => {
      if (/[\n,]/.test(els.autoShowDomainInput.value)) addAutoShowDomains();
    }, 0);
  });
  els.translationFontSize.addEventListener('input', () => updateSettings({ subtitles: { translationFontSize: Number(els.translationFontSize.value) } }, false, { rerender: false }));
  els.sourceFontSize.addEventListener('input', () => updateSettings({ subtitles: { sourceFontSize: Number(els.sourceFontSize.value) } }, false, { rerender: false }));
  els.translationMaxLines.addEventListener('input', () => updateSettings({ subtitles: { translationMaxLines: Number(els.translationMaxLines.value) } }, false, { rerender: false }));
  els.sourceMaxLines.addEventListener('input', () => updateSettings({ subtitles: { sourceMaxLines: Number(els.sourceMaxLines.value) } }, false, { rerender: false }));
  els.translationColor.addEventListener('input', () => updateSettings({ subtitles: { translationColor: els.translationColor.value } }, false, { rerender: false }));
  els.sourceColor.addEventListener('input', () => updateSettings({ subtitles: { sourceColor: els.sourceColor.value } }, false, { rerender: false }));
  els.windowWidth.addEventListener('input', () => updateSettings({ window: { width: Number(els.windowWidth.value) } }, false, { rerender: false }));
  els.windowHeight.addEventListener('input', () => updateSettings({ window: { height: Number(els.windowHeight.value) } }, false, { rerender: false }));
  els.backgroundColor.addEventListener('input', () => updateSettings({ window: { backgroundColor: els.backgroundColor.value } }, false, { rerender: false }));
  els.opacity.addEventListener('input', () => {
    els.opacityValue.textContent = `${els.opacity.value}%`;
    updateSettings({ window: { opacity: Number(els.opacity.value) / 100 } }, false, { rerender: false });
  });
  els.blur.addEventListener('input', () => {
    els.blurValue.textContent = `${els.blur.value}px`;
    updateSettings({ window: { blur: Number(els.blur.value) } }, false, { rerender: false });
  });
  els.borderRadius.addEventListener('input', () => updateSettings({ window: { borderRadius: Number(els.borderRadius.value) } }, false, { rerender: false }));
  els.saveTranscript.addEventListener('change', () => updateSettings({ privacy: { saveTranscript: els.saveTranscript.checked } }, true));
  els.transcriptFolder.addEventListener('change', () => updateSettings({ privacy: { transcriptFolder: sanitizeDownloadFolder(els.transcriptFolder.value) } }, true));
  els.debugLogging.addEventListener('change', () => updateSettings({ debug: { saveLogs: els.debugLogging.checked } }, true));
  els.exportTranscript.addEventListener('click', exportTranscripts);
  els.resetExperience.addEventListener('click', () => updateSettings({
    audio: DEFAULT_SETTINGS.audio,
    subtitles: DEFAULT_SETTINGS.subtitles,
    window: DEFAULT_SETTINGS.window
  }, true));
  els.clearTranscript.addEventListener('click', async () => {
    await clearTranscripts();
    setState('localTranscriptsCleared');
  });
  els.refreshDebugLogs.addEventListener('click', refreshDebugLogs);
  els.copyDebugLogs.addEventListener('click', async () => {
    await refreshDebugLogs();
    await navigator.clipboard.writeText(els.debugLogs.value);
    setState('debugLogsCopied');
  });
  els.clearDebugLogs.addEventListener('click', async () => {
    await sendMessage({ type: MESSAGE.CLEAR_DEBUG_LOGS });
    await refreshDebugLogs();
    setState('debugLogsCleared');
  });
}

async function init() {
  renderUiLocales();
  bind();
  const response = await sendMessage({ type: MESSAGE.GET_SETTINGS });
  renderSettings(response.settings);
  setState('ready');
  await refreshDebugLogs();
}

init().catch((error) => {
  els.saveState.textContent = error.message;
});
