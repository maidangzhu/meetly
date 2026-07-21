import { blobToBase64, createId, safeInvoke } from "./platform";
import type { ContextDocument, MeetingPerspective } from "./types";

export const MAX_DOCUMENT_CHARS = 10_000;
const SUPPORTED_TEXT_TYPES = [
  "text/",
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
];
const SUPPORTED_EXTENSIONS = [".txt", ".md", ".markdown", ".json", ".csv", ".tsv", ".yaml", ".yml"];
const PDF_EXTENSION = ".pdf";

export async function readDroppedContextFiles(
  files: File[],
  perspective: MeetingPerspective
): Promise<{ documents: ContextDocument[]; rejected: string[] }> {
  const documents: ContextDocument[] = [];
  const rejected: string[] = [];

  for (const file of files) {
    if (!isSupportedTextFile(file) && !isSupportedPdfFile(file)) {
      rejected.push(`${file.name} 暂不支持。请使用 PDF / txt / md / json / csv。`);
      continue;
    }

    try {
      const rawText = isSupportedPdfFile(file)
        ? await extractPdfText(file)
        : await file.text();
      const text = normalizeDocumentText(rawText);
      if (!text) {
        rejected.push(`${file.name} 没有可读取文本。`);
        continue;
      }

      documents.push({
        id: createId("doc"),
        name: file.name,
        kind: inferDocumentKind(file.name, perspective),
        text: text.slice(0, MAX_DOCUMENT_CHARS),
        size: file.size,
        createdAt: Date.now(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rejected.push(`${file.name} 读取失败：${message}`);
    }
  }

  return { documents, rejected };
}

export function summarizeContextDocuments(documents: ContextDocument[]) {
  if (documents.length === 0) {
    return "";
  }

  return documents
    .map((document, index) => {
      const preview = document.text.replace(/\s+/g, " ").trim().slice(0, MAX_DOCUMENT_CHARS);
      return [
        `Document ${index + 1}`,
        `id: ${document.id}`,
        `name: ${document.name}`,
        `kind: ${document.kind}`,
        `content preview: ${preview}`,
      ].join("\n");
    })
    .join("\n\n");
}

export function contextDocumentRoleLabel(perspective: MeetingPerspective) {
  return perspective === "candidate" ? "简历 / 个人背景" : "候选人简历 / 面试资料";
}

export function supportedContextDocumentLabel() {
  return "PDF / txt / md / json / csv";
}

function isSupportedTextFile(file: File) {
  const lowerName = file.name.toLowerCase();
  return (
    SUPPORTED_TEXT_TYPES.some((type) => file.type.startsWith(type) || file.type === type) ||
    SUPPORTED_EXTENSIONS.some((extension) => lowerName.endsWith(extension))
  );
}

function isSupportedPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(PDF_EXTENSION);
}

async function extractPdfText(file: File) {
  const dataBase64 = await blobToBase64(file);
  const text = await safeInvoke<string>("extract_pdf_text", {
    fileName: file.name,
    dataBase64,
  });

  if (!text) {
    throw new Error("PDF 解析只能在 Meetly 桌面运行时使用。");
  }

  return text;
}

function inferDocumentKind(name: string, perspective: MeetingPerspective) {
  const lowerName = name.toLowerCase();
  if (
    perspective === "candidate" ||
    lowerName.includes("resume") ||
    lowerName.includes("cv") ||
    lowerName.includes("简历")
  ) {
    return "resume";
  }
  return "reference";
}

function normalizeDocumentText(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
}
