export function parseApiKeys(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function pickRandomApiKey(value, random = Math.random) {
  const keys = parseApiKeys(value);
  if (!keys.length) return '';
  return keys[Math.floor(random() * keys.length)];
}
