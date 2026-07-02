# Privacy Policy for Gemive

*Last updated: July 2, 2026*

Gemive processes audio and translation data entirely on your device and through the Gemini API. This policy explains how data is handled.

## Data collection

Gemive collects and processes the following data:

- **Tab audio**: Captured from the current Chrome tab via `chrome.tabCapture` and streamed to Gemini Live Translate for real-time translation. Audio is not stored or transmitted anywhere else.
- **Gemini API keys**: Stored locally in `chrome.storage.local`. Never sent anywhere except the configured Gemini API endpoint.
- **Translation transcripts**: Stored locally in `chrome.storage.local`. Export happens locally through the Chrome Downloads API.

## Data storage

All data is stored in Chrome's local storage (`chrome.storage.local`) on your device:

- Settings and API keys
- Translation transcripts
- Debug logs (API-key-like values are redacted before persistence)

## Data sharing

- **Audio data** is sent exclusively to the Gemini API endpoint you configure for live translation.
- **No telemetry, analytics, or tracking** is included in Gemive.
- **No data** is sent to any server other than the Gemini API.
- **No third-party services** are used beyond the Gemini API.

## User control

- You can delete your API keys and transcripts at any time through the extension settings.
- Transcript export creates a local Markdown file through the Chrome Downloads API.
- You can uninstall Gemive at any time through Chrome's extension manager, which removes all stored data.

## Permissions

| Permission | Purpose |
| --- | --- |
| `tabCapture` | Capture current tab audio for translation |
| `offscreen` | Run audio processing in a background document |
| `storage` | Save settings, transcripts, and debug logs locally |
| `activeTab` | Identify the active tab for popup actions |
| `scripting` | Inject the subtitle overlay |
| `downloads` | Export transcripts as Markdown files |
| `tabs` | Track active session tab and URL changes |
| `<all_urls>` | Allow subtitle overlay injection on web pages |

## Contact

For questions about this privacy policy, open an issue on the Gemive repository.
