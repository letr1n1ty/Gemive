import { MESSAGE } from '../core/message-types.js';
import { getSettings, updateSettings } from '../storage/settings-store.js';
import { appendTranscript } from '../storage/transcript-store.js';
import { toGemiveError } from '../core/error-types.js';
import { resolveLocale, t } from '../core/i18n.js';

const OFFSCREEN_URL = 'offscreen/offscreen.html';

const SESSION_STATUSES = new Set(['idle', 'starting', 'capturing', 'connecting', 'translating', 'stopping', 'error']);
const RUNNING_STATUSES = new Set(['starting', 'capturing', 'connecting', 'translating']);

const SPEECH_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
const INACTIVITY_CHECK_THROTTLE_MS = 30 * 1000;
const NAVIGATION_RESTART_DEBOUNCE_MS = 800;
const CAPTURE_RELEASE_POLL_MS = 120;

const DEBUG_LOG_KEY = 'gemive.debug.logs';
const DEBUG_LOG_LIMIT = 500;
const TRANSCRIPT_UPDATE_LIMIT = 120;
const TRANSCRIPT_URL_HISTORY_LIMIT = 20;

function createIdleSession(extra = {}) {
  return {
    status: 'idle',
    tabId: null,
    startedAt: null,
    tabUrl: '',
    lastSpeechActivityAt: null,
    lastError: null,
    ...extra
  };
}

let session = createIdleSession();
let activeTranscriptSession = null;
let lastTranscriptSnapshotSignature = '';
let startInFlight = null;
let navigationRestartInFlight = null;
let navigationRestartTimer = null;
let pendingNavigationRestart = null;
let lastSpeechActivityAt = 0;
let lastInactivityCheckAt = 0;

function normalizeStatus(status) {
  return SESSION_STATUSES.has(status) ? status : 'error';
}

function normalizeTabId(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function normalizeUrl(value) {
  return typeof value === 'string' ? value : '';
}

function sanitizeDebugValue(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value
      .replace(/key=AIza[0-9A-Za-z_\-]+/g, 'key=[REDACTED]')
      .replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[REDACTED_API_KEY]');
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeDebugValue(value.message),
      stack: sanitizeDebugValue(value.stack || '')
    };
  }
  if (Array.isArray(value)) return value.map(sanitizeDebugValue).slice(0, 20);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      out[key] = /apiKey|authorization|token|password/i.test(key) ? '[REDACTED]' : sanitizeDebugValue(item);
    }
    return out;
  }
  return String(value);
}

async function appendDebugLog(entry = {}) {
  const safeEntry = {
    at: Date.now(),
    iso: new Date().toISOString(),
    area: entry.area || 'background',
    event: entry.event || 'event',
    data: sanitizeDebugValue(entry.data ?? {}),
    tabId: entry.tabId ?? session.tabId ?? null,
    sessionStatus: session.status
  };
  console.debug('[Gemive debug]', safeEntry.area, safeEntry.event, safeEntry.data);
  try {
    const result = await chrome.storage.local.get(DEBUG_LOG_KEY);
    const logs = Array.isArray(result[DEBUG_LOG_KEY]) ? result[DEBUG_LOG_KEY] : [];
    logs.push(safeEntry);
    await chrome.storage.local.set({ [DEBUG_LOG_KEY]: logs.slice(-DEBUG_LOG_LIMIT) });
  } catch (error) {
    console.warn('[Gemive debug] failed to persist log', error);
  }
}

async function getDebugLogs() {
  const result = await chrome.storage.local.get(DEBUG_LOG_KEY);
  return Array.isArray(result[DEBUG_LOG_KEY]) ? result[DEBUG_LOG_KEY] : [];
}

async function clearDebugLogs() {
  await chrome.storage.local.remove(DEBUG_LOG_KEY);
}

function debug(event, data = {}) {
  appendDebugLog({ area: 'background', event, data }).catch(() => undefined);
}

function localized(settings, key) {
  return t(resolveLocale(settings), key);
}

