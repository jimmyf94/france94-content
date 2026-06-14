import fs from 'node:fs';
import path from 'node:path';

import { resolveRepoRelative } from './resolve-repo-path.js';

export const STABLE_CONTEXT_KEYS = [
  'context_user_voice',
  'context_mission',
  'context_editorial_rules',
] as const;

export const TASK_PROMPT_KEYS = [
  'task_generate_candidate',
  'task_regenerate_with_notes',
  'task_spawn_candidate_variant',
  'task_caption_rewrite',
  'task_story_sequence',
  'task_reel_caption_overlay',
  'task_collision_check',
  'task_reel_reasoning',
  'task_reel_hook_lab',
] as const;

export type StableContextKey = (typeof STABLE_CONTEXT_KEYS)[number];
export type TaskPromptKey = (typeof TASK_PROMPT_KEYS)[number];

const CONTEXT_FILE_REL: Record<StableContextKey, string> = {
  context_user_voice: path.join('prompts', 'context', 'user_voice.md'),
  context_mission: path.join('prompts', 'context', 'mission.md'),
  context_editorial_rules: path.join('prompts', 'context', 'editorial_rules.md'),
};

const TASK_FILE_REL: Record<TaskPromptKey, string> = {
  task_generate_candidate: path.join('prompts', 'tasks', 'generate_candidate.md'),
  task_regenerate_with_notes: path.join('prompts', 'tasks', 'regenerate_with_notes.md'),
  task_spawn_candidate_variant: path.join('prompts', 'tasks', 'spawn_candidate_variant.md'),
  task_caption_rewrite: path.join('prompts', 'tasks', 'caption_rewrite.md'),
  task_story_sequence: path.join('prompts', 'tasks', 'story_sequence.md'),
  task_reel_caption_overlay: path.join('prompts', 'tasks', 'reel_caption_overlay.md'),
  task_collision_check: path.join('prompts', 'tasks', 'collision_check.md'),
  task_reel_reasoning: path.join('prompts', 'tasks', 'reel_reasoning.md'),
  task_reel_hook_lab: path.join('prompts', 'tasks', 'reel_hook_lab.md'),
};

function envOverridePath(key: string): string | null {
  const envName = `FR94_PROMPT_${key.toUpperCase()}_PATH`;
  const v = process.env[envName]?.trim();
  if (!v) return null;
  return path.isAbsolute(v) ? v : path.resolve(process.cwd(), v);
}

export function resolveStableContextFilePath(key: StableContextKey): string {
  return envOverridePath(key) ?? resolveRepoRelative(CONTEXT_FILE_REL[key]);
}

export function resolveTaskPromptFilePath(key: TaskPromptKey): string {
  return envOverridePath(key) ?? resolveRepoRelative(TASK_FILE_REL[key]);
}

function readPromptFile(p: string, hint: string): string {
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    throw new Error(`Cannot read prompt file: ${p}. ${hint}`);
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`Prompt file is empty: ${p}`);
  }
  return trimmed;
}

export function loadStableContextFromFile(key: StableContextKey): string {
  return readPromptFile(
    resolveStableContextFilePath(key),
    `Add ${CONTEXT_FILE_REL[key]} or set FR94_PROMPT_${key.toUpperCase()}_PATH.`,
  );
}

export function loadTaskPromptFromFile(key: TaskPromptKey): string {
  return readPromptFile(
    resolveTaskPromptFilePath(key),
    `Add ${TASK_FILE_REL[key]} or set FR94_PROMPT_${key.toUpperCase()}_PATH.`,
  );
}

export const STABLE_SECTION_SEPARATOR = '\n\n---\n\n';

export function composeStableSystemInstruction(parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join(STABLE_SECTION_SEPARATOR);
}
