(() => {
  if (window.__gemiveAutoShowOverlayInstalled) return;
  window.__gemiveAutoShowOverlayInstalled = true;

  const MESSAGE = {
    GET_SETTINGS: 'GET_SETTINGS'
  };
  const SETTINGS_KEY = 'gemive.settings';

  let autoShowAttemptedForUrl = '';
  let lastHref = location.href;
  let cachedSettings = null;

  function normalizeDomain(value) {
    return String(value || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/^\*\./, '')
      .replace(/\/.*$/, '')
      .replace(/:\d+$/, '')
      .toLowerCase();
  }

  function parseDomains(value) {
    const rawItems = Array.isArray(value)
      ? value
      : String(value || '').split(/[\n,]+/);

    return [...new Set(rawItems
      .map(normalizeDomain)
      .filter(Boolean)
      .filter((domain) => domain !== '*' && domain !== '.'))];
  }

  function matchesDomain(hostname, domain) {
    const host = normalizeDomain(hostname);
    const normalized = normalizeDomain(domain);
    if (!host || !normalized) return false;
    return host === normalized || host.endsWith(`.${normalized}`);
  }

  function shouldAutoShow(settings) {
    if (!settings?.automation?.autoShowOverlay) return false;
    const domains = parseDomains(settings.automation.autoShowDomains);
    if (!domains.length) return false;
    return domains.some((domain) => matchesDomain(location.hostname, domain));
  }

  function showOverlayWhenReady(settings, reason, attemptsLeft = 20) {
    if (!shouldAutoShow(settings)) return;

    const key = location.href;
    if (autoShowAttemptedForUrl === key) return;

    if (typeof window.__gemiveOverlayShow === 'function') {
      const overlayState = typeof window.__gemiveOverlayGetState === 'function'
        ? window.__gemiveOverlayGetState()
        : null;
      if (overlayState?.visible) {
        autoShowAttemptedForUrl = key;
        return;
      }
      autoShowAttemptedForUrl = key;
      window.__gemiveOverlayShow({ settings, source: `auto-show-domain:${reason}` });
      return;
    }

    if (attemptsLeft <= 0) return;
    setTimeout(() => showOverlayWhenReady(settings, reason, attemptsLeft - 1), 100);
  }

  async function loadSettings() {
    const response = await chrome.runtime.sendMessage({ type: MESSAGE.GET_SETTINGS });
    cachedSettings = response?.settings || null;
    return cachedSettings;
  }

  async function evaluateAutoShow(reason = 'load', providedSettings = null) {
    try {
      const settings = providedSettings || cachedSettings || await loadSettings();
      showOverlayWhenReady(settings, reason);
    } catch {
      // Restricted or unloading pages can reject extension messages. Ignore silently.
    }
  }

  if (chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[SETTINGS_KEY]?.newValue) return;
      cachedSettings = changes[SETTINGS_KEY].newValue;
      autoShowAttemptedForUrl = '';
      evaluateAutoShow('settings-changed', cachedSettings);
    });
  }

  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    autoShowAttemptedForUrl = '';
    evaluateAutoShow('url-changed');
  }, 1000);

  evaluateAutoShow('load');
})();