function parseApiKeys(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isRunningStatus(status = session.status) {
  return RUNNING_STATUSES.has(status);
}

function updateSession(patch = {}) {
  const nextStatus = patch.status ? normalizeStatus(patch.status) : normalizeStatus(session.status);
  session = {
    ...session,
    ...patch,
    status: nextStatus,
    tabId: patch.tabId === undefined ? session.tabId : normalizeTabId(patch.tabId),
    tabUrl: patch.tabUrl === undefined ? session.tabUrl : normalizeUrl(patch.tabUrl),
    lastError: patch.lastError === undefined ? session.lastError : patch.lastError
  };
  return session;
}

function relayStatus() {
  const snapshot = { ...session };
  chrome.runtime.sendMessage({ type: MESSAGE.SESSION_STATUS, payload: snapshot }).catch(() => undefined);
  if (snapshot.tabId) {
    chrome.tabs.sendMessage(snapshot.tabId, { type: MESSAGE.SESSION_STATUS, payload: snapshot }).catch(() => undefined);
  }
}

function setStatus(status, extra = {}) {
  updateSession({ ...extra, status });
  debug('session.status', { status: session.status, extra });
  relayStatus();
}

function markSpeechActivity(reason = 'speech', extra = {}) {
  if (!isRunningStatus()) return;
  lastSpeechActivityAt = Date.now();
  updateSession({ lastSpeechActivityAt });
  if (reason !== 'audio-level') debug('speech.activity', { reason, ...extra });
}

async function checkSpeechInactivity(force = false) {
  if (!isRunningStatus()) return;
  const now = Date.now();
  if (!force && now - lastInactivityCheckAt < INACTIVITY_CHECK_THROTTLE_MS) return;
  lastInactivityCheckAt = now;
  const anchor = lastSpeechActivityAt || session.startedAt || now;
  const silentForMs = now - anchor;
  if (silentForMs < SPEECH_INACTIVITY_TIMEOUT_MS) return;
  debug('speech.inactivity.timeout', { silentForMs, timeoutMs: SPEECH_INACTIVITY_TIMEOUT_MS });
  await stopSession({ keepOverlay: true, reason: 'speech-inactivity-10m' });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error(t('zh-Hant', 'noActiveTab'));
  return tab;
}

async function ensureOffscreenDocument() {
  const hasDocument = await chrome.offscreen.hasDocument();
  debug('offscreen.hasDocument', { hasDocument });
  if (hasDocument) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['AUDIO_PLAYBACK', 'USER_MEDIA'],
    justification: 'Gemive captures tab audio, routes original audio, streams PCM to Gemini, and plays translated interpretation audio.'
  });
  debug('offscreen.created');
}

async function closeOffscreenDocumentIfPresent() {
  const hasDocument = await chrome.offscreen.hasDocument().catch(() => false);
  if (!hasDocument) return;
  await chrome.offscreen.closeDocument().catch(() => undefined);
}

async function ensureOverlay(tabId) {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: MESSAGE.OVERLAY_SHOW });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/subtitle-overlay.js']
    });
    await chrome.tabs.sendMessage(tabId, { type: MESSAGE.OVERLAY_SHOW });
  }
}

async function sendToOffscreen(message) {
  debug('offscreen.send', { type: message?.type });
  const response = await chrome.runtime.sendMessage({ ...message, target: 'offscreen' });
  debug('offscreen.response', { type: message?.type, response });
  if (!response?.ok) {
    const settings = await getSettings().catch(() => null);
    throw new Error(response?.error || localized(settings, 'offscreenSessionFailed'));
  }
  return response;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getActiveCapture(tabId) {
  if (!tabId) return null;
  const capturedTabs = await chrome.tabCapture.getCapturedTabs().catch(() => []);
  return capturedTabs.find((info) => {
    if (!info || info.tabId !== tabId) return false;
    const status = info.status || 'unknown';
    return status !== 'stopped' && status !== 'error';
  }) || null;
}

async function waitForCaptureRelease(tabId, timeoutMs = 1800) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const activeCapture = await getActiveCapture(tabId);
    if (!activeCapture) return true;
    await delay(CAPTURE_RELEASE_POLL_MS);
  }
  return !(await getActiveCapture(tabId));
}

