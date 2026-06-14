/** Client-safe prompt + pipeline registry (no Node fs imports). */

export type StablePromptKey =
  | 'direct_media_analysis'
  | 'video_sampled_analysis'
  | 'video_full_analysis'
  | 'audio_transcription'
  | 'context_user_voice'
  | 'context_mission'
  | 'context_editorial_rules'
  | 'task_generate_candidate'
  | 'task_regenerate_with_notes'
  | 'task_spawn_candidate_variant'
  | 'task_caption_rewrite'
  | 'task_story_sequence'
  | 'task_reel_caption_overlay'
  | 'task_collision_check'
  | 'task_reel_reasoning'
  | 'task_reel_hook_lab';

export type PromptGroupKey = 'context' | 'task_wired' | 'task_unwired' | 'analysis';

export type Fr94PipelineOperation =
  | 'asset_analysis_image'
  | 'asset_analysis_video_sampled'
  | 'asset_analysis_video_full'
  | 'candidate_generation'
  | 'candidate_regeneration'
  | 'caption_rewrite_basic'
  | 'caption_rewrite_premium'
  | 'ranking'
  | 'final_editorial_pass'
  | 'collision_check';

export type PromptMetaDef = {
  key: StablePromptKey;
  title: string;
  hint: string;
  group: PromptGroupKey;
  wired: boolean;
};

export type PipelineStepDef = {
  operation: Fr94PipelineOperation;
  title: string;
  hint: string;
  promptKeys: readonly StablePromptKey[];
  wired: boolean;
};

export const STABLE_CONTEXT_KEY_LIST = [
  'context_user_voice',
  'context_mission',
  'context_editorial_rules',
] as const satisfies readonly StablePromptKey[];

export const STABLE_PROMPT_KEY_LIST = [
  'context_user_voice',
  'context_mission',
  'context_editorial_rules',
  'task_generate_candidate',
  'task_regenerate_with_notes',
  'task_spawn_candidate_variant',
  'task_caption_rewrite',
  'task_story_sequence',
  'task_reel_caption_overlay',
  'task_collision_check',
  'task_reel_reasoning',
  'task_reel_hook_lab',
  'direct_media_analysis',
  'video_sampled_analysis',
  'video_full_analysis',
  'audio_transcription',
] as const satisfies readonly StablePromptKey[];

const GENERATION_PROMPT_KEYS = [
  ...STABLE_CONTEXT_KEY_LIST,
  'task_generate_candidate',
] as const satisfies readonly StablePromptKey[];

const REGENERATION_PROMPT_KEYS = [
  ...STABLE_CONTEXT_KEY_LIST,
  'task_regenerate_with_notes',
] as const satisfies readonly StablePromptKey[];

const COLLISION_PROMPT_KEYS = [
  ...STABLE_CONTEXT_KEY_LIST,
  'task_collision_check',
] as const satisfies readonly StablePromptKey[];

const CAPTION_REWRITE_PROMPT_KEYS = [
  ...STABLE_CONTEXT_KEY_LIST,
  'task_caption_rewrite',
] as const satisfies readonly StablePromptKey[];

export const PROMPT_REGISTRY: readonly PromptMetaDef[] = [
  {
    key: 'context_user_voice',
    title: 'Context · Jimmy voice',
    hint: 'Stable voice / tone / forbidden phrases. Cached and reused across every content-generation flow.',
    group: 'context',
    wired: true,
  },
  {
    key: 'context_mission',
    title: 'Context · Mission & phase',
    hint: 'France94 facts + phase calendar (Foundation / Pre-Challenge / Live / Aftermath).',
    group: 'context',
    wired: true,
  },
  {
    key: 'context_editorial_rules',
    title: 'Context · Editorial rules',
    hint: 'Asset-first, no slop, CTA discipline, France94 explainer discipline.',
    group: 'context',
    wired: true,
  },
  {
    key: 'task_generate_candidate',
    title: 'Task · Generate candidate',
    hint: 'Wired into the planner batch (scripts/generate-post-candidates.ts). Combined with context prompts + active content series.',
    group: 'task_wired',
    wired: true,
  },
  {
    key: 'task_regenerate_with_notes',
    title: 'Task · Regenerate with notes',
    hint: 'Wired into the review-UI rewrite (web/lib/post-candidate-rewrite.ts).',
    group: 'task_wired',
    wired: true,
  },
  {
    key: 'task_caption_rewrite',
    title: 'Task · Caption rewrite (not wired)',
    hint: 'Prompt only. No endpoint yet — edit now so it is ready when the flow ships.',
    group: 'task_unwired',
    wired: false,
  },
  {
    key: 'task_story_sequence',
    title: 'Task · Story sequence (not wired)',
    hint: 'Prompt only. No endpoint yet.',
    group: 'task_unwired',
    wired: false,
  },
  {
    key: 'task_reel_caption_overlay',
    title: 'Task · Reel caption + overlay (not wired)',
    hint: 'Prompt only. No endpoint yet.',
    group: 'task_unwired',
    wired: false,
  },
  {
    key: 'task_collision_check',
    title: 'Task · Collision check',
    hint: 'Wired into generate-post-candidates after each insert (LLM judge vs v_content_ledger).',
    group: 'task_wired',
    wired: true,
  },
  {
    key: 'task_reel_reasoning',
    title: 'Task · Reel assembly + reasoning',
    hint: 'Wired into the clip-based reel generation path: selects clips/hook from pre-tagged content_clips and explains why the reel works.',
    group: 'task_wired',
    wired: true,
  },
  {
    key: 'task_reel_hook_lab',
    title: 'Task · Reel hook lab',
    hint: 'Wired into the review UI hook lab: generates 9 discovery POV hook options for a fixed clip-based reel candidate.',
    group: 'task_wired',
    wired: true,
  },
  {
    key: 'direct_media_analysis',
    title: 'Analysis · Direct media',
    hint: 'Image (and custom) analysis worker. Custom params.prompt overrides DB + file.',
    group: 'analysis',
    wired: true,
  },
  {
    key: 'video_sampled_analysis',
    title: 'Analysis · Video sampled',
    hint: 'Frame + metadata block in analyze worker (fallback when full-video is not eligible).',
    group: 'analysis',
    wired: true,
  },
  {
    key: 'video_full_analysis',
    title: 'Analysis · Video full + clips',
    hint: 'Full-video upload to Gemini: asset metadata + clip segmentation (content_clips) for reel assembly.',
    group: 'analysis',
    wired: true,
  },
  {
    key: 'audio_transcription',
    title: 'Analysis · Audio transcription',
    hint: 'WAV transcription before video frame analysis.',
    group: 'analysis',
    wired: true,
  },
];

