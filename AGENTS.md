# AGENTS.md

This file defines the working rules for AI coding agents modifying Gemive.

## Project identity

Gemive is a Chrome Manifest V3 extension for live translated subtitles and interpretation audio on the current Chrome tab.

The product direction is intentionally narrow:

```txt
one active translation session
current-tab audio capture
floating subtitle overlay
optional launcher-only collapse
Markdown transcript export
```

Do not redesign it into a multi-session or multi-tab concurrent translation system unless the user explicitly asks for that architecture change.

## Ground rules

- Prefer small, targeted patches.
- Preserve existing runtime behavior unless the task explicitly changes it.
- Do not introduce a build step, bundler, framework, or TypeScript migration without explicit approval.
- Do not move files casually. The current structure is part of the handoff contract.
- Keep API keys, tokens, transcripts, and debug logs out of committed examples.
- Never hard-code a real Gemini API key.
- Keep UI strings localized in Traditional Chinese, Simplified Chinese, and English.
- Keep user-facing terminology consistent with existing `core/i18n.js` keys.
- Run syntax checks before packaging.

## Technical stack

```txt
Chrome Manifest V3
Vanilla JavaScript ES modules
No compile step
No bundler
No framework
No TypeScript
```

## Main paths

```txt
manifest.json
background/service-worker.js
content/subtitle-overlay.js
core/settings.js
core/i18n.js
core/language-registry.js
core/message-types.js
core/transcript-buffer.js
offscreen/audio-router.js
offscreen/gemini-live-client.js
offscreen/pcm16-encoder.js
offscreen/pcm16-player.js
options/options.html
options/options.css
options/options.js
popup/popup.html
popup/popup.css
popup/popup.js
storage/settings-store.js
storage/transcript-store.js
scripts/check-syntax.mjs
scripts/package-zip.mjs
```

## Default behavior to preserve

- Initial interface language follows Chrome UI language:
  - Traditional Chinese Chrome → `zh-Hant`
  - Simplified Chinese Chrome → `zh-Hans`
  - anything else → `en`
- Initial target language follows the same rule.
- Transcript saving is enabled by default.
- Original audio volume defaults to `0.75`.
- Interpretation audio volume defaults to `0.35`.
- Auto-collapse to logo is disabled by default.
- If auto-collapse is enabled, the overlay close control appears as `-` and collapses to launcher-only mode.
- If auto-collapse is disabled, the overlay close control appears as `X` and hides/closes the overlay normally.
- Pressing stop or pause stops translation only; it must not collapse the overlay.
- In launcher-only mode, only the logo should remain visible.
- A short click on the logo expands the overlay.
- Dragging the logo moves it and must not accidentally expand the overlay.

## Session model

Gemive supports a single active session.

Expected behavior:

```txt
No active session
→ popup shows Start

Current tab is translating
→ popup shows translating state and Stop is available

Another tab is translating
→ popup shows Switch to this tab
→ switching stops/restarts the single active session for the new tab
```

Do not create `Map<tabId, TranslationSession>` or parallel tab sessions unless explicitly requested.

## Gemini Live setup contract

The setup payload must keep transcription fields at the `setup` root level:

```js
{
  setup: {
    model: 'models/gemini-3.5-live-translate-preview',
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    generationConfig: {
      responseModalities: ['AUDIO'],
      translationConfig: {
        targetLanguageCode: 'en',
        echoTargetLanguage: false
      }
    },
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: false
      }
    }
  }
}
```

Do not move `inputAudioTranscription` or `outputAudioTranscription` into `generationConfig`.

## Audio pipeline

The intended audio flow is:

```txt
chrome.tabCapture
→ offscreen document
→ AudioContext
→ original audio passthrough to destination
→ AudioWorklet
→ mono downmix
→ 16 kHz resample
→ PCM16 little-endian chunks
→ Gemini Live WebSocket
```

Gemini audio output is expected as 24 kHz PCM16 and is played through `pcm16-player.js`.

## Transcript rules

- Save transcripts only through `storage/transcript-store.js`.
- Export transcripts through the Chrome Downloads API.
- Do not attempt silent writes to arbitrary file system paths.
- Markdown export should remain readable and portable.
- Avoid changing transcript schema without also updating export code and docs.

## Overlay rules

The overlay is a content script with Shadow DOM. Be careful with CSS specificity because browser defaults and component-level display styles can override `hidden` attributes.

Launcher-only collapse must hide the subtitle card completely. It should not shrink the card into a smaller window.

When adding controls:

- Avoid blocking text selection inside subtitle content.
- Preserve drag and resize behavior.
- Preserve fullscreen relocation behavior.
- Keep the visual style aligned with Catppuccin Mocha and iOS dark grouped surfaces.

## Localization rules

When adding or changing UI text:

1. Add or update the key in `core/i18n.js` for all three UI locales.
2. Keep Traditional Chinese, Simplified Chinese, and English semantically equivalent.
3. Do not leave mixed-language labels in the UI.
4. Avoid creating one-off hard-coded strings in popup, options, or overlay code.

## API key handling

Gemive supports comma-separated API keys.

Rules:

- Preserve comma-separated parsing.
- Validate keys without logging full keys.
- Redact API-key-like strings in debug logs.
- Do not add telemetry.
- Do not send keys anywhere except the configured Gemini API endpoint.

## Commands

Run syntax checks:

```bash
npm run check
```

Package zip:

```bash
npm run zip
```

Direct equivalents:

```bash
node scripts/check-syntax.mjs
node scripts/package-zip.mjs
```

## Manual test checklist

After a non-trivial change, test at least:

1. Load unpacked extension in Chrome.
2. Open settings and verify localization.
3. Verify default language behavior on a clean install.
4. Save one or more Gemini API keys.
5. Start translation on a tab with audio.
6. Stop translation and confirm the overlay does not collapse.
7. Enable auto-collapse and click `-`; confirm only the logo remains.
8. Short-click the logo; confirm the full overlay expands.
9. Drag the logo; confirm it moves and does not expand.
10. Switch translation to another tab.
11. Navigate within the active tab and confirm the session restarts capture without losing the overall session flow.
12. Export transcripts as Markdown.

## Packaging rules

When producing a user-facing zip:

- Package the extension root contents, not the parent folder.
- Keep `README.md` and `AGENTS.md` in the root of the zip.
- Exclude OS junk, temporary folders, logs, and local test artifacts.
- Re-run syntax checks before final packaging.
