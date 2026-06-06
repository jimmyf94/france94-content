import { jsonrepair } from 'jsonrepair';

function stripCodeFences(text: string): string {
  let s = text.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/im;
  const m = s.match(fence);
  if (m?.[1]) {
    s = m[1].trim();
  }
  return s;
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function jsonSnippetAt(text: string, position: number, radius = 120): string {
  const start = Math.max(0, position - radius);
  const end = Math.min(text.length, position + radius);
  return text.slice(start, end);
}

function assertJsonObject(parsed: unknown): Record<string, unknown> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Parsed JSON is not an object');
  }
  return parsed as Record<string, unknown>;
}

/** Parse model output; repair pass fixes common LLM JSON syntax issues. */
export function parseGeminiJsonObject(rawText: string): Record<string, unknown> {
  const trimmed = stripCodeFences(rawText.trim());
  const attempts: Array<() => unknown> = [
    () => JSON.parse(trimmed),
    () => {
      const extracted = extractJsonObject(trimmed);
      if (!extracted) throw new Error('repair pass found no JSON object');
      return JSON.parse(extracted);
    },
    () => JSON.parse(jsonrepair(trimmed)),
    () => {
      const extracted = extractJsonObject(trimmed);
      if (!extracted) throw new Error('repair pass found no JSON object');
      return JSON.parse(jsonrepair(extracted));
    },
  ];

  let lastErr: unknown;
  for (const attempt of attempts) {
    try {
      return assertJsonObject(attempt());
    } catch (e) {
      lastErr = e;
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  const posMatch = msg.match(/position (\d+)/i);
  const pos = posMatch ? Number(posMatch[1]) : null;
  const snippet =
    pos != null && Number.isFinite(pos)
      ? `\nNear error (char ${pos}): ...${jsonSnippetAt(trimmed, pos)}...`
      : '';
  throw new SyntaxError(`Model output was not valid JSON: ${msg}${snippet}`);
}
