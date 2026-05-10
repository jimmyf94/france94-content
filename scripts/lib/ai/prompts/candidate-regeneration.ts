import fs from 'node:fs';
import path from 'node:path';

import { resolveRepoRelative } from './resolve-repo-path.js';

const DEFAULT_STABLE_REL = path.join('scripts', 'prompts', 'france94-post-candidate-rewrite.txt');

export function resolveCandidateRegenerationStablePromptPath(): string {
  const fromEnv = process.env.POST_CANDIDATE_REWRITE_PROMPT_PATH?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv);
  }
  return resolveRepoRelative(DEFAULT_STABLE_REL);
}

export function loadCandidateRegenerationStablePrompt(): string {
  const promptPath = resolveCandidateRegenerationStablePromptPath();
  let raw: string;
  try {
    raw = fs.readFileSync(promptPath, 'utf8');
  } catch {
    throw new Error(
      `Cannot read post candidate rewrite prompt: ${promptPath}. Set POST_CANDIDATE_REWRITE_PROMPT_PATH or add scripts/prompts/france94-post-candidate-rewrite.txt.`,
    );
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`Post candidate rewrite prompt is empty: ${promptPath}`);
  }
  return trimmed;
}

export function buildCandidateRegenerationDynamicPayload(params: {
  reviewerNotes: string;
  candidate: unknown;
  assetSummaries: unknown;
}): string {
  const payload = {
    reviewer_notes: params.reviewerNotes,
    candidate: params.candidate,
    asset_summaries: params.assetSummaries,
  };
  return `Dynamic payload (JSON):\n${JSON.stringify(payload, null, 2)}`;
}