async function acquireStreamId(tabId) {
  try {
    return await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (error) {
    const message = error?.message || String(error);
    if (!message.includes('active stream')) throw error;
    await releaseExistingCaptureIfOwned(tabId);
    await delay(350);
    return await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  }
}

async function releaseExistingCaptureIfOwned(tabId) {
  const activeCapture = await getActiveCapture(tabId);
  if (!activeCapture) return;

  await sendToOffscreen({ type: MESSAGE.STOP_OFFSCREEN_SESSION }).catch(() => undefined);
  if (await waitForCaptureRelease(tabId, 1800)) return;

  await closeOffscreenDocumentIfPresent();
  if (await waitForCaptureRelease(tabId, 2600)) {
    await ensureOffscreenDocument();
    debug('offscreen.ready');
    return;
  }

  throw new Error(localized(await getSettings().catch(() => null), 'activeCaptureStream'));
}

function startTranscriptRecording(settings, tab) {
  if (!settings?.privacy?.saveTranscript) {
    activeTranscriptSession = null;
    lastTranscriptSnapshotSignature = '';
    return;
  }

  activeTranscriptSession = {
    id: crypto.randomUUID(),
    type: 'session',
    startedAt: Date.now(),
    endedAt: null,
    tabId: tab?.id ?? null,
    tabTitle: tab?.title || '',
    tabUrl: tab?.url || '',
    urlHistory: tab?.url ? [{ url: tab.url, at: Date.now() }] : [],
    sourceText: '',
    translationText: '',
    sourceLanguageCode: '',
    targetLanguageCode: settings.language?.targetLanguageCode || '',
    updates: [],
    stopReason: ''
  };
}

function normalizeTranscriptText(value) {
  return String(value || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function updateTranscriptRecording(payload) {
  if (!activeTranscriptSession) return;
  const translationText = normalizeTranscriptText(payload?.translation?.text);
  const sourceText = normalizeTranscriptText(payload?.source?.text);
  if (!translationText && !sourceText) return;

  const signature = `${sourceText}\n---\n${translationText}`;
  if (signature === lastTranscriptSnapshotSignature) return;
  lastTranscriptSnapshotSignature = signature;

  activeTranscriptSession.translationText = translationText || activeTranscriptSession.translationText;
  activeTranscriptSession.sourceText = sourceText || activeTranscriptSession.sourceText;
  activeTranscriptSession.sourceLanguageCode = payload?.source?.languageCode || activeTranscriptSession.sourceLanguageCode || '';
  activeTranscriptSession.targetLanguageCode = payload?.translation?.languageCode || activeTranscriptSession.targetLanguageCode || '';
  activeTranscriptSession.updatedAt = Date.now();
  activeTranscriptSession.updates.push({ at: Date.now(), translationText, sourceText });
  if (activeTranscriptSession.updates.length > TRANSCRIPT_UPDATE_LIMIT) activeTranscriptSession.updates.shift();
}

async function finalizeTranscriptRecording(reason = 'stop') {
  const current = activeTranscriptSession;
  activeTranscriptSession = null;
  lastTranscriptSnapshotSignature = '';
  if (!current) return;

  current.endedAt = Date.now();
  current.stopReason = reason;
  current.durationMs = Math.max(0, current.endedAt - current.startedAt);
  await appendTranscript(current);
  debug('transcript.recording.saved', {
    reason,
    durationMs: current.durationMs,
    hasSource: Boolean(current.sourceText),
    hasTranslation: Boolean(current.translationText)
  });
}

function noteTranscriptUrlChange(url) {
  if (!activeTranscriptSession || !url) return;
  activeTranscriptSession.tabUrl = url;
  const history = Array.isArray(activeTranscriptSession.urlHistory) ? activeTranscriptSession.urlHistory : [];
  if (!history.length || history[history.length - 1]?.url !== url) {
    history.push({ url, at: Date.now() });
    activeTranscriptSession.urlHistory = history.slice(-TRANSCRIPT_URL_HISTORY_LIMIT);
  }
}

function createNavigationRestart(tabId, url, reason) {
  return {
    tabId: normalizeTabId(tabId),
    url: normalizeUrl(url),
    reason: reason || 'url-change',
    at: Date.now()
  };
}

async function restartSessionAfterNavigation(request = {}) {
  const restart = createNavigationRestart(request.tabId, request.url, request.reason);
  if (!restart.tabId || restart.tabId !== session.tabId || !isRunningStatus()) return session;

  const settings = await getSettings();
  const tab = await chrome.tabs.get(restart.tabId).catch(() => null);
  if (!tab?.id) {
    await stopSession({ keepOverlay: true, reason: 'tab-closed' });
    return session;
  }

  if (!tab.active) {
    pendingNavigationRestart = createNavigationRestart(tab.id, tab.url || restart.url || session.tabUrl || '', restart.reason);
    debug('navigation.restart.deferred.inactive-tab', pendingNavigationRestart);
    return session;
  }

  const nextUrl = tab.url || restart.url || session.tabUrl || '';
  pendingNavigationRestart = null;
  debug('navigation.restart.begin', { tabId: tab.id, url: nextUrl, reason: restart.reason });
  noteTranscriptUrlChange(nextUrl);
  setStatus('starting', {
    tabId: tab.id,
    tabUrl: nextUrl,
    startedAt: session.startedAt || Date.now(),
    lastError: null
  });

  await ensureOverlay(tab.id);
  await chrome.tabs.sendMessage(tab.id, { type: MESSAGE.OVERLAY_SHOW, payload: { settings } }).catch(() => undefined);
  await ensureOffscreenDocument();
  await sendToOffscreen({ type: MESSAGE.STOP_OFFSCREEN_SESSION }).catch(() => undefined);
  await waitForCaptureRelease(tab.id, 2600).catch(() => undefined);
  await releaseExistingCaptureIfOwned(tab.id);

  const streamId = await acquireStreamId(tab.id);
  debug('navigation.streamId.acquired', { tabId: tab.id, hasStreamId: Boolean(streamId) });
  setStatus('capturing', { tabId: tab.id, tabUrl: nextUrl, startedAt: session.startedAt || Date.now(), lastError: null });
  await sendToOffscreen({
    type: MESSAGE.START_OFFSCREEN_SESSION,
    payload: { streamId, tabId: tab.id, settings }
  });
  markSpeechActivity('navigation-restarted', { tabId: tab.id });
  setStatus('translating', { tabId: tab.id, tabUrl: nextUrl, startedAt: session.startedAt || Date.now(), lastError: null });
  debug('navigation.restart.complete', { tabId: tab.id, url: nextUrl });
  return session;
}

function scheduleNavigationRestart(tabId, url, reason = 'url-change') {
  if (!tabId || tabId !== session.tabId || !isRunningStatus()) return;
  const restart = createNavigationRestart(tabId, url || session.tabUrl || '', reason);
  if (!restart.tabId) return;
  if (restart.url) updateSession({ tabUrl: restart.url });
  pendingNavigationRestart = restart;
  clearTimeout(navigationRestartTimer);
  navigationRestartTimer = setTimeout(() => {
    if (navigationRestartInFlight) return;
    navigationRestartInFlight = restartSessionAfterNavigation(pendingNavigationRestart)
      .catch(async (error) => {
        const gemiveError = toGemiveError(error);
        await finalizeTranscriptRecording('navigation-restart-error').catch((saveError) => debug('transcript.recording.saveFailed', { message: saveError?.message || String(saveError) }));
        setStatus('error', { lastError: gemiveError });
      })
      .finally(() => {
        navigationRestartInFlight = null;
      });
  }, NAVIGATION_RESTART_DEBOUNCE_MS);
  debug('navigation.restart.scheduled', pendingNavigationRestart);
}

async function startSession(request = {}) {
  debug('start.request', { request });
  const settings = await getSettings();
  if (!parseApiKeys(settings.api?.apiKey).length) {
    throw new Error(localized(settings, 'apiKeyMissing'));
  }

  const targetTabId = normalizeTabId(request.tabId);
  const tab = targetTabId ? await chrome.tabs.get(targetTabId) : await getActiveTab();
  if (!tab?.id) throw new Error(localized(settings, 'noTargetTab'));

  if (session.status !== 'idle' && session.status !== 'error') {
    await stopSession();
  }

  startTranscriptRecording(settings, tab);
  lastSpeechActivityAt = Date.now();
  lastInactivityCheckAt = 0;
  const startedAt = Date.now();
  setStatus('starting', { tabId: tab.id, startedAt, tabUrl: tab.url || '', lastSpeechActivityAt, lastError: null });
  debug('start.targetTab', { tabId: tab.id, title: tab.title, url: tab.url });
  await ensureOverlay(tab.id);
  await chrome.tabs.sendMessage(tab.id, { type: MESSAGE.OVERLAY_SHOW, payload: { settings } });
  await ensureOffscreenDocument();
  debug('offscreen.ready');
  await releaseExistingCaptureIfOwned(tab.id);

  const streamId = await acquireStreamId(tab.id);
  debug('tabCapture.streamId.acquired', { tabId: tab.id, hasStreamId: Boolean(streamId) });
  setStatus('capturing', { tabId: tab.id, tabUrl: tab.url || '', startedAt, lastSpeechActivityAt, lastError: null });

  await sendToOffscreen({
    type: MESSAGE.START_OFFSCREEN_SESSION,
    payload: { streamId, tabId: tab.id, settings }
  });

  markSpeechActivity('session-started', { tabId: tab.id });
  setStatus('translating', { tabId: tab.id, tabUrl: tab.url || '', startedAt: session.startedAt || startedAt, lastSpeechActivityAt, lastError: null });
  return session;
}

async function stopSession(options = {}) {
  debug('stop.request', { options });
  clearTimeout(navigationRestartTimer);
  navigationRestartTimer = null;
  pendingNavigationRestart = null;
  const targetTabId = session.tabId;
  const keepOverlay = Boolean(options.keepOverlay);
  if (targetTabId && !keepOverlay) {
    chrome.tabs.sendMessage(targetTabId, { type: MESSAGE.OVERLAY_HIDE }).catch(() => undefined);
  }
  setStatus('stopping', { lastError: null });
  await sendToOffscreen({ type: MESSAGE.STOP_OFFSCREEN_SESSION }).catch(() => undefined);
  if (targetTabId) await waitForCaptureRelease(targetTabId, 2200).catch(() => undefined);
  await finalizeTranscriptRecording(options.reason || 'stop').catch((error) => debug('transcript.recording.saveFailed', { message: error?.message || String(error) }));
  lastSpeechActivityAt = 0;
  lastInactivityCheckAt = 0;
  setStatus('idle', {
    tabId: keepOverlay ? targetTabId : null,
    startedAt: null,
    tabUrl: keepOverlay ? session.tabUrl : '',
    lastSpeechActivityAt: null,
    lastError: null
  });
  return session;
}

async function maybePersistTranscript(payload) {
  updateTranscriptRecording(payload);
}

function handleOffscreenStatus(payload) {
  const status = normalizeStatus(payload?.status);
  if (!payload?.status) return;
  if (status === 'idle' && session.status !== 'stopping') return;
  setStatus(status, {
    tabId: payload.tabId ?? session.tabId,
    tabUrl: session.tabUrl,
    startedAt: session.startedAt,
    lastSpeechActivityAt: session.lastSpeechActivityAt,
    lastError: payload.lastError ?? null
  });
}

function getMessagePayload(message) {
  return message && typeof message === 'object' ? message.payload ?? {} : {};
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case MESSAGE.GET_SETTINGS: {
        sendResponse({ ok: true, settings: await getSettings() });
        break;
      }
      case MESSAGE.UPDATE_SETTINGS: {
        const settings = await updateSettings(message.patch ?? {});
        chrome.runtime.sendMessage({ type: MESSAGE.SETTINGS_UPDATED, payload: settings }).catch(() => undefined);
        await sendToOffscreen({ type: MESSAGE.SETTINGS_UPDATED, payload: settings }).catch(() => undefined);
        if (session.tabId) {
          chrome.tabs.sendMessage(session.tabId, { type: MESSAGE.SETTINGS_UPDATED, payload: settings }).catch(() => undefined);
        }
        sendResponse({ ok: true, settings });
        break;
      }
      case MESSAGE.GET_STATUS: {
        sendResponse({ ok: true, session });
        break;
      }
      case MESSAGE.START_SESSION: {
        const payload = { ...getMessagePayload(message) };
        if (!payload.tabId && sender?.tab?.id) payload.tabId = sender.tab.id;
        if (!startInFlight) {
          startInFlight = startSession(payload).finally(() => {
            startInFlight = null;
          });
        }
        sendResponse({ ok: true, session: await startInFlight });
        break;
      }
      case MESSAGE.STOP_SESSION: {
        sendResponse({ ok: true, session: await stopSession(getMessagePayload(message)) });
        break;
      }
      case MESSAGE.SESSION_STATUS: {
        if (message.payload?.source === 'offscreen' || sender?.url?.includes(OFFSCREEN_URL)) {
          handleOffscreenStatus(message.payload);
        }
        sendResponse({ ok: true });
        break;
      }
      case MESSAGE.SUBTITLE_UPDATE: {
        if (session.tabId) {
          chrome.tabs.sendMessage(session.tabId, message).catch(() => undefined);
        }
        markSpeechActivity('subtitle-update', {
          hasSource: Boolean(message.payload?.source?.text),
          hasTranslation: Boolean(message.payload?.translation?.text)
        });
        maybePersistTranscript(message.payload).catch(() => undefined);
        checkSpeechInactivity().catch((error) => debug('speech.inactivity.checkFailed', { message: error?.message || String(error) }));
        sendResponse({ ok: true });
        break;
      }
      case MESSAGE.AUDIO_LEVEL_UPDATE: {
        chrome.runtime.sendMessage(message).catch(() => undefined);
        checkSpeechInactivity().catch((error) => debug('speech.inactivity.checkFailed', { message: error?.message || String(error) }));
        sendResponse({ ok: true });
        break;
      }
      case MESSAGE.SESSION_ERROR: {
        const settings = await getSettings().catch(() => null);
        const err = message.error || message.payload || { message: localized(settings, 'unknownSessionError') };
        await appendDebugLog({ area: message.area || 'runtime', event: 'session.error', data: err, tabId: sender?.tab?.id });
        if (err?.code === 'TAB_AUDIO_CAPTURE_ENDED' && session.tabId && isRunningStatus()) {
          const tab = await chrome.tabs.get(session.tabId).catch(() => null);
          if (tab?.id) {
            scheduleNavigationRestart(session.tabId, tab.url || session.tabUrl || '', 'capture-ended');
            sendResponse({ ok: true, recovered: true });
            break;
          }
        }
        await finalizeTranscriptRecording('error').catch((error) => debug('transcript.recording.saveFailed', { message: error?.message || String(error) }));
        setStatus('error', { lastError: err });
        sendResponse({ ok: true });
        break;
      }
      case MESSAGE.DEBUG_LOG: {
        await appendDebugLog({ ...(message.payload || {}), tabId: message.payload?.tabId ?? sender?.tab?.id });
        sendResponse({ ok: true });
        break;
      }
      case MESSAGE.GET_DEBUG_LOGS: {
        sendResponse({ ok: true, logs: await getDebugLogs() });
        break;
      }
      case MESSAGE.CLEAR_DEBUG_LOGS: {
        await clearDebugLogs();
        sendResponse({ ok: true });
        break;
      }
      default: {
        const settings = await getSettings().catch(() => null);
        sendResponse({ ok: false, error: localized(settings, 'unknownMessageType') });
      }
    }
  })().catch((error) => {
    const gemiveError = toGemiveError(error);
    appendDebugLog({ area: 'background', event: 'handler.error', data: gemiveError, tabId: sender?.tab?.id }).catch(() => undefined);
    finalizeTranscriptRecording('error').catch((saveError) => debug('transcript.recording.saveFailed', { message: saveError?.message || String(saveError) }));
    setStatus('error', { lastError: gemiveError });
    sendResponse({ ok: false, error: gemiveError.message, detail: gemiveError });
  });
  return true;
});

