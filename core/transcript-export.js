const DEFAULT_TRANSCRIPT_FOLDER = 'Gemive/Transcripts';

export function sanitizeDownloadFolder(value) {
  const cleaned = String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim().replace(/[<>:"|?*\u0000-\u001F]/g, '-'))
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
  return cleaned || DEFAULT_TRANSCRIPT_FOLDER;
}

export function sanitizeFilenamePart(value, fallback = 'session') {
  const cleaned = String(value || '')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/^[. -]+|[. -]+$/g, '');
  return cleaned || fallback;
}

export function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function dateFolder(value = Date.now()) {
  return new Date(value).toISOString().slice(0, 10);
}

export function formatIso(value) {
  if (!value) return '';
  try { return new Date(value).toISOString(); } catch { return String(value); }
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function mdText(value) {
  return String(value || '').trim() || '_No content captured._';
}

function hostnameFromUrl(value) {
  try {
    return new URL(value || 'https://example.invalid').hostname;
  } catch {
    return 'session';
  }
}

function appendTranscriptMetadata(lines, entry, { includeTitle = false, urlHistory = false } = {}) {
  const startedAt = formatIso(entry.startedAt || entry.receivedAt || entry.createdAt);
  const endedAt = formatIso(entry.endedAt);
  if (includeTitle && entry.tabTitle) lines.push(`- Title: ${entry.tabTitle}`);
  if (startedAt) lines.push(`- Started: ${startedAt}`);
  if (endedAt) lines.push(`- Stopped: ${endedAt}`);
  if (entry.durationMs !== undefined) lines.push(`- Duration: ${formatDuration(entry.durationMs)}`);
  if (entry.tabUrl) lines.push(`- URL: ${entry.tabUrl}`);
  if (urlHistory && Array.isArray(entry.urlHistory) && entry.urlHistory.length > 1) {
    lines.push('- URL history:');
    entry.urlHistory.forEach((item) => {
      lines.push(`  - ${formatIso(item.at)} ${item.url}`);
    });
  }
  if (entry.sourceLanguageCode) lines.push(`- Source language: ${entry.sourceLanguageCode}`);
  if (entry.targetLanguageCode) lines.push(`- Target language: ${entry.targetLanguageCode}`);
  if (entry.stopReason) lines.push(`- Stop reason: ${entry.stopReason}`);
  if (entry.checkpointIndex) lines.push(`- Checkpoint: ${entry.checkpointIndex}`);
}

export function formatTranscriptEntryMarkdown(entry, { titlePrefix = 'Gemive Transcript' } = {}) {
  const lines = [
    `# ${titlePrefix}`,
    '',
    `Exported: ${new Date().toISOString()}`,
    ''
  ];

  appendTranscriptMetadata(lines, entry, { includeTitle: true, urlHistory: true });
  lines.push('', '## Translation', '', mdText(entry.translationText), '', '## Source', '', mdText(entry.sourceText), '');
  return lines.join('\n');
}

export function formatTranscriptArchiveMarkdown(transcripts) {
  const lines = [
    '# Gemive Transcripts',
    '',
    `Exported: ${new Date().toISOString()}`,
    `Count: ${transcripts.length}`,
    ''
  ];

  if (!transcripts.length) {
    lines.push('_No transcripts saved yet._', '');
    return lines.join('\n');
  }

  transcripts.forEach((entry, index) => {
    const title = entry.tabTitle || 'Untitled tab';
    lines.push('---', '', `## ${index + 1}. ${title}`, '');
    appendTranscriptMetadata(lines, entry);
    lines.push('', '### Translation', '', mdText(entry.translationText), '', '### Source', '', mdText(entry.sourceText), '');
  });

  return lines.join('\n');
}

export function buildTranscriptEntryFilename(entry, { kind = 'session' } = {}) {
  const folder = sanitizeDownloadFolder(entry.transcriptFolder);
  const title = sanitizeFilenamePart(entry.tabTitle || hostnameFromUrl(entry.tabUrl), 'session');
  const stamp = timestampForFilename(new Date(entry.endedAt || Date.now()));
  const suffix = kind === 'checkpoint' ? `checkpoint-${String(entry.checkpointIndex || 1).padStart(3, '0')}` : 'session';
  return `${folder}/${dateFolder(entry.startedAt || Date.now())}/${stamp}-${title}-${suffix}.md`;
}

export function buildTranscriptArchiveFilename(folder, date = new Date()) {
  return `${sanitizeDownloadFolder(folder)}/gemive-transcripts-${timestampForFilename(date)}.md`;
}

export function shouldAutoExportTranscriptEntry(entry) {
  return Boolean(entry?.autoExportTranscript && (entry.sourceText || entry.translationText));
}

export async function downloadMarkdownFile({ markdown, filename }) {
  if (!chrome.downloads?.download) throw new Error('Downloads API is unavailable. Reload the extension after granting the downloads permission.');
  const url = `data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`;
  return await chrome.downloads.download({
    url,
    filename,
    saveAs: false,
    conflictAction: 'uniquify'
  });
}
