import { createHash } from 'node:crypto';

/** Short stable suffix for Gemini explicit cache keys when prompt body changes. */
export function stablePromptCacheSuffix(stableInstruction: string): string {
  const h = createHash('sha256').update(stableInstruction, 'utf8').digest('hex');
  return h.slice(0, 12);
}
