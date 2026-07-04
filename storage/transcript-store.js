const TRANSCRIPT_KEY = 'gemive.transcripts';
const ACTIVE_TRANSCRIPT_INDEX_KEY = 'gemive.transcript.activeIds';
const ACTIVE_TRANSCRIPT_KEY_PREFIX = 'gemive.transcript.active.';
const TRANSCRIPT_SCHEMA_VERSION = 2;
const MAX_TRANSCRIPTS = 100;
const MAX_UPDATES_PER_TRANSCRIPT = 120;
const TRANSCRIPT_CACHE_SOFT_BYTES = 4 * 1024 * 1024;

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

function approximateJsonBytes(value) {
  const text = JSON.stringify(value ?? null);
  try {
    return new TextEncoder().encode(text).byteLength;
  } catch {
    return text.length * 2;
  }
}

function defaultExportStatus(entry) {
  if (entry?.autoExportTranscript === false) return 'disabled';
  if (!entry?.sourceText && !entry?.translationText) return 'empty';
  return 'pending';
}

function normalizeExportState(entry = {}) {
  const current = entry.export && typeof entry.export === 'object' ? entry.export : {};
  let status = current.status || entry.exportStatus || defaultExportStatus(entry);
  if (entry.autoExportTranscript === false) status = 'disabled';
  else if (status === 'empty' && (entry.sourceText || entry.translationText)) status = 'pending';
  return {
    status,
    filename: current.filename || entry.exportFilename || '',
    downloadId: current.downloadId ?? entry.exportDownloadId ?? null,
    exportedAt: current.exportedAt || entry.exportedAt || null,
    errorMessage: current.errorMessage || entry.exportError || ''
  };
}

function normalizeTranscriptEntry(entry, { status = 'finished', now = Date.now() } = {}) {
  if (!entry) return null;
  const createdAt = entry.createdAt || entry.startedAt || now;
  const updates = Array.isArray(entry.updates)
    ? entry.updates.slice(-MAX_UPDATES_PER_TRANSCRIPT)
    : [];
  return {
    ...entry,
    schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    id: entry.id || crypto.randomUUID(),
    createdAt,
    updatedAt: entry.updatedAt || now,
    status: entry.status || status,
    updates,
    export: normalizeExportState(entry)
  };
}

function findOldestExportedIndex(entries) {
  for (let index = entries.length - 1; index > 0; index -= 1) {
    if (entries[index]?.export?.status === 'exported') return index;
  }
  return -1;
}

function pruneTranscriptCache(entries, targetBytes = TRANSCRIPT_CACHE_SOFT_BYTES) {
  const output = entries
    .map((entry) => normalizeTranscriptEntry(entry))
    .filter(Boolean)
    .slice(0, MAX_TRANSCRIPTS);

  while (output.length > 1 && approximateJsonBytes(output) > targetBytes) {
    const exportedIndex = findOldestExportedIndex(output);
    if (exportedIndex < 0) break;
    output.splice(exportedIndex, 1);
  }

  return output;
}

async function setTranscripts(entries) {
  const next = pruneTranscriptCache(entries);
  try {
    await chrome.storage.local.set({ [TRANSCRIPT_KEY]: next });
    return next;
  } catch (error) {
    const fallback = pruneTranscriptCache(next, Math.floor(TRANSCRIPT_CACHE_SOFT_BYTES / 2));
    if (fallback.length === next.length) throw error;
    await chrome.storage.local.set({ [TRANSCRIPT_KEY]: fallback });
    return fallback;
  }
}

export async function appendTranscript(entry) {
  if (!entry) return null;
  const stored = await chrome.storage.local.get(TRANSCRIPT_KEY);
  const transcripts = Array.isArray(stored[TRANSCRIPT_KEY]) ? stored[TRANSCRIPT_KEY] : [];
  const next = normalizeTranscriptEntry(entry);
  const deduped = transcripts.filter((item) => item?.id !== next.id);
  deduped.unshift(next);
  await setTranscripts(deduped);
  return next;
}

export async function saveTranscriptCheckpoint(entry) {
  if (!entry?.id) return null;
  const now = Date.now();
  const checkpoint = normalizeTranscriptEntry({ ...entry, updatedAt: now }, { status: 'active', now });
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
    .map((entry) => normalizeTranscriptEntry(entry, { status: 'active' }));
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
  const transcripts = Array.isArray(stored[TRANSCRIPT_KEY])
    ? stored[TRANSCRIPT_KEY].map((entry) => normalizeTranscriptEntry(entry)).filter(Boolean)
    : [];
  const active = await getActiveTranscripts();
  const transcriptIds = new Set(transcripts.map((item) => item?.id).filter(Boolean));
  const activeOnly = active.filter((entry) => !transcriptIds.has(entry.id));
  return [...activeOnly, ...transcripts].slice(0, MAX_TRANSCRIPTS);
}

export async function updateTranscriptExport(id, patch = {}) {
  if (!id) return null;
  const stored = await chrome.storage.local.get(TRANSCRIPT_KEY);
  const transcripts = Array.isArray(stored[TRANSCRIPT_KEY]) ? stored[TRANSCRIPT_KEY] : [];
  const index = transcripts.findIndex((entry) => entry?.id === id);
  if (index < 0) return null;

  const current = normalizeTranscriptEntry(transcripts[index]);
  const next = normalizeTranscriptEntry({
    ...current,
    updatedAt: Date.now(),
    export: {
      ...current.export,
      ...patch
    }
  });

  const updated = [...transcripts];
  updated[index] = next;
  await setTranscripts(updated);
  return next;
}
