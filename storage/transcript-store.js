const TRANSCRIPT_KEY = 'gemive.transcripts';
const MAX_TRANSCRIPTS = 100;

export async function appendTranscript(entry) {
  const stored = await chrome.storage.local.get(TRANSCRIPT_KEY);
  const transcripts = Array.isArray(stored[TRANSCRIPT_KEY]) ? stored[TRANSCRIPT_KEY] : [];
  transcripts.unshift({ ...entry, id: crypto.randomUUID(), createdAt: Date.now() });
  await chrome.storage.local.set({ [TRANSCRIPT_KEY]: transcripts.slice(0, MAX_TRANSCRIPTS) });
}

export async function clearTranscripts() {
  await chrome.storage.local.set({ [TRANSCRIPT_KEY]: [] });
}

export async function getTranscripts() {
  const stored = await chrome.storage.local.get(TRANSCRIPT_KEY);
  return Array.isArray(stored[TRANSCRIPT_KEY]) ? stored[TRANSCRIPT_KEY] : [];
}
