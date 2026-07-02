import { MESSAGE } from '../core/message-types.js';
import { TranscriptBuffer } from '../core/transcript-buffer.js';
import { Pcm16Chunker } from './pcm16-encoder.js';
import { Pcm16Player } from './pcm16-player.js';
import { GeminiLiveClient } from './gemini-live-client.js';
import { resolveLocale, t } from '../core/i18n.js';

function parseApiKeys(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function pickRandomApiKey(value) {
  const keys = parseApiKeys(value);
  if (!keys.length) return '';
  return keys[Math.floor(Math.random() * keys.length)];
}

export class AudioRouter {
  constructor() {
    this.audioContext = null;
    this.stream = null;
    this.source = null;
    this.originalGain = null;
    this.monitorGain = null;
    this.workletNode = null;
    this.chunker = null;
    this.player = null;
    this.gemini = null;
    this.transcriptBuffer = new TranscriptBuffer();
    this.settings = null;
    this.tabId = null;
    this.stopRequested = false;
  }

  debug(event, data = {}) {
    chrome.runtime.sendMessage({
      type: MESSAGE.DEBUG_LOG,
      payload: { area: 'audio-router', event, data, tabId: this.tabId }
    }).catch(() => undefined);
    console.debug('[Gemive audio-router]', event, data);
  }

  sendStatus(status, extra = {}) {
    chrome.runtime.sendMessage({
      type: MESSAGE.SESSION_STATUS,
      payload: { source: 'offscreen', status, tabId: this.tabId, ...extra }
    }).catch(() => undefined);
  }

  async start({ streamId, settings, tabId }) {
    this.debug('start.begin', { tabId, hasStreamId: Boolean(streamId), targetLanguageCode: settings?.language?.targetLanguageCode, apiKeyCount: parseApiKeys(settings?.api?.apiKey).length });
    await this.stop({ requestedByUser: false, silent: true });
    this.stopRequested = false;
    this.settings = settings;
    this.tabId = tabId ?? null;
    this.sendStatus('capturing');

    this.audioContext = new AudioContext({ latencyHint: 'interactive' });
    this.debug('audioContext.created', { sampleRate: this.audioContext.sampleRate, state: this.audioContext.state });
    if (this.audioContext.state === 'suspended') await this.audioContext.resume();

    this.debug('getUserMedia.begin');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    this.debug('getUserMedia.ok', { audioTracks: this.stream.getAudioTracks().length });

    for (const track of this.stream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        if (!this.stopRequested) {
          this.reportError(new Error(t(resolveLocale(this.settings), 'tabAudioCaptureEnded')), 'TAB_AUDIO_CAPTURE_ENDED');
        }
      });
    }

    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.originalGain = this.audioContext.createGain();
    this.originalGain.gain.value = settings.audio.originalVolume;
    this.source.connect(this.originalGain);
    this.originalGain.connect(this.audioContext.destination);

    await this.audioContext.audioWorklet.addModule(chrome.runtime.getURL('offscreen/audio-worklet-processor.js'));
    this.debug('audioWorklet.loaded');
    this.workletNode = new AudioWorkletNode(this.audioContext, 'gemive-capture-processor');
    this.monitorGain = this.audioContext.createGain();
    this.monitorGain.gain.value = 0;
    this.workletNode.connect(this.monitorGain);
    this.monitorGain.connect(this.audioContext.destination);

    this.chunker = new Pcm16Chunker({
      inputSampleRate: this.audioContext.sampleRate,
      outputSampleRate: 16000,
      chunkMs: settings.advanced.audioChunkMs
    });

    this.player = new Pcm16Player(this.audioContext, {
      sampleRate: 24000,
      jitterBufferMs: settings.advanced.jitterBufferMs,
      volume: settings.audio.interpretationVolume
    });
    this.player.setEnabled(settings.audio.playInterpretation);

    this.gemini = new GeminiLiveClient({
      apiKey: pickRandomApiKey(settings.api.apiKey),
      model: settings.api.model,
      targetLanguageCode: settings.language.targetLanguageCode,
      echoTargetLanguage: settings.language.echoTargetLanguage,
      onServerContent: (serverContent) => this.handleServerContent(serverContent),
      onAudio: (base64) => this.player?.playBase64(base64),
      onOpen: () => { this.debug('gemini.open'); this.sendStatus('connecting'); },
      onReady: () => { this.debug('gemini.ready'); this.sendStatus('translating'); },
      onClose: (event) => {
        if (!this.stopRequested && event?.code !== 1000) {
          this.reportError(new Error(`Gemini connection closed (${event?.code || 'unknown'}): ${event?.reason || 'no reason'}`));
        }
      },
      onError: (error) => this.reportError(error),
      onDebug: (event, data) => this.debug(`gemini.${event}`, data)
    });

    this.workletNode.port.onmessage = (event) => this.handleWorkletMessage(event.data);
    this.source.connect(this.workletNode);
    await this.gemini.connect();
    this.debug('start.complete');
  }

  handleWorkletMessage(message) {
    if (message.type === 'AUDIO_FRAME') {
      const chunks = this.chunker.push(message.samples);
      for (const chunk of chunks) {
        this.gemini?.sendPcm16Base64(chunk.base64);
      }
      return;
    }
    if (message.type === 'RMS') {
      chrome.runtime.sendMessage({ type: MESSAGE.AUDIO_LEVEL_UPDATE, rms: message.rms }).catch(() => undefined);
    }
  }

  handleServerContent(serverContent) {
    const subtitleState = this.transcriptBuffer.updateFromServerContent(serverContent);
    if (subtitleState) {
      chrome.runtime.sendMessage({ type: MESSAGE.SUBTITLE_UPDATE, payload: subtitleState }).catch(() => undefined);
    }
  }

  updateSettings(settings) {
    this.settings = settings;
    if (this.originalGain) this.originalGain.gain.value = settings.audio.originalVolume;
    if (this.player) {
      this.player.setVolume(settings.audio.interpretationVolume);
      this.player.setEnabled(settings.audio.playInterpretation);
    }
  }

  reportError(error, code = 'GEMINI_SESSION_ERROR') {
    this.debug('error', { code, message: error?.message || String(error), stack: error?.stack || '' });
    chrome.runtime.sendMessage({
      type: MESSAGE.SESSION_ERROR,
      error: {
        code,
        message: error?.message || String(error),
        at: Date.now()
      }
    }).catch(() => undefined);
  }

  async stop({ requestedByUser = true, silent = false } = {}) {
    this.debug('stop.begin', { requestedByUser, silent });
    this.stopRequested = requestedByUser || this.stopRequested;
    if (this.gemini) this.gemini.close();
    if (this.player) this.player.disconnect();
    if (this.workletNode) this.workletNode.disconnect();
    if (this.monitorGain) this.monitorGain.disconnect();
    if (this.originalGain) this.originalGain.disconnect();
    if (this.source) this.source.disconnect();
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close().catch(() => undefined);
    }

    this.audioContext = null;
    this.stream = null;
    this.source = null;
    this.originalGain = null;
    this.monitorGain = null;
    this.workletNode = null;
    this.chunker = null;
    this.player = null;
    this.gemini = null;
    this.transcriptBuffer = new TranscriptBuffer();
    if (!silent && requestedByUser) this.sendStatus('idle');
    this.debug('stop.complete', { requestedByUser, silent });
  }
}
