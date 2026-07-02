export function createEmptySubtitleState() {
  return {
    translation: { text: '', languageCode: '', isFinal: false, updatedAt: 0 },
    source: { text: '', languageCode: '', isFinal: false, updatedAt: 0 },
    timing: { receivedAt: Date.now(), displayUntil: Date.now() + 3000 }
  };
}
