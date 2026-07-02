# Gemive architecture

## Runtime split

- `background/service-worker.js`
  - Owns session state.
  - Creates offscreen document.
  - Calls `chrome.tabCapture.getMediaStreamId()` after user action.
  - Injects or wakes the overlay content script.
  - Coordinates URL-change restart, inactivity shutdown, transcript persistence, and debug logs.

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

## Typed contracts

Gemive is still loaded directly as browser-readable JavaScript. TypeScript is currently used as a contract and migration layer, not as a build pipeline.

- `core/types.ts`
  - Shared data shapes for settings, sessions, subtitles, transcripts, and common runtime state.
- `core/runtime-messages.ts`
  - Discriminated runtime message contract for background, offscreen, popup, options, and content boundaries.
- `background/background-types.ts`
  - Background service worker contracts for session state, navigation restart requests, debug logs, stop/start options, and transcript recording state.
- `offscreen/audio-types.ts`
  - Audio pipeline contracts for router payloads, AudioWorklet messages, PCM chunks, player options, and Gemini Live client callbacks.

Runtime JavaScript should continue to use `core/message-types.js` until the project switches to a real `src/` to `dist/` build.

## Background service worker lifecycle

The background worker is the session coordinator. It should avoid ad-hoc state mutation and route session changes through a small set of helpers:

- `createIdleSession()` defines the canonical empty session shape.
- `updateSession()` validates status, tab id, URL, and error fields before mutating the in-memory session.
- `setStatus()` updates state, writes debug logs, and relays status to runtime listeners and the active overlay tab.
- `createNavigationRestart()` normalizes pending URL-change restart requests before they enter the debounce queue.
- `getMessagePayload()` prevents message handlers from assuming every runtime message has a valid object payload.

The worker owns these long-running flows:

- Start/stop session orchestration.
- Offscreen document creation and cleanup.
- Existing capture release before acquiring a new stream id.
- URL-change restart while keeping the overlay alive.
- 10-minute speech inactivity shutdown.
- Transcript snapshot persistence.
- Sanitized debug log persistence.

## Settings normalization

All settings read or written through `storage/settings-store.js` pass through `normalizeSettings()`.

This normalization layer clamps user-controlled or persisted values before saving them back to `chrome.storage.local`:

- Audio volume: `0` to `1`
- Subtitle font size and max lines
- Floating window size, opacity, blur, radius, and position
- Advanced audio chunk and jitter buffer values
- Locale, provider, model, color, and transcript folder fields

This protects the extension from stale settings, older versions, malformed patches, and manually edited local storage.

## Audio pipeline lifecycle

The offscreen audio path is designed to fail closed:

- `AudioRouter.start()` validates stream id, tab id, settings, and API keys before opening capture.
- If startup fails after partially creating resources, `AudioRouter` stops and releases the Gemini client, player, worklet node, gain nodes, media stream tracks, and `AudioContext`.
- `Pcm16Chunker` clamps sample rates and chunk duration, ignores invalid sample frames, and normalizes non-finite samples before encoding.
- `Pcm16Player` clamps sample rate, jitter buffer, and volume, ignores malformed audio frames, and resets runaway playback scheduling.
- `GeminiLiveClient` bounds pending audio messages before setup completes and clears pending audio on setup failure or close.

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
