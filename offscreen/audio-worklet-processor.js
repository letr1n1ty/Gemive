class GemiveCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameCount = 0;
    this.rmsWindow = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || input[0].length === 0) return true;

    const frameCount = input[0].length;
    const channels = input.length;
    const mixed = new Float32Array(frameCount);
    let sumSquares = 0;

    for (let i = 0; i < frameCount; i += 1) {
      let sample = 0;
      for (let channel = 0; channel < channels; channel += 1) {
        sample += input[channel][i] || 0;
      }
      sample /= channels;
      mixed[i] = sample;
      sumSquares += sample * sample;
    }

    this.frameCount += frameCount;
    this.rmsWindow += sumSquares;

    this.port.postMessage({ type: 'AUDIO_FRAME', samples: mixed }, [mixed.buffer]);

    if (this.frameCount >= sampleRate / 10) {
      const rms = Math.sqrt(this.rmsWindow / this.frameCount);
      this.port.postMessage({ type: 'RMS', rms });
      this.frameCount = 0;
      this.rmsWindow = 0;
    }

    return true;
  }
}

registerProcessor('gemive-capture-processor', GemiveCaptureProcessor);
