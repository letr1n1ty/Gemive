(() => {
  if (window.__gemiveOverlaySizePatchInstalled) return;
  window.__gemiveOverlaySizePatchInstalled = true;

  const FALLBACK_MIN_WIDTH = 160;
  const FALLBACK_MIN_HEIGHT = 90;
  const VIEWPORT_MARGIN = 8;
  const STORAGE_KEY = 'gemive.overlay.position';
  const MESSAGE = {
    GET_SETTINGS: 'GET_SETTINGS',
    SETTINGS_UPDATED: 'SETTINGS_UPDATED'
  };

  let settings = {
    window: {
      width: FALLBACK_MIN_WIDTH,
      height: FALLBACK_MIN_HEIGHT
    }
  };

  function coerceMinimum(value, fallback) {
    const next = Math.round(Number(value));
    return Number.isFinite(next) && next > 0 ? next : fallback;
  }

  function minWidth() {
    return coerceMinimum(settings?.window?.width, FALLBACK_MIN_WIDTH);
  }

  function minHeight() {
    return coerceMinimum(settings?.window?.height, FALLBACK_MIN_HEIGHT);
  }

  function readStoredRect() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!stored || typeof stored !== 'object') return null;
      return stored;
    } catch {
      return null;
    }
  }

  function writeStoredRect(host) {
    const rect = host.getBoundingClientRect();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        x: rect.left,
        y: rect.top,
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }));
    } catch {}
  }

  function keepInsideViewport(host) {
    if (!host || host.style.display === 'none') return;
    const rect = host.getBoundingClientRect();
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN);
    if (rect.left < VIEWPORT_MARGIN || rect.top < VIEWPORT_MARGIN || rect.left > maxLeft || rect.top > maxTop) {
      host.style.left = `${Math.min(Math.max(rect.left, VIEWPORT_MARGIN), maxLeft)}px`;
      host.style.top = `${Math.min(Math.max(rect.top, VIEWPORT_MARGIN), maxTop)}px`;
      host.style.right = 'auto';
      host.style.bottom = 'auto';
    }
  }

  function applyMinimumStyle(shadow) {
    let style = shadow.querySelector('#gemive-compact-resize-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'gemive-compact-resize-style';
      shadow.appendChild(style);
    }
    style.textContent = `
      .card {
        min-width: ${minWidth()}px !important;
        min-height: ${minHeight()}px !important;
      }
      .body {
        padding: 8px 10px 10px !important;
      }
    `;
  }

  function applySizePolicy(host, { preferStored = true } = {}) {
    if (!host?.shadowRoot || host.dataset.gemiveCollapsed === 'true') return;
    applyMinimumStyle(host.shadowRoot);

    const rect = host.getBoundingClientRect();
    const stored = preferStored ? readStoredRect() : null;
    const maxWidth = Math.max(minWidth(), window.innerWidth - VIEWPORT_MARGIN * 2);
    const maxHeight = Math.max(minHeight(), window.innerHeight - VIEWPORT_MARGIN * 2);
    const baseWidth = Number.isFinite(stored?.width) ? stored.width : rect.width;
    const baseHeight = Number.isFinite(stored?.height) ? stored.height : rect.height;
    const nextWidth = Math.max(minWidth(), Math.min(maxWidth, baseWidth || minWidth()));
    const nextHeight = Math.max(minHeight(), Math.min(maxHeight, baseHeight || minHeight()));

    if (Math.round(rect.width) !== Math.round(nextWidth)) host.style.width = `${nextWidth}px`;
    if (Math.round(rect.height) !== Math.round(nextHeight)) host.style.height = `${nextHeight}px`;
    keepInsideViewport(host);
  }

  function installCompactResize(host) {
    if (!host?.shadowRoot) return;
    const shadow = host.shadowRoot;
    applySizePolicy(host);

    const resize = shadow.querySelector('.resize');
    if (!resize || resize.dataset.gemiveCompactResizePatched === 'true') return;
    resize.dataset.gemiveCompactResizePatched = 'true';

    resize.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const startRect = host.getBoundingClientRect();
      const resizeState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        width: startRect.width,
        height: startRect.height
      };

      const onPointerMove = (moveEvent) => {
        moveEvent.preventDefault();
        const maxWidth = Math.max(minWidth(), window.innerWidth - VIEWPORT_MARGIN * 2);
        const maxHeight = Math.max(minHeight(), window.innerHeight - VIEWPORT_MARGIN * 2);
        const nextWidth = Math.max(minWidth(), Math.min(maxWidth, resizeState.width + moveEvent.clientX - resizeState.startX));
        const nextHeight = Math.max(minHeight(), Math.min(maxHeight, resizeState.height + moveEvent.clientY - resizeState.startY));
        host.style.width = `${nextWidth}px`;
        host.style.height = `${nextHeight}px`;
        keepInsideViewport(host);
      };

      const cleanup = () => {
        resize.removeEventListener('pointermove', onPointerMove);
        writeStoredRect(host);
        try { resize.releasePointerCapture(resizeState.pointerId); } catch {}
      };

      try { resize.setPointerCapture(event.pointerId); } catch {}
      resize.addEventListener('pointermove', onPointerMove);
      resize.addEventListener('pointerup', cleanup, { once: true });
      resize.addEventListener('pointercancel', cleanup, { once: true });
    }, true);
  }

  function scan() {
    const host = document.getElementById('gemive-overlay-host');
    if (host) installCompactResize(host);
  }

  async function hydrateSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ type: MESSAGE.GET_SETTINGS });
      if (response?.settings) settings = response.settings;
    } catch {}
    scan();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== MESSAGE.SETTINGS_UPDATED) return false;
    settings = message.payload || settings;
    setTimeout(() => {
      const host = document.getElementById('gemive-overlay-host');
      if (host) applySizePolicy(host);
    }, 0);
    return false;
  });

  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', scan);
  hydrateSettings();
})();
