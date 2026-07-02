import { MESSAGE } from '../core/message-types.js';
import { AudioRouter } from './audio-router.js';

const router = new AudioRouter();

function debug(event, data = {}) {
  chrome.runtime.sendMessage({
    type: MESSAGE.DEBUG_LOG,
    payload: { area: 'offscreen', event, data }
  }).catch(() => undefined);
  console.debug('[Gemive offscreen]', event, data);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Offscreen receives many broadcast runtime messages. Only target:'offscreen'
  // belongs here. Everything else must be ignored so it cannot race the
  // background listener and return 'Unknown offscreen message' to the caller.
  if (message?.target !== 'offscreen') return false;
  debug('message.received', { type: message?.type });

  (async () => {
    switch (message?.type) {
      case MESSAGE.START_OFFSCREEN_SESSION:
        debug('session.start');
        await router.start(message.payload);
        sendResponse({ ok: true });
        break;
      case MESSAGE.STOP_OFFSCREEN_SESSION:
        debug('session.stop');
        await router.stop({ requestedByUser: true });
        sendResponse({ ok: true });
        break;
      case MESSAGE.SETTINGS_UPDATED:
        debug('settings.updated');
        router.updateSettings(message.payload);
        sendResponse({ ok: true });
        break;
      default:
        debug('message.unknown', { type: message?.type });
        sendResponse({ ok: false, error: `Unknown offscreen message: ${message?.type || 'missing type'}` });
    }
  })().catch((error) => {
    debug('handler.error', { message: error?.message || String(error), stack: error?.stack || '' });
    chrome.runtime.sendMessage({
      type: MESSAGE.SESSION_ERROR,
      error: { code: 'OFFSCREEN_ERROR', message: error?.message || String(error), at: Date.now() }
    }).catch(() => undefined);
    sendResponse({ ok: false, error: error?.message || String(error) });
  });
  return true;
});
