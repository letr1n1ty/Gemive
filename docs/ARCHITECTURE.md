# Gemive architecture

## Runtime split

- `background/service-worker.js`
  - Owns session state.
  - Creates offscreen document.
  - Calls `chrome.tabCapture.getMediaStreamId()` after user action.
  - Injects or wakes the overlay content script.

- `offscreen/offscreen.js`
  - Receives stream ID.
  - Calls `getUserMedia()` with `chromeMediaSource: "tab"`.
  - Creates `AudioContext`.
  - Routes original tab audio back to speaker.
  - Starts `AudioWorklet`.
  - Streams PCM16 chunks to Gemini Live Translate.
  - Plays returned 24kHz PCM16 interpretation audio.

- `content/subtitle-overlay.js`
  - Injects a Shadow DOM floating subtitle window.
  - Renders translated subtitle above source subtitle.
  - Supports drag, resize, style updates, and fullscreen relocation.

- `popup/`
  - Start/Stop session.
  - Target language selection.
  - Prominent interpretation toggle.
  - Original and interpretation volume controls.

- `options/`
  - API key.
  - Full language selection.
  - Subtitle style controls.
  - Audio defaults.
  - Privacy controls.

## Audio flow

```text
Chrome tab audio
  -> chrome.tabCapture stream ID
  -> offscreen getUserMedia
  -> AudioContext MediaStreamAudioSourceNode
  -> originalGain -> AudioContext.destination
  -> AudioWorklet -> PCM16Chunker -> Gemini Live WebSocket
  -> input/output transcripts -> overlay
  -> output PCM16 24kHz -> jitter buffer -> speaker
```

## MVP defaults

- Target language: `zh-Hant`
- Original audio volume: `0.75`
- Interpretation volume: `0.35`
- Interpretation playback: enabled
- Transcript saving: disabled
- Chunk size: 100ms
- Jitter buffer: 300ms
