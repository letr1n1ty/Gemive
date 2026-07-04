# Gemive test plan

## Local install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Load unpacked extension from the `gemive` folder.
4. Open Gemive Options.
5. Enter Gemini API key.

## Phase 1: settings

- Save API key.
- Change target language.
- Change subtitle font size and color.
- Change original and interpretation volume.
- Toggle transcript saving.
- Reopen options and confirm persistence.

## Phase 2: overlay

- Open a normal web page.
- Click Gemive popup and Start.
- Press `Option+Shift+T` on macOS and confirm translation can also start from the shortcut.
- Confirm overlay appears.
- Confirm translated subtitle is above source subtitle.
- Drag overlay.
- Resize overlay.
- Refresh page and confirm extension can show overlay again.

## Phase 3: fullscreen

- Open YouTube.
- Start Gemive.
- Enter normal player mode, theater mode, and fullscreen mode.
- Confirm overlay remains visible in fullscreen.
- Exit fullscreen and confirm overlay remains usable.

## Phase 4: tab audio

- Open YouTube or another tab with audio.
- Start Gemive.
- Confirm original audio remains audible.
- Move original volume slider in popup.
- Confirm original volume changes.
- Stop Gemive.
- Confirm the capture indicator disappears and audio remains normal.

## Phase 5: Gemini Live Translate

- Start a session with a valid API key.
- Confirm source transcript appears.
- Confirm translated transcript appears above source transcript.
- Confirm interpretation audio plays by default.
- Toggle interpretation off in popup.
- Confirm interpretation stops or no new interpretation audio plays.

## Known limitations in this scaffold

- It has not been loaded in a real Chrome runtime inside this environment.
- Full language list is manually mirrored from the official Gemini Live Translate documentation.
- Audio/video page compatibility still needs browser QA.
- The PCM resampler is a simple linear block resampler, good for MVP validation but not final DSP quality.
