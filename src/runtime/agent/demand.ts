import type { TranscriptSegment } from "../../app/types";
import { createSttQuestionWake, type WakeEvent } from "./wake";

const CHINESE_QUESTION_KEYWORDS = [
  "吗",
  "呢",
  "什么",
  "为什么",
  "怎么",
  "怎样",
  "如何",
  "能不能",
  "可不可以",
  "有没有",
  "多少",
  "哪",
];

const ENGLISH_QUESTION_KEYWORDS = [
  "what",
  "why",
  "how",
  "can you",
  "could you",
  "would you",
  "tell me about",
  "walk me through",
  "explain",
  "describe",
];

export function detectSttWake(segment: TranscriptSegment): WakeEvent | null {
  const text = segment.text.trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  const isQuestion =
    text.endsWith("?") ||
    text.endsWith("？") ||
    CHINESE_QUESTION_KEYWORDS.some((keyword) => text.includes(keyword)) ||
    ENGLISH_QUESTION_KEYWORDS.some((keyword) => lower.includes(keyword));

  return isQuestion ? createSttQuestionWake(text) : null;
}
