export function arrayBufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function clampSample(sample) {
  return Math.max(-1, Math.min(1, sample));
}

export function floatToPcm16(samples) {
  const output = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = clampSample(samples[i]);
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function concatFloat32(chunks, totalLength) {
  const out = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export class Pcm16Chunker {
  constructor({ inputSampleRate, outputSampleRate = 16000, chunkMs = 100 }) {
    this.inputSampleRate = inputSampleRate;
    this.outputSampleRate = outputSampleRate;
    this.chunkMs = chunkMs;
    this.inputChunkSize = Math.max(1, Math.round((inputSampleRate * chunkMs) / 1000));
    this.pending = [];
    this.pendingLength = 0;
  }

  push(samples) {
    this.pending.push(samples);
    this.pendingLength += samples.length;
    const chunks = [];

    while (this.pendingLength >= this.inputChunkSize) {
      const joined = concatFloat32(this.pending, this.pendingLength);
      const current = joined.slice(0, this.inputChunkSize);
      const rest = joined.slice(this.inputChunkSize);
      this.pending = rest.length ? [rest] : [];
      this.pendingLength = rest.length;
      chunks.push(this.encodeInputBlock(current));
    }

    return chunks;
  }

  encodeInputBlock(input) {
    const outputLength = Math.round((input.length * this.outputSampleRate) / this.inputSampleRate);
    const resampled = new Float32Array(outputLength);
    const ratio = this.inputSampleRate / this.outputSampleRate;

    for (let i = 0; i < outputLength; i += 1) {
      const sourceIndex = i * ratio;
      const left = Math.floor(sourceIndex);
      const right = Math.min(left + 1, input.length - 1);
      const weight = sourceIndex - left;
      resampled[i] = input[left] * (1 - weight) + input[right] * weight;
    }

    const pcm = floatToPcm16(resampled);
    return {
      pcm,
      base64: arrayBufferToBase64(pcm.buffer),
      durationMs: this.chunkMs
    };
  }
}
