(() => {
  if (window.__gemiveOverlaySizePatchInstalled) return;
  window.__gemiveOverlaySizePatchInstalled = true;

  const FALLBACK_MIN_WIDTH = 160;
  const FALLBACK_MIN_HEIGHT = 90;
  const DEFAULT_EXPANDED_WIDTH = 460;
  const DEFAULT_EXPANDED_HEIGHT = 260;
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
  let storedRect = readStoredRect();
  let desiredRect = storedRect ? { ...storedRect } : null;
  let resizeState = null;
  let suppressHostObserver = false;
  let hostApplyFrame = null;

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
    storedRect = {
      x: rect.left,
      y: rect.top,
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
    desiredRect = { ...storedRect };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(storedRect));
    } catch {}
  }

  function clampWidth(value) {
    const maxWidth = Math.max(minWidth(), window.innerWidth - VIEWPORT_MARGIN * 2);
    return Math.max(minWidth(), Math.min(maxWidth, value));
  }

  function clampHeight(value) {
    const maxHeight = Math.max(minHeight(), window.innerHeight - VIEWPORT_MARGIN * 2);
    return Math.max(minHeight(), Math.min(maxHeight, value));
  }

  function keepInsideViewport(host) {
    if (!host || host.style.display === 'none') return;
    const rect = host.getBoundingClientRect();
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN);
    if (rect.left < VIEWPORT_MARGIN || rect.top < VIEWPORT_MARGIN || rect.left > maxLeft || rect.top > maxTop) {
      suppressHostObserver = true;
      host.style.left = `${Math.min(Math.max(rect.left, VIEWPORT_MARGIN), maxLeft)}px`;
      host.style.top = `${Math.min(Math.max(rect.top, VIEWPORT_MARGIN), maxTop)}px`;
      host.style.right = 'auto';
      host.style.bottom = 'auto';
      queueMicrotask(() => { suppressHostObserver = false; });
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

  function setHostSize(host, width, height) {
    suppressHostObserver = true;
    host.style.width = `${Math.round(width)}px`;
    host.style.height = `${Math.round(height)}px`;
    queueMicrotask(() => { suppressHostObserver = false; });
  }

  function resolveDesiredSize(host, { preferStored = true } = {}) {
    const rect = host.getBoundingClientRect();
    const source = resizeState?.desiredRect || (preferStored ? desiredRect : null);
    const width = Number.isFinite(source?.width)
      ? source.width
      : Math.max(DEFAULT_EXPANDED_WIDTH, minWidth(), rect.width || 0);
    const height = Number.isFinite(source?.height)
      ? source.height
      : Math.max(DEFAULT_EXPANDED_HEIGHT, minHeight(), rect.height || 0);
    return {
      width: clampWidth(width),
      height: clampHeight(height)
    };
  }

  function applySizePolicy(host, options = {}) {
    if (!host?.shadowRoot || host.dataset.gemiveCollapsed === 'true') return;
    applyMinimumStyle(host.shadowRoot);

    const rect = host.getBoundingClientRect();
    const desired = resolveDesiredSize(host, options);
    if (Math.round(rect.width) !== Math.round(desired.width) || Math.round(rect.height) !== Math.round(desired.height)) {
      setHostSize(host, desired.width, desired.height);
    }
    keepInsideViewport(host);
  }

  function scheduleApplySizePolicy(host, options = {}) {
    if (hostApplyFrame) cancelAnimationFrame(hostApplyFrame);
    hostApplyFrame = requestAnimationFrame(() => {
      hostApplyFrame = null;
      applySizePolicy(host, options);
    });
  }

  function observeHostSize(host) {
    if (host.dataset.gemiveSizeObserverInstalled === 'true') return;
    host.dataset.gemiveSizeObserverInstalled = 'true';
    const observer = new MutationObserver(() => {
      if (suppressHostObserver || resizeState) return;
      scheduleApplySizePolicy(host);
    });
    observer.observe(host, {
      attributes: true,
      attributeFilter: ['style', 'data-gemive-collapsed']
    });
  }

  function installCompactResize(host) {
    if (!host?.shadowRoot) return;
    const shadow = host.shadowRoot;
    observeHostSize(host);
    applySizePolicy(host);

    const resize = shadow.querySelector('.resize');
    if (!resize || resize.dataset.gemiveCompactResizePatched === 'true') return;
    resize.dataset.gemiveCompactResizePatched = 'true';

    resize.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const startRect = host.getBoundingClientRect();
      resizeState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        width: startRect.width,
        height: startRect.height,
        desiredRect: {
          width: startRect.width,
          height: startRect.height
        }
      };

      const onPointerMove = (moveEvent) => {
        if (!resizeState) return;
        moveEvent.preventDefault();
        const nextWidth = clampWidth(resizeState.width + moveEvent.clientX - resizeState.startX);
        const nextHeight = clampHeight(resizeState.height + moveEvent.clientY - resizeState.startY);
        resizeState.desiredRect = { width: nextWidth, height: nextHeight };
        desiredRect = {
          ...(desiredRect || {}),
          width: nextWidth,
          height: nextHeight
        };
        setHostSize(host, nextWidth, nextHeight);
        keepInsideViewport(host);
      };

      const cleanup = () => {
        resize.removeEventListener('pointermove', onPointerMove);
        writeStoredRect(host);
        resizeState = null;
        try { resize.releasePointerCapture(event.pointerId); } catch {}
        scheduleApplySizePolicy(host);
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
    storedRect = readStoredRect();
    if (storedRect) desiredRect = { ...storedRect };
    scan();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== MESSAGE.SETTINGS_UPDATED) return false;
    settings = message.payload || settings;
    const host = document.getElementById('gemive-overlay-host');
    if (host) scheduleApplySizePolicy(host);
    return false;
  });

  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', () => {
    const host = document.getElementById('gemive-overlay-host');
    if (host) scheduleApplySizePolicy(host);
  });
  hydrateSettings();
})();
