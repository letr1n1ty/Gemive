(() => {
  if (window.__gemiveAutoShowOverlayInstalled) return;
  window.__gemiveAutoShowOverlayInstalled = true;

  const MESSAGE = {
    GET_SETTINGS: 'GET_SETTINGS',
    SETTINGS_UPDATED: 'SETTINGS_UPDATED'
  };

  let autoShowAttemptedForUrl = '';

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

    const key = `${location.href}|${reason}`;
    if (autoShowAttemptedForUrl === key) return;

    if (typeof window.__gemiveOverlayShow === 'function') {
      autoShowAttemptedForUrl = key;
      window.__gemiveOverlayShow({ settings, collapse: false, source: 'auto-show-domain' });
      return;
    }

    if (attemptsLeft <= 0) return;
    setTimeout(() => showOverlayWhenReady(settings, reason, attemptsLeft - 1), 100);
  }

  async function evaluateAutoShow(reason = 'load', providedSettings = null) {
    try {
      const settings = providedSettings || (await chrome.runtime.sendMessage({ type: MESSAGE.GET_SETTINGS }))?.settings;
      showOverlayWhenReady(settings, reason);
    } catch {
      // Restricted or unloading pages can reject extension messages. Ignore silently.
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === MESSAGE.SETTINGS_UPDATED) {
      autoShowAttemptedForUrl = '';
      evaluateAutoShow('settings-updated', message.payload);
    }
  });

  evaluateAutoShow('load');
})();