chrome.tabCapture.onStatusChanged.addListener((info) => {
  if (!info || info.tabId !== session.tabId) return;
  if (info.status === 'error') {
    setStatus('error', {
      lastError: {
        code: 'TAB_CAPTURE_ERROR',
        message: 'Chrome tabCapture reported an error for this tab.',
        at: Date.now()
      }
    });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tabId || tabId !== session.tabId || !isRunningStatus()) return;
  if (changeInfo.url && changeInfo.url !== session.tabUrl) {
    debug('tab.url.changed', { tabId, from: session.tabUrl, to: changeInfo.url, active: tab?.active });
    scheduleNavigationRestart(tabId, changeInfo.url, 'url-change');
    return;
  }
  if (changeInfo.status === 'complete' && pendingNavigationRestart?.tabId === tabId) {
    debug('tab.navigation.complete', { tabId, url: tab?.url || pendingNavigationRestart.url });
    scheduleNavigationRestart(tabId, tab?.url || pendingNavigationRestart.url, 'navigation-complete');
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  if (!pendingNavigationRestart || activeInfo.tabId !== session.tabId) return;
  debug('tab.activated.pending-restart', { tabId: activeInfo.tabId, url: pendingNavigationRestart.url });
  scheduleNavigationRestart(activeInfo.tabId, pendingNavigationRestart.url, 'tab-activated');
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== session.tabId) return;
  stopSession({ keepOverlay: false, reason: 'tab-removed' }).catch((error) => debug('tab.removed.stopFailed', { message: error?.message || String(error) }));
});