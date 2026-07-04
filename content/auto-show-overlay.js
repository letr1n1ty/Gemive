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

  function parseRules(value) {
    const rawItems = Array.isArray(value)
      ? value
      : String(value || '').split(/[\n,]+/);

    return [...new Set(rawItems
      .map(normalizeAutoShowRule)
      .filter(Boolean)
      .filter((rule) => rule !== '*' && rule !== '.'))];
  }

  function matchesDomain(hostname, domain) {
    const host = normalizeDomain(hostname);
    const normalized = normalizeDomain(domain);
    if (!host || !normalized) return false;
    return host === normalized || host.endsWith(`.${normalized}`);
  }

  function currentUrlWithoutHash() {
    try {
      const url = new URL(location.href);
      url.hash = '';
      return `${url.origin}${url.pathname}${url.search}`;
    } catch {
      return location.href.split('#')[0];
    }
  }

  function matchesRule(rule) {
    if (/^https?:\/\//i.test(rule)) return currentUrlWithoutHash() === rule;
    return matchesDomain(location.hostname, rule);
  }

  function shouldAutoShow(settings) {
    if (!settings?.automation?.autoShowOverlay) return false;
    const rules = parseRules(settings.automation.autoShowDomains);
    if (!rules.length) return false;
    return rules.some(matchesRule);
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
