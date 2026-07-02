import { SUPPORTED_LANGUAGES, formatLanguageLabel } from '../core/language-registry.js';
import { DEFAULT_SETTINGS } from '../core/settings.js';
import { MESSAGE } from '../core/message-types.js';
import { clearTranscripts, getTranscripts } from '../storage/transcript-store.js';
import { UI_LOCALES, formatUiLocaleLabel, localizeDocument, resolveLocale, t } from '../core/i18n.js';

const ids = [
  'uiLocale', 'apiKey', 'toggleApiVisibility', 'saveApiKey', 'apiKeyCheck', 'apiHint', 'targetLanguage', 'echoTargetLanguage',
  'originalVolume', 'originalVolumeValue', 'interpretationVolume', 'interpretationVolumeValue',
  'playInterpretation', 'showSource', 'autoCollapseOverlay', 'translationFontSize', 'sourceFontSize', 'translationMaxLines', 'sourceMaxLines',
  'translationColor', 'sourceColor', 'windowWidth', 'windowHeight', 'backgroundColor', 'opacity', 'opacityValue',
  'blur', 'blurValue', 'borderRadius', 'saveTranscript', 'transcriptFolder', 'exportTranscript', 'clearTranscript', 'resetExperience',
  'refreshDebugLogs', 'copyDebugLogs', 'clearDebugLogs', 'debugLogs', 'saveState'
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

function parseApiKeys(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
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

function sanitizeDownloadFolder(value) {
  const cleaned = String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim().replace(/[<>:"|?*\u0000-\u001F]/g, '-'))
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
  return cleaned || 'Gemive/Transcripts';
}

function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function formatIso(value) {
  if (!value) return '';
  try { return new Date(value).toISOString(); } catch { return String(value); }
}

function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function mdText(value) {
  return String(value || '').trim() || '_No content captured._';
}

function transcriptToMarkdown(transcripts) {
  const exportedAt = new Date().toISOString();
  const lines = [
    '# Gemive Transcripts',
    '',
    `Exported: ${exportedAt}`,
    `Count: ${transcripts.length}`,
    ''
  ];

  if (!transcripts.length) {
    lines.push('_No transcripts saved yet._', '');
    return lines.join('\n');
  }

  transcripts.forEach((entry, index) => {
    const title = entry.tabTitle || 'Untitled tab';
    const startedAt = formatIso(entry.startedAt || entry.receivedAt || entry.createdAt);
    const endedAt = formatIso(entry.endedAt);
    lines.push('---', '', `## ${index + 1}. ${title}`, '');
    if (startedAt) lines.push(`- Started: ${startedAt}`);
    if (endedAt) lines.push(`- Stopped: ${endedAt}`);
    if (entry.durationMs !== undefined) lines.push(`- Duration: ${formatDuration(entry.durationMs)}`);
    if (entry.tabUrl) lines.push(`- URL: ${entry.tabUrl}`);
    if (entry.sourceLanguageCode) lines.push(`- Source language: ${entry.sourceLanguageCode}`);
    if (entry.targetLanguageCode) lines.push(`- Target language: ${entry.targetLanguageCode}`);
    if (entry.stopReason) lines.push(`- Stop reason: ${entry.stopReason}`);
    lines.push('', '### Translation', '', mdText(entry.translationText), '', '### Source', '', mdText(entry.sourceText), '');
  });

  return lines.join('\n');
}


async function exportTranscripts() {
  const originalText = els.exportTranscript.textContent;
  els.exportTranscript.disabled = true;
  els.exportTranscript.textContent = t(locale, 'exporting');
  try {
    const transcripts = await getTranscripts();
    const folder = sanitizeDownloadFolder(els.transcriptFolder.value || settings?.privacy?.transcriptFolder);
    await updateSettings({ privacy: { transcriptFolder: folder } }, true, { rerender: false });
    const payload = transcriptToMarkdown(transcripts);
    const blob = new Blob([payload], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      if (!chrome.downloads?.download) throw new Error('Downloads API is unavailable. Reload the extension after granting the downloads permission.');
      await chrome.downloads.download({
        url,
        filename: `${folder}/gemive-transcripts-${timestampForFilename()}.md`,
        saveAs: false,
        conflictAction: 'uniquify'
      });
      els.saveState.textContent = t(locale, 'exportedTo', { folder });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (error) {
    els.saveState.textContent = t(locale, 'exportFailed', { message: error?.message || String(error) });
  } finally {
    els.exportTranscript.disabled = false;
    els.exportTranscript.textContent = originalText || t(locale, 'exportTranscripts');
  }
}

function renderLanguages() {
  if (!els.targetLanguage) return;
  const previous = els.targetLanguage.value || settings?.language?.targetLanguageCode;
  const popular = SUPPORTED_LANGUAGES.filter((language) => language.popular);
  const others = SUPPORTED_LANGUAGES.filter((language) => !language.popular);
  els.targetLanguage.innerHTML = '';
  const popularGroup = document.createElement('optgroup');
  popularGroup.label = t(locale, 'popularLanguages');
  for (const language of popular) popularGroup.appendChild(new Option(formatLanguageLabel(language), language.code));
  const allGroup = document.createElement('optgroup');
  allGroup.label = t(locale, 'allLanguages');
  for (const language of others) allGroup.appendChild(new Option(formatLanguageLabel(language), language.code));
  els.targetLanguage.append(popularGroup, allGroup);
  if (previous) els.targetLanguage.value = previous;
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
  els.saveTranscript.checked = settings.privacy.saveTranscript;
  els.transcriptFolder.value = settings.privacy.transcriptFolder || 'Gemive/Transcripts';
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
