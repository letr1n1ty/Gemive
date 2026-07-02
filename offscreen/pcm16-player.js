function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function finiteNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function numberInRange(value, fallback, min, max) {
  return Math.min(max, Math.max(min, finiteNumber(value, fallback)));
}

function integerInRange(value, fallback, min, max) {
  return Math.round(numberInRange(value, fallback, min, max));
}

function pcm16BytesToFloat32(bytes) {
  const usableByteLength = bytes.byteLength - (bytes.byteLength % 2);
  if (usableByteLength <= 0) return new Float32Array();

  const view = new DataView(bytes.buffer, bytes.byteOffset, usableByteLength);
  const length = Math.floor(usableByteLength / 2);
  const floats = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const int = view.getInt16(i * 2, true);
    floats[i] = int < 0 ? int / 0x8000 : int / 0x7fff;
  }
  return floats;
}

export class Pcm16Player {
  constructor(audioContext, { sampleRate = 24000, jitterBufferMs = 300, volume = 0.5 } = {}) {
    this.audioContext = audioContext;
    this.sampleRate = integerInRange(sampleRate, 24000, 8000, 96000);
    this.jitterBufferSeconds = numberInRange(jitterBufferMs, 300, 0, 3000) / 1000;
    this.gain = audioContext.createGain();
    this.gain.gain.value = numberInRange(volume, 0.5, 0, 1);
    this.gain.connect(audioContext.destination);
    this.nextPlaybackTime = 0;
    this.sources = new Set();
    this.enabled = true;
  }

  setVolume(volume) {
    this.gain.gain.value = numberInRange(volume, 0.5, 0, 1);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.stop();
  }

  playBase64(base64) {
    if (!this.enabled || !base64 || this.audioContext.state === 'closed') return;

    let bytes;
    try {
      bytes = base64ToBytes(base64);
    } catch {
      return;
    }

    const samples = pcm16BytesToFloat32(bytes);
    if (!samples.length) return;

    const buffer = this.audioContext.createBuffer(1, samples.length, this.sampleRate);
    buffer.copyToChannel(samples, 0);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    source.onended = () => this.sources.delete(source);

    const now = this.audioContext.currentTime;
    if (this.nextPlaybackTime < now || this.nextPlaybackTime - now > 4) {
      this.nextPlaybackTime = now + this.jitterBufferSeconds;
    }
    const startAt = Math.max(now + this.jitterBufferSeconds, this.nextPlaybackTime);
    source.start(startAt);
    this.nextPlaybackTime = startAt + buffer.duration;
    this.sources.add(source);
  }

  stop() {
    for (const source of this.sources) {
      try { source.stop(); } catch {}
    }
    this.sources.clear();
    if (this.audioContext.state !== 'closed') {
      this.nextPlaybackTime = this.audioContext.currentTime;
    } else {
      this.nextPlaybackTime = 0;
    }
  }

  disconnect() {
    this.stop();
    try { this.gain.disconnect(); } catch {}
  }
}