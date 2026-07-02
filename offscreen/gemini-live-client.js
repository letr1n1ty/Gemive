function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function looksLikeJson(text) {
  const trimmed = String(text || '').trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

async function websocketDataToText(data) {
  if (typeof data === 'string') return data;

  if (data instanceof Blob) {
    return await data.text();
  }

  if (data instanceof ArrayBuffer) {
    return new TextDecoder('utf-8').decode(new Uint8Array(data));
  }

  if (ArrayBuffer.isView(data)) {
    return new TextDecoder('utf-8').decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }

  return String(data);
}

function websocketDataToAudioBase64(data) {
  if (data instanceof ArrayBuffer) return bytesToBase64(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) return bytesToBase64(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return '';
}

export class GeminiLiveClient {
  constructor({ apiKey, model, targetLanguageCode, echoTargetLanguage, onServerContent, onAudio, onOpen, onReady, onClose, onError, onGoAway, onDebug }) {
    this.apiKey = apiKey;
    this.model = model || 'gemini-3.5-live-translate-preview';
    this.targetLanguageCode = targetLanguageCode || 'zh-Hant';
    this.echoTargetLanguage = Boolean(echoTargetLanguage);
    this.onServerContent = onServerContent;
    this.onAudio = onAudio;
    this.onOpen = onOpen;
    this.onReady = onReady;
    this.onClose = onClose;
    this.onError = onError;
    this.onGoAway = onGoAway;
    this.onDebug = onDebug;
    this.websocket = null;
    this.isReady = false;
    this.userClosed = false;
    this.goAwayReceived = false;
    this.pendingAudio = [];
    this.setupTimer = null;
    this.connectSettled = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(this.apiKey)}`;
      this.onDebug?.('connect.begin', { model: this.model, targetLanguageCode: this.targetLanguageCode });
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      this.websocket = ws;
      this.userClosed = false;
      this.goAwayReceived = false;
      this.connectSettled = false;

      const failSetup = (error) => {
        clearTimeout(this.setupTimer);
        this.setupTimer = null;
        if (this.connectSettled) return;
        this.connectSettled = true;
        reject(error);
      };

      const completeSetup = () => {
        if (this.isReady) return;
        clearTimeout(this.setupTimer);
        this.setupTimer = null;
        this.isReady = true;
        this.flushPendingAudio();
        this.onReady?.();
        if (!this.connectSettled) {
          this.connectSettled = true;
          resolve();
        }
      };

      ws.onopen = () => {
        this.onDebug?.('websocket.open');
        ws.send(JSON.stringify(this.createSetupMessage()));
        this.onDebug?.('setup.sent', this.createSetupMessage());
        this.onOpen?.();
        this.setupTimer = setTimeout(() => {
          if (!this.isReady) {
            const error = new Error('Gemini Live setup timed out. Check model access, API key, and network.');
            this.onError?.(error);
            try { ws.close(4000, 'setup timeout'); } catch {}
            failSetup(error);
          }
        }, 12000);
      };

      ws.onmessage = async (event) => {
        try {
          const response = await this.parseIncomingMessage(event.data);
          if (!response) return;
          if (response.setupComplete || response.setup_complete) {
            this.onDebug?.('setup.complete');
            completeSetup();
            return;
          }
          this.handleResponse(response);
        } catch (error) {
          const normalized = new Error(`Gemini Live message parse failed: ${error?.message || String(error)}`);
          if (!this.isReady) {
            this.onError?.(normalized);
            failSetup(normalized);
          } else {
            // After setup, a single malformed/non-JSON frame should not kill the session.
            this.onDebug?.('message.parseIgnored', { message: normalized.message });
          }
        }
      };

      ws.onerror = () => {
        this.onDebug?.('websocket.error');
        const error = new Error('Gemini Live WebSocket error. Check the API key, model access, and network.');
        this.onError?.(error);
        if (!this.isReady) failSetup(error);
      };

      ws.onclose = (event) => {
        this.onDebug?.('websocket.close', { code: event?.code, reason: event?.reason, wasClean: event?.wasClean });
        clearTimeout(this.setupTimer);
        this.setupTimer = null;
        const wasReady = this.isReady;
        this.isReady = false;
        if (!this.userClosed && !wasReady) {
          const reason = event.reason || 'no reason';
          const error = new Error(`Gemini Live closed before setup completed (${event.code || 'unknown'}): ${reason}`);
          this.onError?.(error);
          failSetup(error);
        }
        this.onClose?.(event);
      };
    });
  }

  async parseIncomingMessage(data) {
    if (typeof data === 'string') {
      return JSON.parse(data);
    }

    // Some Chrome/WebSocket combinations deliver Gemini JSON frames as Blob or ArrayBuffer.
    // Convert those frames to text first instead of doing JSON.parse(Blob), which produces
    // the misleading "[object Blob] is not valid JSON" failure.
    const text = await websocketDataToText(data);
    if (looksLikeJson(text)) {
      return JSON.parse(text);
    }

    // Defensive fallback: if a future endpoint sends raw PCM as a binary frame, play it only
    // after setup has completed. Current raw WebSocket docs describe JSON server messages,
    // so non-JSON binary before setup remains an error.
    if (this.isReady) {
      const rawAudio = websocketDataToAudioBase64(data);
      if (rawAudio) this.onAudio?.(rawAudio);
      return null;
    }

    const typeName = data?.constructor?.name || typeof data;
    throw new Error(`Expected Gemini JSON frame before setupComplete, received ${typeName}.`);
  }

  createSetupMessage() {
    return {
      setup: {
        model: `models/${this.model}`,
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        generationConfig: {
          responseModalities: ['AUDIO'],
          translationConfig: {
            targetLanguageCode: this.targetLanguageCode,
            echoTargetLanguage: this.echoTargetLanguage
          }
        },
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false
          }
        }
      }
    };
  }

  handleResponse(response) {
    const content = response.serverContent || response.server_content;
    if (content) {
      this.onServerContent?.(content);
      const parts = content.modelTurn?.parts || content.model_turn?.parts || [];
      for (const part of parts) {
        const data = part.inlineData?.data || part.inline_data?.data;
        if (data) this.onAudio?.(data);
      }
      return;
    }

    if (response.goAway || response.go_away) {
      const goAway = response.goAway || response.go_away;
      this.onDebug?.('server.goAway', goAway);
      if (this.goAwayReceived) return;
      this.goAwayReceived = true;

      if (this.onGoAway) {
        const handled = this.onGoAway(goAway);
        if (handled !== false) return;
      }

      // Fallback for clients that do not own a renewal path. Gemini may send GoAway
      // shortly before the session expires; close promptly so the server does not
      // abort with code 1008 because the client ignored it.
      if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
        this.userClosed = true;
        setTimeout(() => {
          try { this.websocket?.close(1000, 'Gemive closed after Gemini GoAway'); } catch {}
        }, 60);
      }
    }
  }

  sendPcm16Base64(base64) {
    const message = {
      realtimeInput: {
        audio: {
          data: base64,
          mimeType: 'audio/pcm;rate=16000'
        }
      }
    };

    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN || !this.isReady) {
      this.pendingAudio.push(message);
      if (this.pendingAudio.length > 30) this.pendingAudio.shift();
      return;
    }
    this.websocket.send(JSON.stringify(message));
  }

  flushPendingAudio() {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) return;
    const pending = this.pendingAudio.splice(0);
    for (const message of pending) {
      this.websocket.send(JSON.stringify(message));
    }
  }

  close(reason = 'Gemive session stopped') {
    this.userClosed = true;
    this.isReady = false;
    this.pendingAudio = [];
    clearTimeout(this.setupTimer);
    this.setupTimer = null;
    if (this.websocket && this.websocket.readyState <= WebSocket.OPEN) {
      this.websocket.close(1000, reason);
    }
    this.websocket = null;
  }
}
