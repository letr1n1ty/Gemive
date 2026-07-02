(() => {
  if (window.__gemiveOverlaySizePatchInstalled) return;
  window.__gemiveOverlaySizePatchInstalled = true;

  const MIN_WIDTH = 160;
  const MIN_HEIGHT = 90;
  const VIEWPORT_MARGIN = 8;
  const STORAGE_KEY = 'gemive.overlay.position';
  const MESSAGE = { UPDATE_SETTINGS: 'UPDATE_SETTINGS' };

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

  function persistSize(host) {
    const rect = host.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: rect.left, y: rect.top, width, height }));
    } catch {}
    chrome.runtime.sendMessage({
      type: MESSAGE.UPDATE_SETTINGS,
      patch: { window: { width, height } }
    }).catch(() => undefined);
  }

  function installCompactResize(host) {
    if (!host?.shadowRoot) return;
    const shadow = host.shadowRoot;

    if (!shadow.querySelector('#gemive-compact-resize-style')) {
      const style = document.createElement('style');
      style.id = 'gemive-compact-resize-style';
      style.textContent = `
        .card {
          min-width: ${MIN_WIDTH}px !important;
          min-height: ${MIN_HEIGHT}px !important;
        }
        .body {
          padding: 8px 10px 10px !important;
        }
      `;
      shadow.appendChild(style);
    }

    const resize = shadow.querySelector('.resize');
    if (!resize || resize.dataset.gemiveCompactResizePatched === 'true') return;
    resize.dataset.gemiveCompactResizePatched = 'true';

    resize.addEventListener('pointerdown', (event) => {
      const startRect = host.getBoundingClientRect();
      const resizeState = {
        startX: event.clientX,
        startY: event.clientY,
        width: startRect.width,
        height: startRect.height
      };

      const onPointerMove = (moveEvent) => {
        const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
        const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - VIEWPORT_MARGIN * 2);
        const nextWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, resizeState.width + moveEvent.clientX - resizeState.startX));
        const nextHeight = Math.max(MIN_HEIGHT, Math.min(maxHeight, resizeState.height + moveEvent.clientY - resizeState.startY));
        host.style.width = `${nextWidth}px`;
        host.style.height = `${nextHeight}px`;
        keepInsideViewport(host);
      };

      const cleanup = () => {
        resize.removeEventListener('pointermove', onPointerMove);
        persistSize(host);
      };

      resize.addEventListener('pointermove', onPointerMove);
      resize.addEventListener('pointerup', cleanup, { once: true });
      resize.addEventListener('pointercancel', cleanup, { once: true });
    });
  }

  function scan() {
    const host = document.getElementById('gemive-overlay-host');
    if (host) installCompactResize(host);
  }

  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', scan);
  scan();
})();
