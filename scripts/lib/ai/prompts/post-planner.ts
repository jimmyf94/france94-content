import fs from 'node:fs';
import path from 'node:path';

import { resolveRepoRelative } from './resolve-repo-path.js';

const DEFAULT_STABLE_REL = path.join('scripts', 'prompts', 'france94-post-candidates.txt');

export function resolvePostPlannerStablePromptPath(): string {
  const fromEnv = process.env.POST_CANDIDATE_PROMPT_PATH?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv);
  }
  return resolveRepoRelative(DEFAULT_STABLE_REL);
}

export function loadPostPlannerStablePrompt(): string {
  const promptPath = resolvePostPlannerStablePromptPath();
  let raw: string;
  try {
    raw = fs.readFileSync(promptPath, 'utf8');
  } catch {
    throw new Error(
      `Cannot read post candidate prompt: ${promptPath}. Set POST_CANDIDATE_PROMPT_PATH or add scripts/prompts/france94-post-candidates.txt.`,
    );
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`Post candidate prompt is empty: ${promptPath}`);
  }
  return trimmed;
}

export function buildPostPlannerPromptParts(params: {
  stableText: string;
  summaries: unknown[];
  dailyTarget: number;
  batchDays: number;
}): { stableSystemInstruction: string; dynamicText: string } {
  const dynamicPayload = {
    constraints: {
      batch_days: params.batchDays,
      daily_target: params.dailyTarget,
      asset_count: params.summaries.length,
    },
    assets: params.summaries,
  };
  const dynamicText = `Dynamic payload (JSON):\n${JSON.stringify(dynamicPayload, null, 2)}`;
  return {
    stableSystemInstruction: params.stableText.trim(),
    dynamicText,
  };
}
