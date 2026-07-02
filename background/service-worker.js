import { MESSAGE } from '../core/message-types.js';
import { getSettings, updateSettings } from '../storage/settings-store.js';
import {
  appendTranscript,
  recoverInterruptedTranscripts,
  removeTranscriptCheckpoint,
  saveTranscriptCheckpoint
} from '../storage/transcript-store.js';
import { toGemiveError } from '../core/error-types.js';
import { resolveLocale, t } from '../core/i18n.js';

const OFFSCREEN_URL = 'offscreen/offscreen.html';

let session = {
  status: 'idle',
  tabId: null,
  startedAt: null,
  tabUrl: '',
  lastSpeechActivityAt: null,
  lastError: null
};

let activeTranscriptSession = null;
let lastTranscriptSnapshotSignature = '';
let transcriptCheckpointTimer = null;
let transcriptCheckpointInFlight = null;
let startInFlight = null;
let navigationRestartInFlight = null;
let navigationRestartTimer = null;
let pendingNavigationRestart = null;
let lastSpeechActivityAt = 0;
let lastInactivityCheckAt = 0;

const SPEECH_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
const INACTIVITY_CHECK_THROTTLE_MS = 30 * 1000;
const TRANSCRIPT_CHECKPOINT_DEBOUNCE_MS = 1000;

const DEBUG_LOG_KEY = 'gemive.debug.logs';
const DEBUG_LOG_LIMIT = 500;

function sanitizeDebugValue(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.replace(/key=AIza[0-9A-Za-z_\-]+/g, 'key=[REDACTED]').replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[REDACTED_API_KEY]');
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) return { name: value.name, message: sanitizeDebugValue(value.message), stack: sanitizeDebugValue(value.stack || '') };
  if (Array.isArray(value)) return value.map(sanitizeDebugValue).slice(0, 20);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      if (/apiKey|authorization|token|password/i.test(key)) out[key] = '[REDACTED]';
      else out[key] = sanitizeDebugValue(item);
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

function relayStatus() {
  chrome.runtime.sendMessage({ type: MESSAGE.SESSION_STATUS, payload: session }).catch(() => undefined);
  if (session.tabId) {
    chrome.tabs.sendMessage(session.tabId, { type: MESSAGE.SESSION_STATUS, payload: session }).catch(() => undefined);
  }
}

function setStatus(status, extra = {}) {
  session = { ...session, status, ...extra };
  debug('session.status', { status, extra });
  relayStatus();
}

function isRunningStatus(status = session.status) {
  return ['starting', 'capturing', 'connecting', 'translating'].includes(status);
}

function markSpeechActivity(reason = 'speech', extra = {}) {
  if (!isRunningStatus()) return;
  lastSpeechActivityAt = Date.now();
  session = { ...session, lastSpeechActivityAt };
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
    await delay(120);
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

  // First ask our offscreen audio router to stop cleanly.
  await sendToOffscreen({ type: MESSAGE.STOP_OFFSCREEN_SESSION }).catch(() => undefined);
  if (await waitForCaptureRelease(tabId, 1800)) return;

  // If a previous Gemive offscreen page crashed or survived a reload, close it.
  // Closing the offscreen document releases MediaStream tracks owned by this extension.
  await closeOffscreenDocumentIfPresent();
  if (await waitForCaptureRelease(tabId, 2600)) {
    await ensureOffscreenDocument();
    debug('offscreen.ready');
    return;
  }

  throw new Error(
    localized(await getSettings().catch(() => null), 'activeCaptureStream')
  );
}

async function flushTranscriptCheckpoint(reason = 'checkpoint') {
  clearTimeout(transcriptCheckpointTimer);
  transcriptCheckpointTimer = null;

  if (transcriptCheckpointInFlight) {
    await transcriptCheckpointInFlight.catch(() => undefined);
  }

  const current = activeTranscriptSession;
  if (!current) return;

  const checkpoint = {
    ...current,
    status: current.status || 'active',
    checkpointReason: reason,
    updatedAt: current.updatedAt || Date.now()
  };

  transcriptCheckpointInFlight = saveTranscriptCheckpoint(checkpoint)
    .then(() => {
      debug('transcript.recording.checkpoint.saved', {
        reason,
        id: checkpoint.id,
        hasSource: Boolean(checkpoint.sourceText),
        hasTranslation: Boolean(checkpoint.translationText)
      });
    })
    .finally(() => {
      transcriptCheckpointInFlight = null;
    });

  await transcriptCheckpointInFlight;
}

function scheduleTranscriptCheckpoint(reason = 'subtitle-update') {
  if (!activeTranscriptSession) return;
  clearTimeout(transcriptCheckpointTimer);
  transcriptCheckpointTimer = setTimeout(() => {
    flushTranscriptCheckpoint(reason).catch((error) => {
      debug('transcript.recording.checkpointFailed', { message: error?.message || String(error), reason });
    });
  }, TRANSCRIPT_CHECKPOINT_DEBOUNCE_MS);
}

