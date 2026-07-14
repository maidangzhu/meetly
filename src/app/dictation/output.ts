export function chooseDictationOutput(rawText: string, polishedText?: string | null) {
  const polished = polishedText?.trim();
  return polished || rawText;
}
