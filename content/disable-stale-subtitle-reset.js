(() => {
  if (window.__gemiveStaleSubtitleResetDisabled) return;
  window.__gemiveStaleSubtitleResetDisabled = true;

  const nativeSetInterval = window.setInterval.bind(window);

  window.setInterval = (handler, timeout, ...args) => {
    if (timeout === 2500 && typeof handler === 'function') {
      const source = Function.prototype.toString.call(handler);
      const looksLikeStaleSubtitleReset =
        source.includes('lastSubtitleAt') &&
        source.includes('currentStatus') &&
        source.includes('waitingVoice') &&
        source.includes('elements.translation.textContent');

      if (looksLikeStaleSubtitleReset) {
        return 0;
      }
    }

    return nativeSetInterval(handler, timeout, ...args);
  };
})();