async function startTranscriptRecording(settings, tab) {
  if (!settings?.privacy?.saveTranscript) {
    clearTimeout(transcriptCheckpointTimer);
    transcriptCheckpointTimer = null;
    activeTranscriptSession = null;
    lastTranscriptSnapshotSignature = '';
    return;
  }
  const startedAt = Date.now();
  activeTranscriptSession = {
    id: crypto.randomUUID(),
    type: 'session',
    status: 'active',
    startedAt,
    createdAt: startedAt,
    updatedAt: startedAt,
    endedAt: null,
    tabId: tab?.id ?? null,
    tabTitle: tab?.title || '',
    tabUrl: tab?.url || '',
    urlHistory: tab?.url ? [{ url: tab.url, at: startedAt }] : [],
    sourceText: '',
    translationText: '',
    sourceLanguageCode: '',
    targetLanguageCode: settings.language?.targetLanguageCode || '',
    updates: [],
    stopReason: ''
  };
  lastTranscriptSnapshotSignature = '';
  await flushTranscriptCheckpoint('start');
  debug('transcript.recording.started', { tabId: tab?.id, saveTranscript: true });
}

function normalizeTranscriptText(value) {
  return String(value || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function updateTranscriptRecording(payload) {
  if (!activeTranscriptSession) return false;
  const translationText = normalizeTranscriptText(payload?.translation?.text);
  const sourceText = normalizeTranscriptText(payload?.source?.text);
  if (!translationText && !sourceText) return false;

  const signature = `${sourceText}\n---\n${translationText}`;
  if (signature === lastTranscriptSnapshotSignature) return false;
  lastTranscriptSnapshotSignature = signature;

  const updatedAt = Date.now();
  activeTranscriptSession.translationText = translationText || activeTranscriptSession.translationText;
  activeTranscriptSession.sourceText = sourceText || activeTranscriptSession.sourceText;
  activeTranscriptSession.sourceLanguageCode = payload?.source?.languageCode || activeTranscriptSession.sourceLanguageCode || '';
  activeTranscriptSession.targetLanguageCode = payload?.translation?.languageCode || activeTranscriptSession.targetLanguageCode || '';
  activeTranscriptSession.updatedAt = updatedAt;
  activeTranscriptSession.updates.push({
    at: updatedAt,
    translationText,
    sourceText
  });
  if (activeTranscriptSession.updates.length > 120) activeTranscriptSession.updates.shift();
  scheduleTranscriptCheckpoint('subtitle-update');
  return true;
}

async function finalizeTranscriptRecording(reason = 'stop') {
  clearTimeout(transcriptCheckpointTimer);
  transcriptCheckpointTimer = null;

  const current = activeTranscriptSession;
  activeTranscriptSession = null;
  lastTranscriptSnapshotSignature = '';
  if (!current) return;

  current.endedAt = Date.now();
  current.stopReason = reason;
  current.durationMs = Math.max(0, current.endedAt - current.startedAt);
  current.updatedAt = current.endedAt;
  current.status = reason === 'stop' ? 'finished' : 'interrupted';

  await saveTranscriptCheckpoint(current).catch((error) => {
    debug('transcript.recording.finalCheckpointFailed', { message: error?.message || String(error), reason });
  });
  await appendTranscript(current);
  await removeTranscriptCheckpoint(current.id).catch((error) => {
    debug('transcript.recording.checkpointCleanupFailed', { message: error?.message || String(error), id: current.id });
  });
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
  activeTranscriptSession.updatedAt = Date.now();
  const history = Array.isArray(activeTranscriptSession.urlHistory) ? activeTranscriptSession.urlHistory : [];
  if (!history.length || history[history.length - 1]?.url !== url) {
    history.push({ url, at: Date.now() });
    activeTranscriptSession.urlHistory = history.slice(-20);
  }
}

async function restartSessionAfterNavigation({ tabId, url, reason = 'url-change' } = {}) {
  if (!tabId || tabId !== session.tabId || !isRunningStatus()) return session;
  const settings = await getSettings();
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.id) {
    await stopSession({ keepOverlay: true, reason: 'tab-closed' });
    return session;
  }

  const nextUrl = tab.url || url || session.tabUrl || '';
  noteTranscriptUrlChange(nextUrl);
  await flushTranscriptCheckpoint(tab.active ? 'navigation-before-restart' : 'navigation-deferred');

  if (!tab.active) {
    pendingNavigationRestart = { tabId, url: nextUrl, reason, at: Date.now() };
    debug('navigation.restart.deferred.inactive-tab', pendingNavigationRestart);
    return session;
  }

  pendingNavigationRestart = null;
  debug('navigation.restart.begin', { tabId, url: nextUrl, reason });
  setStatus('starting', {
    tabId,
    tabUrl: nextUrl,
    startedAt: session.startedAt || Date.now(),
    lastError: null
  });

  await ensureOverlay(tabId);
  await chrome.tabs.sendMessage(tabId, { type: MESSAGE.OVERLAY_SHOW, payload: { settings } }).catch(() => undefined);
  await ensureOffscreenDocument();
  await sendToOffscreen({ type: MESSAGE.STOP_OFFSCREEN_SESSION }).catch(() => undefined);
  await waitForCaptureRelease(tabId, 2600).catch(() => undefined);
  await releaseExistingCaptureIfOwned(tabId);

  const streamId = await acquireStreamId(tabId);
  debug('navigation.streamId.acquired', { tabId, hasStreamId: Boolean(streamId) });
  setStatus('capturing', { tabId, tabUrl: nextUrl, startedAt: session.startedAt || Date.now(), lastError: null });
  await sendToOffscreen({
    type: MESSAGE.START_OFFSCREEN_SESSION,
    payload: { streamId, tabId, settings }
  });
  markSpeechActivity('navigation-restarted', { tabId });
  setStatus('translating', { tabId, tabUrl: nextUrl, startedAt: session.startedAt || Date.now(), lastError: null });
  debug('navigation.restart.complete', { tabId, url: nextUrl });
  return session;
}

function scheduleNavigationRestart(tabId, url, reason = 'url-change') {
  if (!tabId || tabId !== session.tabId || !isRunningStatus()) return;
  const nextUrl = url || session.tabUrl || '';
  if (nextUrl) session = { ...session, tabUrl: nextUrl };
  pendingNavigationRestart = { tabId, url: nextUrl, reason, at: Date.now() };
  clearTimeout(navigationRestartTimer);
  navigationRestartTimer = setTimeout(() => {
    if (!navigationRestartInFlight) {
      navigationRestartInFlight = restartSessionAfterNavigation(pendingNavigationRestart)
        .catch(async (error) => {
          const gemiveError = toGemiveError(error);
          await finalizeTranscriptRecording('navigation-restart-error').catch((saveError) => debug('transcript.recording.saveFailed', { message: saveError?.message || String(saveError) }));
          setStatus('error', { lastError: gemiveError });
        })
        .finally(() => {
          navigationRestartInFlight = null;
        });
    }
  }, 800);
  debug('navigation.restart.scheduled', pendingNavigationRestart);
}

async function startSession(request = {}) {
  debug('start.request', { request });
  const settings = await getSettings();
  if (!parseApiKeys(settings.api?.apiKey).length) {
    throw new Error(localized(settings, 'apiKeyMissing'));
  }

  const tab = request.tabId ? await chrome.tabs.get(request.tabId) : await getActiveTab();
  if (!tab?.id) throw new Error(localized(settings, 'noTargetTab'));

  if (session.status !== 'idle' && session.status !== 'error') {
    await stopSession();
  }

  await recoverInterruptedTranscripts('new-session-started').catch((error) => {
    debug('transcript.recording.recoveryFailed', { message: error?.message || String(error) });
  });
  await startTranscriptRecording(settings, tab);
  lastSpeechActivityAt = Date.now();
  lastInactivityCheckAt = 0;
  setStatus('starting', { tabId: tab.id, startedAt: Date.now(), tabUrl: tab.url || '', lastSpeechActivityAt, lastError: null });
  debug('start.targetTab', { tabId: tab.id, title: tab.title, url: tab.url });
  await ensureOverlay(tab.id);
  await chrome.tabs.sendMessage(tab.id, { type: MESSAGE.OVERLAY_SHOW, payload: { settings } });
  await ensureOffscreenDocument();
  debug('offscreen.ready');
  await releaseExistingCaptureIfOwned(tab.id);

  const streamId = await acquireStreamId(tab.id);
  debug('tabCapture.streamId.acquired', { tabId: tab.id, hasStreamId: Boolean(streamId) });
  setStatus('capturing', { tabId: tab.id, tabUrl: tab.url || '', startedAt: Date.now(), lastSpeechActivityAt, lastError: null });

  await sendToOffscreen({
    type: MESSAGE.START_OFFSCREEN_SESSION,
    payload: {
      streamId,
      tabId: tab.id,
      settings
    }
  });

  markSpeechActivity('session-started', { tabId: tab.id });
  setStatus('translating', { tabId: tab.id, tabUrl: tab.url || '', startedAt: session.startedAt || Date.now(), lastSpeechActivityAt, lastError: null });
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
  setStatus('idle', { tabId: keepOverlay ? targetTabId : null, startedAt: null, lastSpeechActivityAt: null, lastError: null });
  return session;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function maybePersistTranscript(payload) {
  updateTranscriptRecording(payload);
}

function handleOffscreenStatus(payload) {
  const status = payload?.status;
  if (!status) return;
  if (status === 'idle' && session.status !== 'stopping') return;
  setStatus(status, {
    tabId: payload.tabId ?? session.tabId,
    tabUrl: session.tabUrl,
    startedAt: session.startedAt,
    lastSpeechActivityAt: session.lastSpeechActivityAt,
    lastError: payload.lastError ?? null
  });
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
        const payload = { ...(message.payload ?? {}) };
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
        sendResponse({ ok: true, session: await stopSession(message.payload ?? {}) });
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
      default:
        {
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
    finalizeTranscriptRecording('tab-capture-error').catch((error) => debug('transcript.recording.saveFailed', { message: error?.message || String(error) }));
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