export const PROMPT_META_BY_KEY: Record<StablePromptKey, PromptMetaDef> = Object.fromEntries(
  PROMPT_REGISTRY.map((p) => [p.key, p]),
) as Record<StablePromptKey, PromptMetaDef>;

export const STABLE_PROMPT_ORDER: readonly StablePromptKey[] = PROMPT_REGISTRY.map((p) => p.key);

export const PROMPT_GROUP_LABEL: Record<PromptGroupKey, string> = {
  context: 'Context (cached, reused everywhere)',
  task_wired: 'Tasks (wired)',
  task_unwired: 'Tasks (prompts only, not yet wired)',
  analysis: 'Asset analysis',
};

export const PROMPT_GROUP_ORDER: readonly PromptGroupKey[] = [
  'context',
  'task_wired',
  'task_unwired',
  'analysis',
];

export function buildPromptKeysByGroup(): Record<PromptGroupKey, StablePromptKey[]> {
  const grouped: Record<PromptGroupKey, StablePromptKey[]> = {
    context: [],
    task_wired: [],
    task_unwired: [],
    analysis: [],
  };
  for (const key of STABLE_PROMPT_ORDER) {
    grouped[PROMPT_META_BY_KEY[key].group].push(key);
  }
  return grouped;
}

export const PIPELINE_STEPS: readonly PipelineStepDef[] = [
  {
    operation: 'asset_analysis_image',
    title: 'Asset analysis (image)',
    hint: 'Direct image analysis in the ingest worker.',
    promptKeys: ['direct_media_analysis'],
    wired: true,
  },
  {
    operation: 'asset_analysis_video_sampled',
    title: 'Asset analysis (video sampled + audio)',
    hint: 'Frame-based video analysis; audio transcription shares the sampled route.',
    promptKeys: ['video_sampled_analysis', 'audio_transcription'],
    wired: true,
  },
  {
    operation: 'asset_analysis_video_full',
    title: 'Asset analysis (video full + clips)',
    hint: 'Default video path: full upload, clip segmentation into content_clips; falls back to sampled.',
    promptKeys: ['video_full_analysis'],
    wired: true,
  },
  {
    operation: 'candidate_generation',
    title: 'Post candidate generation',
    hint: 'Planner batch in generate-post-candidates.',
    promptKeys: GENERATION_PROMPT_KEYS,
    wired: true,
  },
  {
    operation: 'candidate_regeneration',
    title: 'Candidate regeneration (rewrite)',
    hint: 'Review dashboard rewrite / regenerate.',
    promptKeys: REGENERATION_PROMPT_KEYS,
    wired: true,
  },
  {
    operation: 'collision_check',
    title: 'Content collision check',
    hint: 'Per-candidate judge after planner insert.',
    promptKeys: COLLISION_PROMPT_KEYS,
    wired: true,
  },
  {
    operation: 'caption_rewrite_basic',
    title: 'Caption rewrite (basic)',
    hint: 'Reserved for lighter caption passes.',
    promptKeys: CAPTION_REWRITE_PROMPT_KEYS,
    wired: false,
  },
  {
    operation: 'caption_rewrite_premium',
    title: 'Caption rewrite (premium)',
    hint: 'Reserved for heavier caption passes.',
    promptKeys: CAPTION_REWRITE_PROMPT_KEYS,
    wired: false,
  },
  {
    operation: 'ranking',
    title: 'Ranking',
    hint: 'Reserved for ranking passes.',
    promptKeys: [],
    wired: false,
  },
  {
    operation: 'final_editorial_pass',
    title: 'Final editorial pass',
    hint: 'Reserved for final editorial.',
    promptKeys: [],
    wired: false,
  },
];

export function analysisPromptKeysForMediaType(mediaType: string | null | undefined): StablePromptKey[] {
  const m = (mediaType ?? '').toLowerCase();
  if (m.startsWith('video/')) {
    return ['video_full_analysis', 'video_sampled_analysis', 'audio_transcription'];
  }
  return ['direct_media_analysis'];
}

export function composedTaskPromptKeys(
  taskKey: 'task_generate_candidate' | 'task_regenerate_with_notes',
): StablePromptKey[] {
  return [...STABLE_CONTEXT_KEY_LIST, taskKey];
}
