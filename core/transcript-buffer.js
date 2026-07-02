function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function hasCjk(text) {
  return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/.test(text || '');
}

function isNonAsciiEnd(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return normalized.charCodeAt(normalized.length - 1) > 127;
}

function isNonAsciiStart(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return normalized.charCodeAt(0) > 127;
}

function countWords(text) {
  const normalized = normalizeText(text);
  if (!normalized) return 0;
  return normalized.split(/\s+/).filter(Boolean).length;
}

function isTerminal(text) {
  return /[.!?。！？;；:]$/.test(normalizeText(text));
}

function softJoin(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a) return b;
  if (!b) return a;
  if (/^[,.;:!?，。！？；：、)]/.test(b)) return `${a}${b}`;
  if (/[([{（「『《]$/.test(a)) return `${a}${b}`;
  if (isNonAsciiEnd(a) || isNonAsciiStart(b)) return `${a}${b}`;
  return `${a} ${b}`;
}

function similarity(a, b) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const shorter = left.length < right.length ? left : right;
  const longer = left.length >= right.length ? left : right;
  if (longer.includes(shorter) && shorter.length / longer.length > 0.78) return 0.96;
  return 0;
}

function overlapLength(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  const max = Math.min(180, a.length, b.length);
  for (let size = max; size >= 4; size -= 1) {
    if (a.slice(-size).toLowerCase() === b.slice(0, size).toLowerCase()) return size;
  }
  return 0;
}

function appendDistinct(committed, next) {
  const current = normalizeText(committed);
  const incoming = normalizeText(next);
  if (!incoming) return current;
  if (!current) return incoming;
  if (current.includes(incoming) && incoming.length >= 4) return current;
  if (incoming.includes(current) && incoming.length > current.length) return incoming;
  if (similarity(current, incoming) > 0.95) return current;
  const overlap = overlapLength(current, incoming);
  const tail = overlap > 0 ? incoming.slice(overlap) : incoming;
  return softJoin(current, tail);
}

function trimToMaxLength(text, maxLength = 9000) {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(-maxLength).replace(/^\S+\s*/, '').trim();
}

function isMeaningfulChunk(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (hasCjk(normalized)) return normalized.length >= 6;
  return countWords(normalized) >= 3 || normalized.length >= 18;
}

function stripCommittedPrefix(incoming, segments) {
  let text = normalizeText(incoming);
  if (!text || !segments.length) return text;
  const lower = text.toLowerCase();

  for (let count = Math.min(4, segments.length); count >= 1; count -= 1) {
    const recent = normalizeText(segments.slice(-count).join(' '));
    if (!recent) continue;
    const recentLower = recent.toLowerCase();
    if (lower.startsWith(recentLower)) {
      return normalizeText(text.slice(recent.length));
    }
  }

  const last = normalizeText(segments[segments.length - 1]);
  if (last) {
    const overlap = overlapLength(last, text);
    if (overlap >= Math.min(24, Math.floor(last.length * 0.6))) {
      return normalizeText(text.slice(overlap));
    }
  }

  return text;
}

class RollingTextTrack {
  constructor() {
    this.segments = [];
    this.active = '';
    this.activeSince = 0;
    this.lastInputAt = 0;
    this.lastEmitAt = 0;
    this.lastEmitted = '';
  }

  update(transcription, now) {
    const raw = normalizeText(transcription?.text);
    if (!raw) return { changed: false, text: this.getDisplayText() };

    const isFinal = Boolean(
      transcription.finished ||
      transcription.isFinal ||
      transcription.is_final ||
      transcription.final
    );

    const gapMs = this.lastInputAt ? now - this.lastInputAt : 0;
    if (gapMs > 2400) this.commitActive();
    this.lastInputAt = now;
    if (!this.activeSince) this.activeSince = now;

    const incoming = stripCommittedPrefix(raw, this.segments);
    if (incoming) this.active = appendDistinct(this.active, incoming);

    const activeAge = now - this.activeSince;
    const shouldTimeCommit = activeAge >= 3600 && isMeaningfulChunk(this.active);
    const shouldFinalCommit = isFinal && (activeAge >= 900 || isTerminal(this.active) || isMeaningfulChunk(this.active));

    if (shouldTimeCommit || shouldFinalCommit || isTerminal(this.active)) {
      this.commitActive();
    }

    return this.emitIfChanged(now, isFinal);
  }

  commitActive() {
    const text = normalizeText(this.active);
    this.active = '';
    this.activeSince = 0;
    if (!text) return;

    const last = this.segments[this.segments.length - 1] || '';
    if (!last || similarity(last, text) < 0.96) {
      const merged = last ? appendDistinct(last, text) : text;
      if (last && merged !== last && merged.length <= last.length + Math.max(120, text.length + 8)) {
        this.segments[this.segments.length - 1] = merged;
      } else {
        this.segments.push(text);
      }
    }

    this.pruneSegments();
  }

  pruneSegments() {
    while (this.segments.length > 80) this.segments.shift();
    while (normalizeText(this.segments.join(' ')).length > 9000 && this.segments.length > 1) {
      this.segments.shift();
    }
  }

  emitIfChanged(now, isFinal) {
    const text = this.getDisplayText();
    if (!text) return { changed: false, text, isFinal };

    const enoughTime = now - this.lastEmitAt >= 900;
    const bigGrowth = text.length - this.lastEmitted.length >= 18;
    const finalUpdate = Boolean(isFinal);
    const changed = similarity(this.lastEmitted, text) < 0.995;

    if (!changed) return { changed: false, text, isFinal };
    if (!finalUpdate && !bigGrowth && !enoughTime) return { changed: false, text, isFinal };

    this.lastEmitted = text;
    this.lastEmitAt = now;
    return { changed: true, text, isFinal };
  }

  getDisplayText() {
    return trimToMaxLength(softJoin(this.segments.join(' '), this.active));
  }
}

export class TranscriptBuffer {
  constructor() {
    this.translationTrack = new RollingTextTrack();
    this.sourceTrack = new RollingTextTrack();
    this.state = {
      translation: { text: '', languageCode: '', isFinal: false, updatedAt: 0 },
      source: { text: '', languageCode: '', isFinal: false, updatedAt: 0 },
      timing: { receivedAt: Date.now(), displayUntil: Date.now() + 3000 }
    };
  }

  updateFromServerContent(serverContent) {
    const now = Date.now();
    let changed = false;

    const input = serverContent?.inputTranscription || serverContent?.input_transcription;
    if (input?.text) {
      const result = this.sourceTrack.update(input, now);
      if (result.changed) {
        this.state.source = {
          text: result.text,
          languageCode: input.languageCode || input.language_code || this.state.source.languageCode || '',
          isFinal: Boolean(result.isFinal),
          updatedAt: now
        };
        changed = true;
      }
    }

    const output = serverContent?.outputTranscription || serverContent?.output_transcription;
    if (output?.text) {
      const result = this.translationTrack.update(output, now);
      if (result.changed) {
        this.state.translation = {
          text: result.text,
          languageCode: output.languageCode || output.language_code || this.state.translation.languageCode || '',
          isFinal: Boolean(result.isFinal),
          updatedAt: now
        };
        changed = true;
      }
    }

    if (!changed) return null;

    this.state.timing = {
      receivedAt: now,
      displayUntil: now + 30000
    };

    return structuredClone(this.state);
  }
}
