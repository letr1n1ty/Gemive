export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function mergePatch(base = {}, patch = {}) {
  const output = { ...(base || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    output[key] = isPlainObject(output[key]) && isPlainObject(value) ? mergePatch(output[key], value) : value;
  }
  return output;
}

export function numberInRange(value, fallback, min, max) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(max, Math.max(min, next));
}

export function integerInRange(value, fallback, min, max) {
  return Math.round(numberInRange(value, fallback, min, max));
}

export function unitToPercent(value, fallback = 0) {
  return integerInRange(Number(value) * 100, fallback, 0, 100);
}

export function percentToUnit(value, fallback = 0) {
  return numberInRange(Number(value) / 100, fallback, 0, 1);
}

export function setPercentLabel(element, percent, suffix = '%') {
  if (!element) return;
  element.textContent = `${integerInRange(percent, 0, 0, 100)}${suffix}`;
}

export function parseApiKeys(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeApiKeyList(value) {
  return parseApiKeys(value).join(', ');
}

export function sanitizeDownloadFolder(value, fallback = 'Gemive/Transcripts') {
  const cleaned = String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim().replace(/[<>:"|?*\u0000-\u001F]/g, '-'))
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
  return cleaned || fallback;
}

export function readBooleanInput(element, fallback = false) {
  return element ? Boolean(element.checked) : fallback;
}

export function readNumberInput(element, fallback = 0, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
  return numberInRange(element?.value, fallback, min, max);
}

export function readIntegerInput(element, fallback = 0, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  return integerInRange(element?.value, fallback, min, max);
}

export function readStringInput(element, fallback = '') {
  return typeof element?.value === 'string' ? element.value : fallback;
}
