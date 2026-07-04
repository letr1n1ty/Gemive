# <img src="assets/icon-48.png" width="36" height="36" alt="Gemive logo" style="vertical-align: middle;"> Gemive

[English](README.md) | [简体中文](README.zh-Hans.md) | [繁體中文](README.zh-Hant.md)

Gemive is a Chrome Manifest V3 extension for live translated subtitles and interpretation audio on the current Chrome tab.

It captures tab audio, streams PCM audio to Gemini Live Translate, renders a floating subtitle window, plays translated interpretation audio, and can export saved transcripts as Markdown.

## Previews

<p align="center">
  <img src="assets/previews/preview-1.png" width="800" alt="Gemive Live Subtitles Preview 1" />
</p>
<p align="center">
  <img src="assets/previews/preview-2.png" width="800" alt="Gemive Live Subtitles Preview 2" />
</p>
<p align="center">
  <img src="assets/previews/preview-3.png" width="800" alt="Gemive Live Subtitles Preview 3" />
</p>

## Features

- Live subtitles for the current Chrome tab
- Source transcript and translated transcript display
- Gemini Live Translate WebSocket integration
- Translated interpretation audio playback
- Original tab audio passthrough after `chrome.tabCapture`
- Floating overlay with drag, resize, style controls, and fullscreen relocation
- Optional launcher-only collapse mode with draggable logo launcher
- Single active translation session with tab switching support
- Transcript saving to Chrome local storage
- Markdown transcript export through the Chrome Downloads API
- Catppuccin Mocha inspired dark UI
- Traditional Chinese, Simplified Chinese, and English interface localization
- Multiple Gemini API keys separated by commas, with random key selection at session start

## How it works

```txt
Current Chrome tab audio
→ chrome.tabCapture
→ offscreen document
→ AudioContext passthrough
→ AudioWorklet downmix + resample
→ PCM16 16 kHz audio chunks
→ Gemini Live Translate
→ subtitle overlay + interpretation audio playback
→ optional Markdown transcript export
```

The extension keeps one active translation session at a time. If another tab is already translating, the popup offers a switch action instead of starting multiple parallel sessions.

## Requirements

- Google Chrome or a Chromium browser with Manifest V3 support
- A Gemini API key with access to the configured live translation model
- A normal web page tab with playable audio

The default model is configured in `core/settings.js`:

```js
model: 'gemini-3.5-live-translate-preview'
```

Model availability depends on your Gemini API access and may change over time.

## Install locally

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the project folder.
6. Open **Gemive Settings**.
7. Add your Gemini API key.
8. Open a tab with audio.
9. Click the Gemive toolbar icon and start translation from the popup, or press `Option+Shift+T` on macOS.

## API keys

To use the Gemini API, go to Google AI Studio and sign in with your Google account. Open the API Keys page. New accounts usually get a free project and API key automatically. If you don't see one, just click Create API key to make one.

Gemive supports one or more Gemini API keys in the settings page.

Use comma-separated keys:

```txt
key_1, key_2, key_3
```

At session start, Gemive chooses one available key randomly. This is useful when testing across multiple development keys, but it does not bypass provider-side quota, policy, or billing limits.

## Transcript export

Transcript saving is enabled by default.

Gemive uses a hybrid transcript storage model. Chrome local storage is the short-term cache and crash-recovery workspace; Markdown files created through the Chrome Downloads API are the long-term portable record.

```txt
Downloads/Gemive/Transcripts/YYYY-MM-DD/<timestamp>-<tab-title>-session.md
```

The local transcript cache keeps recent entries with schema and export-status metadata, and it prunes old entries that have already been exported when the cache grows too large. Chrome extensions cannot silently write to arbitrary local file system paths, so the export folder is a relative path under Downloads.

## Privacy and data flow

Gemive processes audio locally until it sends encoded audio chunks to the configured Gemini Live Translate endpoint. API keys and the recent transcript cache are stored in `chrome.storage.local`; exported transcript Markdown files are written under Downloads through the Chrome Downloads API.

Debug logs are also stored locally and redact API-key-like values before persistence.

Before publishing or distributing your own build, review:

- `manifest.json` permissions
- Gemini API usage and billing implications
- Whether transcript saving should remain enabled for your intended users
- Your repository license and privacy disclosure

## Permissions

| Permission | Why it is used |
| --- | --- |
| `tabCapture` | Capture current tab audio |
| `offscreen` | Run AudioContext, WebSocket, and playback outside visible pages |
| `storage` | Save settings, transcripts, and debug logs |
| `activeTab` | Resolve the active tab for popup actions |
| `scripting` | Inject or re-open the subtitle overlay |
| `downloads` | Export transcripts as Markdown files |
| `tabs` | Track active session tab and URL changes |
| `<all_urls>` | Allow overlay injection on ordinary web pages |

## Development

This project intentionally has no build step.

```bash
npm install
npm run check
npm run zip
```

Equivalent direct commands:

```bash
node scripts/check-syntax.mjs
node scripts/package-zip.mjs
```

## Project structure

```txt
assets/                 Extension icons and preview screenshots
background/             MV3 service worker and session orchestration
content/                Floating subtitle overlay
core/                   Shared settings, i18n, message types, transcript buffer
options/                Full settings page
popup/                  Toolbar popup controls
storage/                Settings and transcript persistence
offscreen/              Audio capture, encoding, Gemini client, playback
scripts/                Syntax check and packaging helpers
docs/                   Architecture notes and manual test plan
```

## Known limitations

- Only one active translation session is supported at a time.
- Restricted pages such as `chrome://` pages cannot run the content overlay.
- Tab audio capture changes the browser audio path; Gemive routes captured audio back to the speaker through `AudioContext`.
- Long-running translation depends on tab audio availability, Gemini connection stability, and provider-side limits.
- Transcript export is constrained by Chrome Downloads API behavior.
