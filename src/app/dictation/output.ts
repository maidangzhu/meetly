export function chooseDictationOutput(rawText: string, polishedText?: string | null) {
  const polished = polishedText?.trim();
  return polished || rawText;
}

export function classifyDictationDelivery(
  output: { outcome: "pasted" | "copied" | "failed" }
): "completed" | "copied" | "delivery_failed" {
  if (output.outcome === "pasted") return "completed";
  if (output.outcome === "copied") return "copied";
  return "delivery_failed";
}
