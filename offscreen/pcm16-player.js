function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function pcm16BytesToFloat32(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = Math.floor(bytes.byteLength / 2);
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
    this.sampleRate = sampleRate;
    this.jitterBufferSeconds = jitterBufferMs / 1000;
    this.gain = audioContext.createGain();
    this.gain.gain.value = volume;
    this.gain.connect(audioContext.destination);
    this.nextPlaybackTime = 0;
    this.sources = new Set();
    this.enabled = true;
  }

  setVolume(volume) {
    this.gain.gain.value = Math.max(0, Math.min(1, Number(volume)));
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  playBase64(base64) {
    if (!this.enabled || !base64) return;
    const bytes = base64ToBytes(base64);
    const samples = pcm16BytesToFloat32(bytes);
    if (!samples.length) return;

    const buffer = this.audioContext.createBuffer(1, samples.length, this.sampleRate);
    buffer.copyToChannel(samples, 0);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    source.onended = () => this.sources.delete(source);

    const now = this.audioContext.currentTime;
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
    this.nextPlaybackTime = this.audioContext.currentTime;
  }

  disconnect() {
    this.stop();
    this.gain.disconnect();
  }
}
