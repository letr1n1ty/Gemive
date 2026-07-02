import { SUPPORTED_LANGUAGES, formatLanguageLabel } from '../core/language-registry.js';
import { MESSAGE } from '../core/message-types.js';
import { localizeDocument, resolveLocale, t } from '../core/i18n.js';

const els = {
  status: document.querySelector('#status'),
  targetLanguage: document.querySelector('#targetLanguage'),
  playInterpretation: document.querySelector('#playInterpretation'),
  originalVolume: document.querySelector('#originalVolume'),
  originalVolumeValue: document.querySelector('#originalVolumeValue'),
  interpretationVolume: document.querySelector('#interpretationVolume'),
  interpretationVolumeValue: document.querySelector('#interpretationVolumeValue'),
  showTranslation: document.querySelector('#showTranslation'),
  showSource: document.querySelector('#showSource'),
  saveTranscript: document.querySelector('#saveTranscript'),
  start: document.querySelector('#start'),
  startLabel: document.querySelector('#startLabel'),
  stop: document.querySelector('#stop'),
  openOptions: document.querySelector('#openOptions')
};

let currentPopupStatus = 'idle';
let currentSession = { status: 'idle', tabId: null };
let activeTabId = null;

let settings = null;
let locale = 'zh-Hant';
let pendingRangePatch = null;
let rangeSaveTimer = null;
let rangeSaveInFlight = false;
let rangeInteractionUntil = 0;
let rangeIdleTimer = null;

const RANGE_SAVE_THROTTLE_MS = 120;
const RANGE_RENDER_SUPPRESS_MS = 350;

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

async function resolveActiveTabId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id ?? null;
  } catch {
    activeTabId = null;
  }
  return activeTabId;
}

function getStatusName(value) {
  if (typeof value === 'object' && value) return value.status || 'idle';
  return value || 'idle';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergePatch(base = {}, patch = {}) {
  const output = { ...(base || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    output[key] = isPlainObject(output[key]) && isPlainObject(value) ? mergePatch(output[key], value) : value;
  }
  return output;
}

function markRangeInteraction() {
  rangeInteractionUntil = Date.now() + RANGE_RENDER_SUPPRESS_MS;
  clearTimeout(rangeIdleTimer);
  rangeIdleTimer = setTimeout(() => {
    rangeInteractionUntil = 0;
  }, RANGE_RENDER_SUPPRESS_MS);
}

function shouldSuppressSettingsRender() {
  return Date.now() < rangeInteractionUntil;
}

function isBusyStatus(status) {
  return status === 'starting' || status === 'capturing' || status === 'connecting' || status === 'translating' || status === 'stopping';
}

function isCurrentTabSession() {
  return Boolean(currentSession?.tabId && activeTabId && currentSession.tabId === activeTabId);
}

function isOtherTabSession() {
  return Boolean(isBusyStatus(currentPopupStatus) && currentSession?.tabId && activeTabId && currentSession.tabId !== activeTabId);
}

async function sendOverlayMessage(tabId, payload) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: MESSAGE.OVERLAY_SHOW, payload });
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content/subtitle-overlay.js'] });
      await chrome.tabs.sendMessage(tabId, { type: MESSAGE.OVERLAY_SHOW, payload });
    } catch {
      // Content script may not be available on chrome:// pages or restricted URLs.
    }
  }
}

async function showOverlayIfCurrentTab() {
  if (!settings || !activeTabId) return;
  const busyHere = isCurrentTabSession() && isBusyStatus(currentPopupStatus);
  if (busyHere) {
    await sendOverlayMessage(activeTabId, { settings, collapse: false });
  }
}

function applyLocale() {
  locale = resolveLocale(settings);
  localizeDocument(locale);
  renderLanguages();
}

