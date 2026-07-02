const TRANSCRIPT_KEY = 'gemive.transcripts';
const ACTIVE_TRANSCRIPT_INDEX_KEY = 'gemive.transcript.activeIds';
const ACTIVE_TRANSCRIPT_KEY_PREFIX = 'gemive.transcript.active.';
const MAX_TRANSCRIPTS = 100;

function getActiveTranscriptKey(id) {
  return `${ACTIVE_TRANSCRIPT_KEY_PREFIX}${id}`;
}

async function getActiveTranscriptIds() {
  const stored = await chrome.storage.local.get(ACTIVE_TRANSCRIPT_INDEX_KEY);
  return Array.isArray(stored[ACTIVE_TRANSCRIPT_INDEX_KEY])
    ? stored[ACTIVE_TRANSCRIPT_INDEX_KEY].filter((id) => typeof id === 'string' && id)
    : [];
}

async function setActiveTranscriptIds(ids) {
  const uniqueIds = [...new Set(ids.filter((id) => typeof id === 'string' && id))];
  await chrome.storage.local.set({ [ACTIVE_TRANSCRIPT_INDEX_KEY]: uniqueIds.slice(0, MAX_TRANSCRIPTS) });
}

export async function appendTranscript(entry) {
  if (!entry) return null;
  const stored = await chrome.storage.local.get(TRANSCRIPT_KEY);
  const transcripts = Array.isArray(stored[TRANSCRIPT_KEY]) ? stored[TRANSCRIPT_KEY] : [];
  const id = entry.id || crypto.randomUUID();
  const createdAt = entry.createdAt || entry.startedAt || Date.now();
  const next = {
    ...entry,
    id,
    createdAt,
    updatedAt: entry.updatedAt || Date.now(),
    status: entry.status || 'finished'
  };
  const deduped = transcripts.filter((item) => item?.id !== id);
  deduped.unshift(next);
  await chrome.storage.local.set({ [TRANSCRIPT_KEY]: deduped.slice(0, MAX_TRANSCRIPTS) });
  return next;
}

export async function saveTranscriptCheckpoint(entry) {
  if (!entry?.id) return null;
  const now = Date.now();
  const checkpoint = {
    ...entry,
    createdAt: entry.createdAt || entry.startedAt || now,
    updatedAt: now,
    status: entry.status || 'active'
  };
  const ids = await getActiveTranscriptIds();
  await chrome.storage.local.set({
    [getActiveTranscriptKey(entry.id)]: checkpoint,
    [ACTIVE_TRANSCRIPT_INDEX_KEY]: [entry.id, ...ids.filter((id) => id !== entry.id)].slice(0, MAX_TRANSCRIPTS)
  });
  return checkpoint;
}

export async function removeTranscriptCheckpoint(id) {
  if (!id) return;
  const ids = await getActiveTranscriptIds();
  await chrome.storage.local.remove(getActiveTranscriptKey(id));
  await setActiveTranscriptIds(ids.filter((item) => item !== id));
}

export async function getActiveTranscripts() {
  const ids = await getActiveTranscriptIds();
  if (!ids.length) return [];
  const keys = ids.map(getActiveTranscriptKey);
  const stored = await chrome.storage.local.get(keys);
  return keys
    .map((key) => stored[key])
    .filter((entry) => entry?.id)
    .map((entry) => ({ ...entry, status: entry.status || 'active' }));
}

export async function recoverInterruptedTranscripts(reason = 'interrupted') {
  const active = await getActiveTranscripts();
  const recovered = [];
  for (const entry of active) {
    if (entry.endedAt) {
      await removeTranscriptCheckpoint(entry.id);
      continue;
    }
    const endedAt = entry.updatedAt || Date.now();
    const finalized = {
      ...entry,
      endedAt,
      stopReason: entry.stopReason || reason,
      durationMs: Math.max(0, endedAt - (entry.startedAt || endedAt)),
      status: 'interrupted'
    };
    recovered.push(await appendTranscript(finalized));
    await removeTranscriptCheckpoint(entry.id);
  }
  return recovered;
}

export async function clearTranscripts() {
  const ids = await getActiveTranscriptIds();
  const keys = ids.map(getActiveTranscriptKey);
  await chrome.storage.local.remove([...keys, ACTIVE_TRANSCRIPT_INDEX_KEY]);
  await chrome.storage.local.set({ [TRANSCRIPT_KEY]: [] });
}

export async function getTranscripts() {
  const stored = await chrome.storage.local.get(TRANSCRIPT_KEY);
  const transcripts = Array.isArray(stored[TRANSCRIPT_KEY]) ? stored[TRANSCRIPT_KEY] : [];
  const active = await getActiveTranscripts();
  const transcriptIds = new Set(transcripts.map((item) => item?.id).filter(Boolean));
  const activeOnly = active.filter((entry) => !transcriptIds.has(entry.id));
  return [...activeOnly, ...transcripts].slice(0, MAX_TRANSCRIPTS);
}
