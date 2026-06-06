import { STABLE_CONTEXT_KEYS, TASK_PROMPT_KEYS } from './composed-context.js';
import { STABLE_PROMPT_KEYS } from '../resolve-stable-prompt.js';
import {
  STABLE_PROMPT_KEY_LIST,
  type StablePromptKey,
} from './pipeline-map-data.js';

export {
  analysisPromptKeysForMediaType,
  buildPromptKeysByGroup,
  composedTaskPromptKeys,
  PIPELINE_STEPS,
  PROMPT_GROUP_LABEL,
  PROMPT_GROUP_ORDER,
  PROMPT_META_BY_KEY,
  PROMPT_REGISTRY,
  STABLE_CONTEXT_KEY_LIST,
  STABLE_PROMPT_KEY_LIST,
  STABLE_PROMPT_ORDER,
  type Fr94PipelineOperation,
  type PipelineStepDef,
  type PromptGroupKey,
  type PromptMetaDef,
  type StablePromptKey,
} from './pipeline-map-data.js';

/** Validate client-safe registry matches server stable prompt keys. */
export function assertPromptRegistryComplete(): void {
  const registryKeys = new Set(STABLE_PROMPT_KEY_LIST);
  for (const k of STABLE_PROMPT_KEYS) {
    if (!registryKeys.has(k as StablePromptKey)) {
      throw new Error(`Prompt registry missing key: ${k}`);
    }
  }
  if (registryKeys.size !== STABLE_PROMPT_KEYS.length) {
    throw new Error('Prompt registry has unexpected extra keys');
  }
  for (const k of STABLE_CONTEXT_KEYS) {
    if (!registryKeys.has(k as StablePromptKey)) {
      throw new Error(`Prompt registry missing context key: ${k}`);
    }
  }
  for (const k of TASK_PROMPT_KEYS) {
    if (!registryKeys.has(k as StablePromptKey)) {
      throw new Error(`Prompt registry missing task key: ${k}`);
    }
  }
}

assertPromptRegistryComplete();
