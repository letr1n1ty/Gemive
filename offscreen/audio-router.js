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

function requiresGeminiReconnect(previousSettings, nextSettings) {
  if (!previousSettings || !nextSettings) return false;
  return previousSettings.language?.targetLanguageCode !== nextSettings.language?.targetLanguageCode
    || Boolean(previousSettings.language?.echoTargetLanguage) !== Boolean(nextSettings.language?.echoTargetLanguage)
    || previousSettings.api?.model !== nextSettings.api?.model
    || previousSettings.api?.apiKey !== nextSettings.api?.apiKey;
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
    this.warmupGemini = null;
    this.transcriptBuffer = new TranscriptBuffer();
    this.settings = null;
    this.activeGeminiSettings = null;
    this.tabId = null;
    this.stopRequested = false;
    this.translationEpoch = 0;
    this.switchToken = 0;
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

  createGeminiClient(settings, epoch) {
    let client = null;
    const isActiveClient = () => this.gemini === client && this.translationEpoch === epoch;
    const isWarmupClient = () => this.warmupGemini === client;

    client = new GeminiLiveClient({
      apiKey: pickRandomApiKey(settings.api.apiKey),
      model: settings.api.model,
      targetLanguageCode: settings.language.targetLanguageCode,
      echoTargetLanguage: settings.language.echoTargetLanguage,
      onServerContent: (serverContent) => {
        if (!isActiveClient()) return;
        this.handleServerContent(serverContent);
      },
      onAudio: (base64) => {
        if (!isActiveClient()) return;
        this.player?.playBase64(base64);
      },
      onOpen: () => {
        this.debug(isWarmupClient() ? 'gemini.warmup.open' : 'gemini.open');
        if (isActiveClient()) this.sendStatus('connecting');
      },
      onReady: () => {
        this.debug(isWarmupClient() ? 'gemini.warmup.ready' : 'gemini.ready');
        if (isActiveClient()) this.sendStatus('translating');
      },
      onClose: (event) => {
        if (!this.stopRequested && event?.code !== 1000 && isActiveClient()) {
          this.reportError(new Error(`Gemini connection closed (${event?.code || 'unknown'}): ${event?.reason || 'no reason'}`));
        } else if (!this.stopRequested && event?.code !== 1000) {
          this.debug('gemini.nonActive.close', { code: event?.code, reason: event?.reason || '' });
        }
      },
      onError: (error) => {
        if (isActiveClient()) this.reportError(error);
        else this.debug('gemini.nonActive.error', { message: error?.message || String(error) });
      },
      onDebug: (event, data) => this.debug(`gemini.${event}`, data)
    });

    return client;
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

    this.translationEpoch += 1;
    this.activeGeminiSettings = settings;
    this.gemini = this.createGeminiClient(settings, this.translationEpoch);

    this.workletNode.port.onmessage = (event) => this.handleWorkletMessage(event.data);
    this.source.connect(this.workletNode);
    await this.gemini.connect();
    this.debug('start.complete');
  }

  handleWorkletMessage(message) {
    if (message.type === 'AUDIO_FRAME') {
      const chunks = this.chunker.push(message.samples);
      const clients = [this.gemini, this.warmupGemini].filter((client, index, list) => client && list.indexOf(client) === index);
      for (const chunk of chunks) {
        for (const client of clients) client.sendPcm16Base64(chunk.base64);
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

  async updateSettings(settings) {
    const previousSettings = this.settings;
    const previousGeminiSettings = this.activeGeminiSettings || previousSettings;
    const shouldReconnectGemini = this.gemini && requiresGeminiReconnect(previousGeminiSettings, settings);

    this.settings = settings;
    if (this.originalGain) this.originalGain.gain.value = settings.audio.originalVolume;
    if (this.player) {
      this.player.setVolume(settings.audio.interpretationVolume);
      this.player.setEnabled(settings.audio.playInterpretation);
    }

    if (shouldReconnectGemini) await this.switchGeminiClient(settings, previousGeminiSettings);
  }

  async switchGeminiClient(settings, previousSettings) {
    const previousClient = this.gemini;
    if (!previousClient) return;

    const token = ++this.switchToken;
    const nextEpoch = this.translationEpoch + 1;
    if (this.warmupGemini) {
      this.warmupGemini.close('Gemive translation switch superseded');
      this.warmupGemini = null;
    }

    const nextClient = this.createGeminiClient(settings, nextEpoch);
    this.warmupGemini = nextClient;
    this.debug('translation.switch.begin', {
      fromTargetLanguageCode: previousSettings?.language?.targetLanguageCode || '',
      toTargetLanguageCode: settings?.language?.targetLanguageCode || '',
      modelChanged: previousSettings?.api?.model !== settings?.api?.model,
      apiKeysChanged: previousSettings?.api?.apiKey !== settings?.api?.apiKey
    });
    this.sendStatus('translating', {
      languageSwitching: true,
      targetLanguageCode: settings?.language?.targetLanguageCode || ''
    });

    try {
      await nextClient.connect();
      if (token !== this.switchToken || this.warmupGemini !== nextClient || this.stopRequested) {
        nextClient.close('Gemive translation switch superseded');
        return;
      }

      this.translationEpoch = nextEpoch;
      this.gemini = nextClient;
      this.activeGeminiSettings = settings;
      this.warmupGemini = null;
      this.transcriptBuffer = new TranscriptBuffer();
      this.player?.stop();
      previousClient.close('Gemive translation language switched');
      this.debug('translation.switch.complete', {
        targetLanguageCode: settings?.language?.targetLanguageCode || '',
        epoch: this.translationEpoch
      });
      this.sendStatus('translating', {
        languageSwitching: false,
        targetLanguageCode: settings?.language?.targetLanguageCode || ''
      });
    } catch (error) {
      if (this.warmupGemini === nextClient) this.warmupGemini = null;
      nextClient.close('Gemive translation switch failed');
      this.debug('translation.switch.failed', {
        targetLanguageCode: settings?.language?.targetLanguageCode || '',
        message: error?.message || String(error)
      });
      this.sendStatus('translating', {
        languageSwitching: false,
        languageSwitchError: error?.message || String(error),
        targetLanguageCode: previousSettings?.language?.targetLanguageCode || ''
      });
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
    this.switchToken += 1;
    this.stopRequested = requestedByUser || this.stopRequested;
    if (this.warmupGemini) this.warmupGemini.close('Gemive session stopped');
    if (this.gemini) this.gemini.close('Gemive session stopped');
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
    this.warmupGemini = null;
    this.activeGeminiSettings = null;
    this.transcriptBuffer = new TranscriptBuffer();
    if (!silent && requestedByUser) this.sendStatus('idle');
    this.debug('stop.complete', { requestedByUser, silent });
  }
}
