(() => {
  if (window.__gemiveOverlayInstalled) {
    window.__gemiveOverlayShow?.();
    return;
  }
  window.__gemiveOverlayInstalled = true;

  const MESSAGE = {
    GET_SETTINGS: 'GET_SETTINGS',
    UPDATE_SETTINGS: 'UPDATE_SETTINGS',
    START_SESSION: 'START_SESSION',
    STOP_SESSION: 'STOP_SESSION',
    OVERLAY_SHOW: 'OVERLAY_SHOW',
    OVERLAY_HIDE: 'OVERLAY_HIDE',
    OVERLAY_RESET_POSITION: 'OVERLAY_RESET_POSITION',
    SUBTITLE_UPDATE: 'SUBTITLE_UPDATE',
    SETTINGS_UPDATED: 'SETTINGS_UPDATED',
    SESSION_STATUS: 'SESSION_STATUS',
    DEBUG_LOG: 'DEBUG_LOG'
  };

  const I18N = {
    'zh-Hant': {
      closeSubtitleWindow: '關閉字幕視窗',
      collapseSubtitleWindow: '收合字幕視窗',
      startTranslation: '開始翻譯',
      stopTranslation: '停止翻譯',
      resizeWindow: '調整視窗大小',
      expandSubtitleWindow: '展開字幕視窗',
      overlayReadyTitle: '準備開始翻譯',
      overlayReadyBody: '點右上角播放按鈕，翻譯目前 Chrome 分頁的聲音。',
      overlayStartingTitle: '正在啟動翻譯…',
      overlayStartingBody: '如果此分頁有舊的擷取串流，Gemive 會先嘗試釋放它。',
      overlayStoppedTitle: '已停止翻譯',
      overlayStoppedBody: '點右上角播放按鈕可重新翻譯目前分頁。',
      listening: '正在聆聽…',
      waitingSource: '等待原文轉錄…',
      waitingVoice: '等待語音輸入…',
      startFailedTitle: '翻譯啟動失敗',
      startFailedFallback: '啟動失敗。請查看擴充功能的 service worker console。',
      statusIdle: '閒置',
      statusStarting: '啟動中',
      statusCapturing: '擷取中',
      statusConnecting: '連線中',
      statusTranslating: '翻譯中',
      statusStopping: '停止中',
      statusError: '錯誤'
    },
    'zh-Hans': {
      closeSubtitleWindow: '关闭字幕窗口',
      collapseSubtitleWindow: '收合字幕窗口',
      startTranslation: '开始翻译',
      stopTranslation: '停止翻译',
      resizeWindow: '调整窗口大小',
      expandSubtitleWindow: '展开字幕窗口',
      overlayReadyTitle: '准备开始翻译',
      overlayReadyBody: '点击右上角播放按钮，翻译当前 Chrome 标签页的声音。',
      overlayStartingTitle: '正在启动翻译…',
      overlayStartingBody: '如果此标签页有旧的采集流，Gemive 会先尝试释放它。',
      overlayStoppedTitle: '已停止翻译',
      overlayStoppedBody: '点击右上角播放按钮可重新翻译当前标签页。',
      listening: '正在聆听…',
      waitingSource: '等待原文转写…',
      waitingVoice: '等待语音输入…',
      startFailedTitle: '翻译启动失败',
      startFailedFallback: '启动失败。请查看扩展的 service worker console。',
      statusIdle: '空闲',
      statusStarting: '启动中',
      statusCapturing: '采集中',
      statusConnecting: '连接中',
      statusTranslating: '翻译中',
      statusStopping: '停止中',
      statusError: '错误'
    },
    en: {
      closeSubtitleWindow: 'Close subtitle window',
      collapseSubtitleWindow: 'Collapse subtitle window',
      startTranslation: 'Start translation',
      stopTranslation: 'Stop translation',
      resizeWindow: 'Resize window',
      expandSubtitleWindow: 'Expand subtitle window',
      overlayReadyTitle: 'Ready to translate',
      overlayReadyBody: 'Click the play button in the upper-right corner to translate audio from the current Chrome tab.',
      overlayStartingTitle: 'Starting translation…',
      overlayStartingBody: 'If this tab has a stale capture stream, Gemive will try to release it first.',
      overlayStoppedTitle: 'Translation stopped',
      overlayStoppedBody: 'Click the play button in the upper-right corner to translate this tab again.',
      listening: 'Listening…',
      waitingSource: 'Waiting for source transcription…',
      waitingVoice: 'Waiting for voice input…',
      startFailedTitle: 'Translation failed to start',
      startFailedFallback: 'Startup failed. Check the extension service worker console.',
      statusIdle: 'Idle',
      statusStarting: 'Starting',
      statusCapturing: 'Capturing',
      statusConnecting: 'Connecting',
      statusTranslating: 'Translating',
      statusStopping: 'Stopping',
      statusError: 'Error'
    }
  };

  const DEFAULT_MIN_WIDTH = 160;
  const DEFAULT_MIN_HEIGHT = 90;
  const DEFAULT_EXPANDED_WIDTH = 460;
  const DEFAULT_EXPANDED_HEIGHT = 260;
  const LAUNCHER_SIZE = 54;
  const LAUNCHER_DRAG_THRESHOLD = 6;
  const VIEWPORT_MARGIN = 8;
  const STORAGE_KEY = 'gemive.overlay.position';

  const DEFAULT_SETTINGS = {
    ui: { locale: 'en' },
    subtitles: {
      showTranslation: true,
      showSource: true,
      translationFontSize: 24,
      sourceFontSize: 15,
      translationColor: '#ffffff',
      sourceColor: '#d1d5db',
      translationMaxLines: 3,
      sourceMaxLines: 2
    },
    window: {
      x: null,
      y: null,
      width: DEFAULT_MIN_WIDTH,
      height: DEFAULT_MIN_HEIGHT,
      backgroundColor: '#000000',
      opacity: 0.72,
      blur: 22,
      borderRadius: 24,
      lockPosition: false,
      autoCollapse: false
    },
    audio: {
      originalVolume: 0.75,
      interpretationVolume: 0.35,
      playInterpretation: true
    }
  };

  let settings = clone(DEFAULT_SETTINGS);
  let host = null;
  let shadow = null;
  let elements = {};
  let visible = false;
  let dragState = null;
  let resizeState = null;
  let launcherDragState = null;
  let lastSubtitleAt = 0;
  let currentStatus = 'idle';
  let collapsed = false;
  let savedExpandedRect = null;

  function clone(value) {
    try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)); }
  }

  function sendRuntimeMessage(message) {
    return chrome.runtime.sendMessage(message);
  }

  function debug(event, data = {}) {
    chrome.runtime.sendMessage({
      type: MESSAGE.DEBUG_LOG,
      payload: { area: 'content-overlay', event, data }
    }).catch(() => undefined);
    console.debug('[Gemive overlay]', event, data);
  }

  function normalizeLocale(locale) {
    const value = String(locale || '').toLowerCase();
    if (value === 'zh-hans' || value.startsWith('zh-cn') || value.startsWith('zh-sg') || value.startsWith('zh-hans')) return 'zh-Hans';
    if (value === 'en' || value.startsWith('en-')) return 'en';
    if (value.startsWith('zh')) return 'zh-Hant';
    return 'en';
  }

  function currentLocale() {
    return normalizeLocale(settings?.ui?.locale || navigator.language || 'zh-Hant');
  }

  function text(key) {
    const locale = currentLocale();
    return I18N[locale]?.[key] || I18N['zh-Hant'][key] || I18N.en[key] || key;
  }

  function mergeSettings(base, patch) {
    const result = { ...base };
    for (const [key, value] of Object.entries(patch || {})) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = mergeSettings(base?.[key] || {}, value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  function numberOr(value, fallback) {
    const next = Number(value);
    return Number.isFinite(next) ? next : fallback;
  }

  function minWidth() {
    return Math.max(1, Math.round(numberOr(settings.window?.width, DEFAULT_MIN_WIDTH)));
  }

  function minHeight() {
    return Math.max(1, Math.round(numberOr(settings.window?.height, DEFAULT_MIN_HEIGHT)));
  }

  function maxWidth() {
    return Math.max(minWidth(), window.innerWidth - VIEWPORT_MARGIN * 2);
  }

  function maxHeight() {
    return Math.max(minHeight(), window.innerHeight - VIEWPORT_MARGIN * 2);
  }

  function clampWidth(value) {
    return Math.max(minWidth(), Math.min(maxWidth(), Math.round(numberOr(value, DEFAULT_EXPANDED_WIDTH))));
  }

  function clampHeight(value) {
    return Math.max(minHeight(), Math.min(maxHeight(), Math.round(numberOr(value, DEFAULT_EXPANDED_HEIGHT))));
  }

  function readPosition() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return stored && typeof stored === 'object' ? stored : null;
    } catch {
      return null;
    }
  }

  function savePosition(options = {}) {
    if (!host) return;
    const rect = host.getBoundingClientRect();
    let width = rect.width;
    let height = rect.height;
    if (options.preserveSize) {
      width = savedExpandedRect?.width || readPosition()?.width || DEFAULT_EXPANDED_WIDTH;
      height = savedExpandedRect?.height || readPosition()?.height || DEFAULT_EXPANDED_HEIGHT;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      x: rect.left,
      y: rect.top,
      width: clampWidth(width),
      height: clampHeight(height)
    }));
  }

  function resolveExpandedSize() {
    const stored = readPosition();
    const width = savedExpandedRect?.width || stored?.width || DEFAULT_EXPANDED_WIDTH;
    const height = savedExpandedRect?.height || stored?.height || DEFAULT_EXPANDED_HEIGHT;
    return {
      width: clampWidth(width),
      height: clampHeight(height)
    };
  }

  function setExpandedSize(width, height) {
    if (!host) return;
    host.style.width = `${clampWidth(width)}px`;
    host.style.height = `${clampHeight(height)}px`;
  }

  function keepInsideViewport() {
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

  function createHost() {
    if (host) return;

    host = document.createElement('div');
    host.id = 'gemive-overlay-host';
    host.style.position = 'fixed';
    host.style.zIndex = '2147483647';
    host.style.pointerEvents = 'auto';
    host.style.display = 'none';
    host.style.right = '24px';
    host.style.bottom = '24px';
    host.style.width = `${resolveExpandedSize().width}px`;
    host.style.height = `${resolveExpandedSize().height}px`;

    shadow = host.attachShadow({ mode: 'open' });
    const launcherIconUrl = chrome.runtime.getURL('assets/icon-48.png');
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .launcher {
          appearance: none;
          width: ${LAUNCHER_SIZE}px;
          height: ${LAUNCHER_SIZE}px;
          border-radius: 18px;
          padding: 0;
          display: grid;
          place-items: center;
          cursor: pointer;
          touch-action: none;
          user-select: none;
          -webkit-user-select: none;
          border: 1px solid rgba(205,214,244,0.26);
          background: rgba(30, 30, 46, 0.62);
          box-shadow: 0 14px 34px rgba(0,0,0,0.36), inset 0 1px 0 rgba(255,255,255,0.18);
          backdrop-filter: blur(var(--gemive-blur, 22px)) saturate(132%);
          -webkit-backdrop-filter: blur(var(--gemive-blur, 22px)) saturate(132%);
          transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
        }
        .launcher:hover {
          transform: translateY(-1px);
          border-color: rgba(137,180,250,0.42);
          background: rgba(49, 50, 68, 0.70);
        }
        .launcher:active { transform: translateY(0) scale(0.96); }
        .launcher.dragging { cursor: grabbing; transition: none; }
        .launcher[hidden],
        .card[hidden] { display: none !important; }
        .launcher img {
          width: 32px;
          height: 32px;
          display: block;
          filter: drop-shadow(0 8px 14px rgba(0,0,0,0.30));
          pointer-events: none;
        }
        .card {
          position: relative;
          display: flex;
          flex-direction: column;
          height: 100%;
          min-width: var(--gemive-min-width, ${DEFAULT_MIN_WIDTH}px);
          min-height: var(--gemive-min-height, ${DEFAULT_MIN_HEIGHT}px);
          max-width: calc(100vw - ${VIEWPORT_MARGIN * 2}px);
          max-height: calc(100vh - ${VIEWPORT_MARGIN * 2}px);
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", system-ui, sans-serif;
          color: rgba(255,255,255,0.94);
          background: rgba(17, 17, 27, 0.82);
          border: 1px solid rgba(205,214,244,0.22);
          box-shadow: 0 18px 42px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.10);
          backdrop-filter: blur(var(--gemive-blur, 22px)) saturate(128%);
          -webkit-backdrop-filter: blur(var(--gemive-blur, 22px)) saturate(128%);
          border-radius: 18px;
          overflow: hidden;
          user-select: text;
        }
        .toolbar {
          position: relative;
          height: 26px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          padding: 2px 6px;
          cursor: grab;
          user-select: none;
          background: rgba(17,17,27,0.54);
          border-bottom: 1px solid rgba(205,214,244,0.16);
          box-shadow: none;
          backdrop-filter: blur(18px) saturate(116%);
          -webkit-backdrop-filter: blur(18px) saturate(116%);
        }
        .controls { display: flex; align-items: center; gap: 7px; margin-left: auto; }
        .status {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
        }
        button {
          appearance: none;
          border: 1px solid rgba(205,214,244,0.22);
          color: rgba(245,245,247,0.92);
          background: linear-gradient(180deg, rgba(255,255,255,0.20), rgba(255,255,255,0.075));
          border-radius: 999px;
          width: 22px;
          height: 22px;
          padding: 0;
          display: grid;
          place-items: center;
          cursor: pointer;
          box-shadow:
            0 6px 18px rgba(0,0,0,0.30),
            inset 0 1px 0 rgba(255,255,255,0.28),
            inset 0 -1px 0 rgba(0,0,0,0.16);
          backdrop-filter: blur(14px) saturate(150%);
          -webkit-backdrop-filter: blur(14px) saturate(150%);
          transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
        }
        button:hover {
          background: linear-gradient(180deg, rgba(255,255,255,0.28), rgba(255,255,255,0.11));
          border-color: rgba(205,214,244,0.36);
        }
        button:active { transform: scale(0.94); }
        button.primary {
          background: linear-gradient(180deg, rgba(137,180,250,0.58), rgba(116,199,236,0.28));
          border-color: rgba(137,180,250,0.40);
          color: #f5f5f7;
          box-shadow:
            0 8px 20px rgba(137,180,250,0.18),
            inset 0 1px 0 rgba(255,255,255,0.32),
            inset 0 -1px 0 rgba(0,0,0,0.18);
        }
        button.hide {
          color: rgba(245,245,247,0.78);
          background: linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0.055));
        }
        button[hidden] { display: none; }
        svg { width: 10.5px; height: 10.5px; display: block; fill: currentColor; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.35)); }
        .body {
          position: relative;
          flex: 1 1 auto;
          min-height: 0;
          display: flex;
          flex-direction: column;
          padding: 8px 10px 10px;
          overflow: hidden;
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,0.22) transparent;
        }
        .translation,
        .source {
          min-height: 0;
          white-space: pre-wrap;
          overflow-y: auto;
          user-select: text;
          cursor: text;
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,0.22) transparent;
        }
        .translation::-webkit-scrollbar,
        .source::-webkit-scrollbar { width: 8px; }
        .translation::-webkit-scrollbar-track,
        .source::-webkit-scrollbar-track { background: transparent; }
        .translation::-webkit-scrollbar-thumb,
        .source::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.22); border-radius: 999px; }
        .translation {
          flex: 1 1 auto;
          font-weight: 780;
          line-height: 1.38;
          letter-spacing: -0.024em;
          color: rgba(245,245,247,0.97);
          text-shadow: 0 1px 2px rgba(0,0,0,0.36);
        }
        .source {
          display: none;
          flex: 1 1 50%;
          margin-top: 0;
          padding-top: 10px;
          border-top: 1px solid rgba(205,214,244,0.16);
          font-weight: 560;
          line-height: 1.48;
          letter-spacing: -0.01em;
          color: rgba(205,214,244,0.82);
          text-shadow: 0 1px 2px rgba(0,0,0,0.28);
        }
        .card.show-source .translation {
          flex: 1 1 50%;
          padding-bottom: 10px;
        }
        .card.show-source .source { display: block; }
        .empty { color: rgba(255,255,255,0.62); }
        .translation.empty { font-size: 20px !important; font-weight: 740; }
        .source.empty { font-size: 13px !important; }
        .resize {
          position: absolute;
          z-index: 2;
          width: 18px;
          height: 18px;
          right: 6px;
          bottom: 6px;
          cursor: nwse-resize;
          opacity: 0.30;
          transition: opacity 120ms ease;
          touch-action: none;
        }
        .card:hover .resize { opacity: 0.62; }
        .resize::after {
          content: "";
          position: absolute;
          right: 3px;
          bottom: 3px;
          width: 8px;
          height: 8px;
          border-right: 2px solid rgba(255,255,255,0.38);
          border-bottom: 2px solid rgba(255,255,255,0.38);
          border-radius: 1px;
        }
      </style>
      <button class="launcher" title="${text('expandSubtitleWindow')}" aria-label="${text('expandSubtitleWindow')}" hidden>
        <img src="${launcherIconUrl}" alt="" />
      </button>
      <div class="card" part="card">
        <div class="toolbar" part="toolbar">
          <button class="hide" title="${text('closeSubtitleWindow')}" aria-label="${text('closeSubtitleWindow')}">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path class="hide-icon" d="M3.28 2.22 8 6.94l4.72-4.72 1.06 1.06L9.06 8l4.72 4.72-1.06 1.06L8 9.06l-4.72 4.72-1.06-1.06L6.94 8 2.22 3.28z"/></svg>
          </button>
          <span class="status" aria-live="polite">${text('statusIdle')}</span>
          <div class="controls">
            <button class="start primary" title="${text('startTranslation')}" aria-label="${text('startTranslation')}">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.7v10.6c0 .55.6.88 1.06.58l7.9-5.3a.7.7 0 0 0 0-1.16l-7.9-5.3A.68.68 0 0 0 4.5 2.7z"/></svg>
            </button>
            <button class="stop" title="${text('stopTranslation')}" aria-label="${text('stopTranslation')}" hidden>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4h8v8H4z"/></svg>
            </button>
          </div>
        </div>
        <div class="body">
          <div class="translation empty">${text('overlayReadyTitle')}</div>
          <div class="source empty">${text('overlayReadyBody')}</div>
        </div>
        <div class="resize" title="${text('resizeWindow')}"></div>
      </div>
    `;

    elements = {
      launcher: shadow.querySelector('.launcher'),
      card: shadow.querySelector('.card'),
      toolbar: shadow.querySelector('.toolbar'),
      status: shadow.querySelector('.status'),
      translation: shadow.querySelector('.translation'),
      source: shadow.querySelector('.source'),
      body: shadow.querySelector('.body'),
      resize: shadow.querySelector('.resize'),
      hide: shadow.querySelector('.hide'),
      hideIcon: shadow.querySelector('.hide-icon'),
      start: shadow.querySelector('.start'),
      stop: shadow.querySelector('.stop')
    };

    elements.launcher.addEventListener('pointerdown', startLauncherPointer);
    elements.launcher.addEventListener('keydown', handleLauncherKeydown);
    elements.hide.addEventListener('click', closeOverlay);
    elements.start.addEventListener('click', startTranslation);
    elements.stop.addEventListener('click', stopTranslation);
    elements.toolbar.addEventListener('pointerdown', startDrag);
    elements.resize.addEventListener('pointerdown', startResize);
    document.addEventListener('fullscreenchange', moveIntoCurrentFullscreenRoot);
    window.addEventListener('resize', keepInsideViewport);

    moveIntoCurrentFullscreenRoot();
    applySettings({ preserveActualSize: true });
    updateStatus('idle');
    restorePosition();
  }

  function moveIntoCurrentFullscreenRoot() {
    if (!host) return;
    const parent = document.fullscreenElement || document.body || document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
  }

  async function hydrateSettings() {
    try {
      const response = await sendRuntimeMessage({ type: MESSAGE.GET_SETTINGS });
      if (response?.settings) {
        settings = mergeSettings(settings, response.settings);
        applySettings({ preserveActualSize: true });
      }
    } catch {}
  }

  function applySettings({ preserveActualSize = true } = {}) {
    if (!host || !elements.card) return;

    const bg = settings.window.backgroundColor || '#000000';
    const opacity = Number(settings.window.opacity ?? 0.72);
    const rgb = hexToRgb(bg) || { r: 18, g: 21, b: 25 };
    const blur = Number(settings.window.blur ?? 22);

    elements.card.style.background = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
    elements.card.style.borderRadius = `${settings.window.borderRadius}px`;
    elements.card.style.setProperty('--gemive-blur', `${blur}px`);
    elements.card.style.setProperty('--gemive-min-width', `${minWidth()}px`);
    elements.card.style.setProperty('--gemive-min-height', `${minHeight()}px`);
    if (elements.launcher) elements.launcher.style.setProperty('--gemive-blur', `${blur}px`);

    elements.card.classList.toggle('show-source', Boolean(settings.subtitles.showSource));
    elements.translation.style.display = settings.subtitles.showTranslation ? 'block' : 'none';
    elements.translation.style.fontSize = `${settings.subtitles.translationFontSize}px`;
    elements.translation.style.color = settings.subtitles.translationColor;
    elements.translation.style.maxHeight = 'none';
    elements.source.style.fontSize = `${settings.subtitles.sourceFontSize}px`;
    elements.source.style.color = settings.subtitles.sourceColor;
    elements.source.style.maxHeight = 'none';

    updateStaticText();
    if (!settings.window.autoCollapse && collapsed) expandOverlay();
    if (!collapsed && preserveActualSize) {
      const rect = host.getBoundingClientRect();
      if (rect.width < minWidth() || rect.height < minHeight()) {
        setExpandedSize(Math.max(rect.width, minWidth()), Math.max(rect.height, minHeight()));
      }
      keepInsideViewport();
    }
  }

  function updateStaticText() {
    if (!elements?.hide) return;
    const hideActionKey = settings.window.autoCollapse ? 'collapseSubtitleWindow' : 'closeSubtitleWindow';
    elements.hide.title = text(hideActionKey);
    elements.hide.setAttribute('aria-label', text(hideActionKey));
    if (elements.hideIcon) {
      elements.hideIcon.setAttribute('d', settings.window.autoCollapse
        ? 'M3 7.25h10v1.5H3z'
        : 'M3.28 2.22 8 6.94l4.72-4.72 1.06 1.06L9.06 8l4.72 4.72-1.06 1.06L8 9.06l-4.72 4.72-1.06-1.06L6.94 8 2.22 3.28z');
    }
    elements.start.title = text('startTranslation');
    elements.start.setAttribute('aria-label', text('startTranslation'));
    elements.stop.title = text('stopTranslation');
    elements.stop.setAttribute('aria-label', text('stopTranslation'));
    elements.resize.title = text('resizeWindow');
    if (elements.launcher) {
      elements.launcher.title = text('expandSubtitleWindow');
      elements.launcher.setAttribute('aria-label', text('expandSubtitleWindow'));
    }
    updateStatus(currentStatus);
  }

  function hexToRgb(hex) {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    if (!match) return null;
    return {
      r: parseInt(match[1], 16),
      g: parseInt(match[2], 16),
      b: parseInt(match[3], 16)
    };
  }

  function collapseOverlay() {
    if (!host || !elements.card || !elements.launcher || !settings.window.autoCollapse) return;
    if (!collapsed) {
      const rect = host.getBoundingClientRect();
      if (rect.width > 80 && rect.height > 80) savedExpandedRect = { width: rect.width, height: rect.height };
      savePosition();
    }
    collapsed = true;
    host.dataset.gemiveCollapsed = 'true';
    elements.card.hidden = true;
    elements.card.style.display = 'none';
    elements.card.setAttribute('aria-hidden', 'true');
    elements.launcher.hidden = false;
    elements.launcher.style.display = 'grid';
    elements.launcher.removeAttribute('aria-hidden');
    elements.launcher.title = text('expandSubtitleWindow');
    elements.launcher.setAttribute('aria-label', text('expandSubtitleWindow'));
    host.style.width = `${LAUNCHER_SIZE}px`;
    host.style.height = `${LAUNCHER_SIZE}px`;
    host.style.minWidth = `${LAUNCHER_SIZE}px`;
    host.style.minHeight = `${LAUNCHER_SIZE}px`;
    host.style.overflow = 'visible';
    keepInsideViewport();
  }

  function expandOverlay() {
    if (!host || !elements.card || !elements.launcher) return;
    collapsed = false;
    host.dataset.gemiveCollapsed = 'false';
    elements.launcher.hidden = true;
    elements.launcher.style.display = 'none';
    elements.launcher.setAttribute('aria-hidden', 'true');
    elements.card.hidden = false;
    elements.card.style.display = 'flex';
    elements.card.removeAttribute('aria-hidden');
    host.style.minWidth = '0';
    host.style.minHeight = '0';
    host.style.overflow = 'visible';
    const size = resolveExpandedSize();
    setExpandedSize(size.width, size.height);
    keepInsideViewport();
  }

  function maybeAutoCollapse() {
    if (!visible || !host) return;
    if (!collapsed) expandOverlay();
  }

  function showOverlay(payload = {}) {
    debug('overlay.show', { hasSettings: Boolean(payload.settings), collapse: Boolean(payload.collapse) });
    createHost();
    if (payload.settings) {
      settings = mergeSettings(settings, payload.settings);
      applySettings({ preserveActualSize: true });
    } else {
      hydrateSettings();
    }
    visible = true;
    host.style.display = 'block';
    moveIntoCurrentFullscreenRoot();
    if (collapsed) collapseOverlay();
    else expandOverlay();
    keepInsideViewport();
  }

  function closeOverlay(event) {
    event?.stopPropagation?.();
    if (settings.window.autoCollapse) {
      collapseOverlay();
      return;
    }
    hideOverlay();
  }

  function hideOverlay() {
    visible = false;
    if (host) host.style.display = 'none';
  }

  function handleLauncherKeydown(event) {
    if (!collapsed) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    expandOverlay();
  }

  function startLauncherPointer(event) {
    if (!collapsed) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = host.getBoundingClientRect();
    launcherDragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false
    };
    elements.launcher.classList.add('dragging');
    elements.launcher.setPointerCapture(event.pointerId);
    elements.launcher.addEventListener('pointermove', onLauncherPointerMove);
    elements.launcher.addEventListener('pointerup', stopLauncherPointer, { once: true });
    elements.launcher.addEventListener('pointercancel', cancelLauncherPointer, { once: true });
  }

  function onLauncherPointerMove(event) {
    if (!launcherDragState) return;
    const dx = event.clientX - launcherDragState.startX;
    const dy = event.clientY - launcherDragState.startY;
    const distance = Math.hypot(dx, dy);
    if (distance < LAUNCHER_DRAG_THRESHOLD && !launcherDragState.moved) return;
    launcherDragState.moved = true;
    if (settings.window.lockPosition) return;
    host.style.left = `${launcherDragState.left + dx}px`;
    host.style.top = `${launcherDragState.top + dy}px`;
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    keepInsideViewport();
  }

  function stopLauncherPointer(event) {
    if (!launcherDragState) return;
    const shouldExpand = !launcherDragState.moved;
    cleanupLauncherPointer(event?.pointerId);
    if (shouldExpand) {
      expandOverlay();
      return;
    }
    savePosition({ preserveSize: true });
  }

  function cancelLauncherPointer(event) {
    cleanupLauncherPointer(event?.pointerId);
  }

  function cleanupLauncherPointer(pointerId) {
    elements.launcher.removeEventListener('pointermove', onLauncherPointerMove);
    elements.launcher.classList.remove('dragging');
    try {
      if (pointerId !== undefined) elements.launcher.releasePointerCapture(pointerId);
    } catch {}
    launcherDragState = null;
  }

  async function startTranslation(event) {
    event?.stopPropagation?.();
    debug('start.click');
    createHost();
    expandOverlay();
    updateStatus('starting');
    elements.translation.textContent = text('overlayStartingTitle');
    elements.source.textContent = text('overlayStartingBody');
    elements.translation.classList.add('empty');
    elements.source.classList.add('empty');
    try {
      const response = await sendRuntimeMessage({ type: MESSAGE.START_SESSION, payload: { source: 'overlay' } });
      debug('start.response', response);
      if (response?.ok) updateStatus(response.session || 'capturing');
      else throw new Error(response?.error || text('startFailedFallback'));
    } catch (error) {
      debug('start.error', { message: error?.message || String(error), stack: error?.stack || '' });
      updateStatus({ status: 'error', lastError: { message: error?.message || String(error) } });
    }
  }

  async function stopTranslation(event) {
    event?.stopPropagation?.();
    debug('stop.click');
    updateStatus('stopping');
    try {
      const response = await sendRuntimeMessage({ type: MESSAGE.STOP_SESSION, payload: { keepOverlay: true } });
      updateStatus(response?.session || 'idle');
      elements.translation.textContent = text('overlayStoppedTitle');
      elements.source.textContent = text('overlayStoppedBody');
      elements.translation.classList.add('empty');
      elements.source.classList.add('empty');
    } catch (error) {
      debug('stop.error', { message: error?.message || String(error), stack: error?.stack || '' });
      updateStatus({ status: 'error', lastError: { message: error?.message || String(error) } });
    }
  }

  function updateSubtitle(payload) {
    createHost();
    if (!visible) showOverlay();
    lastSubtitleAt = Date.now();
    const translation = payload?.translation?.text || '';
    const source = payload?.source?.text || '';
    elements.translation.textContent = translation || text('listening');
    elements.source.textContent = source || text('waitingSource');
    elements.translation.classList.toggle('empty', !translation);
    elements.source.classList.toggle('empty', !source);
    requestAnimationFrame(() => {
      if (elements.translation) elements.translation.scrollTop = elements.translation.scrollHeight;
      if (elements.source) elements.source.scrollTop = elements.source.scrollHeight;
    });
  }

  function updateStatus(status) {
    createHost();
    const normalized = typeof status === 'object' && status ? status : { status: status || 'idle' };
    const value = normalized.status || 'idle';
    currentStatus = value;
    const labelMap = {
      idle: text('statusIdle'),
      starting: text('statusStarting'),
      capturing: text('statusCapturing'),
      connecting: text('statusConnecting'),
      translating: text('statusTranslating'),
      stopping: text('statusStopping'),
      error: text('statusError')
    };
    elements.status.textContent = labelMap[value] || String(value);
    elements.start.hidden = ['starting', 'capturing', 'connecting', 'translating', 'stopping'].includes(value);
    elements.stop.hidden = !['starting', 'capturing', 'connecting', 'translating', 'stopping'].includes(value);
    maybeAutoCollapse();
    if (value === 'error') {
      const message = normalized.lastError?.message || text('startFailedFallback');
      elements.translation.textContent = text('startFailedTitle');
      elements.source.textContent = message;
      elements.translation.classList.add('empty');
      elements.source.classList.add('empty');
    }
  }

  function restorePosition() {
    const stored = readPosition();
    if (!stored) return;
    if (Number.isFinite(stored.x)) host.style.left = `${stored.x}px`;
    if (Number.isFinite(stored.y)) host.style.top = `${stored.y}px`;
    if (Number.isFinite(stored.width) && Number.isFinite(stored.height)) setExpandedSize(stored.width, stored.height);
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    keepInsideViewport();
  }

  function resetPosition() {
    localStorage.removeItem(STORAGE_KEY);
    savedExpandedRect = null;
    host.style.left = 'auto';
    host.style.top = 'auto';
    host.style.right = '24px';
    host.style.bottom = '24px';
    const size = resolveExpandedSize();
    setExpandedSize(size.width, size.height);
    keepInsideViewport();
  }

  function startDrag(event) {
    if (settings.window.lockPosition) return;
    if (event.target?.closest?.('button, input, select, textarea')) return;
    event.preventDefault();
    const rect = host.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top
    };
    elements.toolbar.setPointerCapture(event.pointerId);
    elements.toolbar.addEventListener('pointermove', onDrag);
    elements.toolbar.addEventListener('pointerup', stopDrag, { once: true });
  }

  function onDrag(event) {
    if (!dragState) return;
    const left = dragState.left + event.clientX - dragState.startX;
    const top = dragState.top + event.clientY - dragState.startY;
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    keepInsideViewport();
  }

  function stopDrag() {
    if (!dragState) return;
    elements.toolbar.removeEventListener('pointermove', onDrag);
    dragState = null;
    savePosition();
  }

  function startResize(event) {
    event.preventDefault();
    event.stopPropagation();
    const rect = host.getBoundingClientRect();
    resizeState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height
    };
    elements.resize.setPointerCapture(event.pointerId);
    elements.resize.addEventListener('pointermove', onResize);
    elements.resize.addEventListener('pointerup', stopResize, { once: true });
    elements.resize.addEventListener('pointercancel', stopResize, { once: true });
  }

  function onResize(event) {
    if (!resizeState) return;
    const nextWidth = clampWidth(resizeState.width + event.clientX - resizeState.startX);
    const nextHeight = clampHeight(resizeState.height + event.clientY - resizeState.startY);
    setExpandedSize(nextWidth, nextHeight);
    keepInsideViewport();
  }

  function stopResize() {
    if (!resizeState) return;
    elements.resize.removeEventListener('pointermove', onResize);
    try { elements.resize.releasePointerCapture(resizeState.pointerId); } catch {}
    resizeState = null;
    const rect = host.getBoundingClientRect();
    savedExpandedRect = { width: rect.width, height: rect.height };
    savePosition();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message?.type) {
      case MESSAGE.OVERLAY_SHOW:
        showOverlay(message.payload || {});
        sendResponse?.({ ok: true });
        break;
      case MESSAGE.OVERLAY_HIDE:
        hideOverlay();
        sendResponse?.({ ok: true });
        break;
      case MESSAGE.OVERLAY_RESET_POSITION:
        createHost();
        resetPosition();
        sendResponse?.({ ok: true });
        break;
      case MESSAGE.SUBTITLE_UPDATE:
        updateSubtitle(message.payload);
        sendResponse?.({ ok: true });
        break;
      case MESSAGE.SESSION_STATUS:
        updateStatus(message.payload);
        sendResponse?.({ ok: true });
        break;
      case MESSAGE.SETTINGS_UPDATED:
        settings = mergeSettings(settings, message.payload || {});
        applySettings({ preserveActualSize: true });
        sendResponse?.({ ok: true });
        break;
      default:
        return false;
    }
    return true;
  });

  window.__gemiveOverlayShow = showOverlay;

  setInterval(() => {
    if (!visible || !host || !lastSubtitleAt) return;
    if (currentStatus !== 'translating') return;
    if (Date.now() - lastSubtitleAt > 10000) {
      elements.translation.textContent = text('listening');
      elements.source.textContent = text('waitingVoice');
      elements.translation.classList.add('empty');
      elements.source.classList.add('empty');
    }
  }, 2500);
})();
