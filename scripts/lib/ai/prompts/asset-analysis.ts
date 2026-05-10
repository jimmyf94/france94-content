import fs from 'node:fs';
import path from 'node:path';

import { resolveRepoRelative } from './resolve-repo-path.js';

const DEFAULT_ANALYSIS_REL = path.join('scripts', 'prompts', 'france94-media-analysis.txt');
const DEFAULT_VIDEO_SAMPLED_REL = path.join('scripts', 'prompts', 'france94-video-sampled-analysis.txt');
const DEFAULT_AUDIO_TRANSCRIPTION_REL = path.join(
  'scripts',
  'prompts',
  'france94-audio-transcription.txt',
);

export function resolveAnalysisPromptPath(): string {
  const fromEnv = process.env.CONTENT_ANALYSIS_PROMPT_PATH?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv);
  }
  return resolveRepoRelative(DEFAULT_ANALYSIS_REL);
}

export function resolveVideoSampledPromptPath(): string {
  const fromEnv = process.env.VIDEO_SAMPLED_PROMPT_PATH?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv);
  }
  return resolveRepoRelative(DEFAULT_VIDEO_SAMPLED_REL);
}

export function resolveAudioTranscriptionPromptPath(): string {
  const fromEnv = process.env.AUDIO_TRANSCRIPTION_PROMPT_PATH?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv);
  }
  return resolveRepoRelative(DEFAULT_AUDIO_TRANSCRIPTION_REL);
}

function readPromptUtf8(promptPath: string, hint: string): string {
  let raw: string;
  try {
    raw = fs.readFileSync(promptPath, 'utf8');
  } catch {
    throw new Error(`Cannot read prompt file: ${promptPath}. ${hint}`);
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`Prompt file is empty: ${promptPath}`);
  }
  return trimmed;
}

export function loadDirectMediaAnalysisStablePrompt(): string {
  const p = resolveAnalysisPromptPath();
  return readPromptUtf8(
    p,
    'Set CONTENT_ANALYSIS_PROMPT_PATH or add scripts/prompts/france94-media-analysis.txt.',
  );
}

export function loadVideoSampledAnalysisStablePrompt(): string {
  const p = resolveVideoSampledPromptPath();
  return readPromptUtf8(
    p,
    'Set VIDEO_SAMPLED_PROMPT_PATH or add scripts/prompts/france94-video-sampled-analysis.txt.',
  );
}

export function loadAudioTranscriptionStablePrompt(): string {
  const p = resolveAudioTranscriptionPromptPath();
  return readPromptUtf8(
    p,
    'Set AUDIO_TRANSCRIPTION_PROMPT_PATH or add scripts/prompts/france94-audio-transcription.txt.',
  );
}

/** Intentionally empty: direct media analysis keeps all instructions in the stable block (matches legacy prompt). */
export function buildDirectMediaAnalysisDynamicText(): string {
  return '';
}

export function buildVideoSampledMetadataDynamicText(metadata: Record<string, unknown>): string {
  return `Dynamic request context (JSON):\n${JSON.stringify(metadata, null, 2)}`;
}

/** Plain-text block appended after frame parts when non-empty (matches legacy ordering). */
export function buildVideoSampledTranscriptSuffix(audioTranscript: string): string | null {
  const t = audioTranscript.trim();
  if (!t) return null;
  return `\nAudio transcript (already extracted from sampled audio):\n${t}`;
}
