export function toGemiveError(error, code = 'UNKNOWN_ERROR') {
  const message = error?.message || String(error || 'Unknown error');
  return { code, message, at: Date.now() };
}