function renderLanguages() {
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
  applyLocale();
  els.targetLanguage.value = settings.language.targetLanguageCode;
  els.playInterpretation.checked = settings.audio.playInterpretation;
  els.originalVolume.value = Math.round(settings.audio.originalVolume * 100);
  els.originalVolumeValue.textContent = `${els.originalVolume.value}%`;
  els.interpretationVolume.value = Math.round(settings.audio.interpretationVolume * 100);
  els.interpretationVolumeValue.textContent = `${els.interpretationVolume.value}%`;
  els.showTranslation.checked = settings.subtitles.showTranslation;
  els.showSource.checked = settings.subtitles.showSource;
  els.saveTranscript.checked = settings.privacy.saveTranscript;
  updateButtons(currentPopupStatus);
}

async function updateSettings(patch, { rerender = true } = {}) {
  const response = await sendMessage({ type: MESSAGE.UPDATE_SETTINGS, patch });
  if (response?.ok) {
    settings = response.settings;
    if (rerender && !shouldSuppressSettingsRender()) renderSettings(response.settings);
    return response.settings;
  }
  return null;
}

async function flushRangeSettingsUpdate() {
  clearTimeout(rangeSaveTimer);
  rangeSaveTimer = null;

  if (!pendingRangePatch || rangeSaveInFlight) return;

  const patch = pendingRangePatch;
  pendingRangePatch = null;
  rangeSaveInFlight = true;

  try {
    await updateSettings(patch, { rerender: false });
  } finally {
    rangeSaveInFlight = false;
    if (pendingRangePatch) {
      rangeSaveTimer = setTimeout(flushRangeSettingsUpdate, RANGE_SAVE_THROTTLE_MS);
    }
  }
}

function queueRangeSettingsUpdate(patch) {
  markRangeInteraction();
  settings = mergePatch(settings, patch);
  pendingRangePatch = mergePatch(pendingRangePatch, patch);

  if (!rangeSaveTimer && !rangeSaveInFlight) {
    rangeSaveTimer = setTimeout(flushRangeSettingsUpdate, RANGE_SAVE_THROTTLE_MS);
  }
}

function commitRangeSettingsUpdate(patch) {
  markRangeInteraction();
  settings = mergePatch(settings, patch);
  pendingRangePatch = mergePatch(pendingRangePatch, patch);
  flushRangeSettingsUpdate();
}

function updateOriginalVolumeFromInput({ commit = false } = {}) {
  const value = Number(els.originalVolume.value);
  els.originalVolumeValue.textContent = `${value}%`;
  const patch = { audio: { originalVolume: value / 100 } };
  if (commit) commitRangeSettingsUpdate(patch);
  else queueRangeSettingsUpdate(patch);
}

function updateInterpretationVolumeFromInput({ commit = false } = {}) {
  const value = Number(els.interpretationVolume.value);
  els.interpretationVolumeValue.textContent = `${value}%`;
  const patch = { audio: { interpretationVolume: value / 100 } };
  if (commit) commitRangeSettingsUpdate(patch);
  else queueRangeSettingsUpdate(patch);
}

async function start() {
  await resolveActiveTabId();
  setStatus({ ...currentSession, status: 'starting', tabId: activeTabId || currentSession?.tabId || null });
  try {
    const response = await sendMessage({ type: MESSAGE.START_SESSION, payload: { tabId: activeTabId || undefined, source: isOtherTabSession() ? 'switch-tab' : 'popup' } });
    if (response?.ok) setStatus(response.session || 'capturing');
    if (!response?.ok) setStatus({ status: 'error', lastError: { message: response?.error || t(locale, 'failedToStart') } });
  } catch (error) {
    setStatus({ status: 'error', lastError: { message: error?.message || String(error) } });
  }
}

async function stop() {
  els.stop.disabled = true;
  try {
    await sendMessage({ type: MESSAGE.STOP_SESSION, payload: { keepOverlay: true } });
  } catch (error) {
    setStatus({ status: 'error', lastError: { message: error?.message || String(error) } });
  }
}

function updateStatusShortcut(status) {
  currentPopupStatus = status || 'idle';
  els.status.classList.add('settings-shortcut');
  els.status.disabled = false;
  els.status.textContent = t(locale, 'openSettings');
  els.status.title = t(locale, 'openSettings');
}

function functionOpenOptions() {
  chrome.runtime.openOptionsPage();
}

function updateButtons(status) {
  const busy = isBusyStatus(status);
  const otherTab = isOtherTabSession();
  const sameTabBusy = busy && !otherTab;

  els.start.disabled = sameTabBusy && status !== 'error';
  els.start.classList.toggle('busy-running', sameTabBusy && status !== 'stopping');
  els.start.classList.toggle('switch-target', otherTab);

  let label = t(locale, 'start');
  let title = t(locale, 'start');
  if (otherTab) {
    label = t(locale, 'switchToThisTab');
    title = t(locale, 'switchToThisTabHint');
  } else if (sameTabBusy && status !== 'stopping') {
    label = t(locale, 'statusTranslating');
    title = t(locale, 'statusTranslating');
  }

  if (els.startLabel) els.startLabel.textContent = label;
  els.start.title = title;
  els.stop.disabled = status === 'idle' || status === 'stopping';
}

function setStatus(value) {
  if (typeof value === 'object' && value) {
    currentSession = { ...currentSession, ...value, status: value.status || currentSession.status || 'idle' };
    if (value.status === 'error' && value.lastError?.message) {
      updateStatusShortcut('error');
      els.status.title = `${t(locale, 'statusError')} · ${value.lastError.message}`;
      updateButtons('error');
      return;
    }
    value = value.status;
  } else {
    currentSession = { ...currentSession, status: value || 'idle' };
  }
  const labels = {
    idle: t(locale, 'statusIdle'),
    starting: t(locale, 'statusStarting'),
    capturing: t(locale, 'statusCapturing'),
    connecting: t(locale, 'statusConnecting'),
    translating: t(locale, 'statusTranslating'),
    stopping: t(locale, 'statusStopping'),
    error: t(locale, 'statusError')
  };
  const status = value || 'idle';
  updateStatusShortcut(status);
  // The header shortcut must remain a settings entry. Runtime state is represented by the start button.
  updateButtons(status);
}

async function init() {
  await resolveActiveTabId();
  const settingsResponse = await sendMessage({ type: MESSAGE.GET_SETTINGS });
  renderSettings(settingsResponse.settings);
  const statusResponse = await sendMessage({ type: MESSAGE.GET_STATUS });
  setStatus(statusResponse.session);
  showOverlayIfCurrentTab();
}

els.targetLanguage.addEventListener('change', () => updateSettings({ language: { targetLanguageCode: els.targetLanguage.value } }));
els.playInterpretation.addEventListener('change', () => updateSettings({ audio: { playInterpretation: els.playInterpretation.checked } }));
els.originalVolume.addEventListener('input', () => updateOriginalVolumeFromInput());
els.originalVolume.addEventListener('change', () => updateOriginalVolumeFromInput({ commit: true }));
els.interpretationVolume.addEventListener('input', () => updateInterpretationVolumeFromInput());
els.interpretationVolume.addEventListener('change', () => updateInterpretationVolumeFromInput({ commit: true }));
els.showTranslation.addEventListener('change', () => updateSettings({ subtitles: { showTranslation: els.showTranslation.checked } }));
els.showSource.addEventListener('change', () => updateSettings({ subtitles: { showSource: els.showSource.checked } }));
els.saveTranscript.addEventListener('change', () => updateSettings({ privacy: { saveTranscript: els.saveTranscript.checked } }));
els.start.addEventListener('click', start);
els.stop.addEventListener('click', stop);
if (els.openOptions) els.openOptions.addEventListener('click', functionOpenOptions);
els.status.addEventListener('click', functionOpenOptions);

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === MESSAGE.SESSION_STATUS) {
    setStatus(message.payload || 'idle');
    showOverlayIfCurrentTab();
  }
  if (message.type === MESSAGE.SETTINGS_UPDATED) {
    if (shouldSuppressSettingsRender()) {
      settings = message.payload;
      return;
    }
    renderSettings(message.payload);
  }
});

init().catch((error) => setStatus({ status: 'error', lastError: { message: error.message } }));
