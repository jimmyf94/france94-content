import type { SupabaseClient } from '@supabase/supabase-js';

import {
  analysisPromptKeysForMediaType,
  composedTaskPromptKeys,
  type StablePromptKey,
} from '@fr94/ai/prompts/pipeline-map-data.js';
import { loadResolvedStablePrompt } from '@fr94/ai/resolve-stable-prompt.js';

type LlmCallLogRow = {
  id: string;
  model: string | null;
  operation: string;
  prompt_version: string | null;
  input_token_count: number | null;
  output_token_count: number | null;
  latency_ms: number | null;
  success: boolean;
  error_message: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

type ContentAssetAnalysisRow = {
  id: string;
  current_filename: string | null;
  final_filename: string | null;
  media_type: string | null;
  visual_summary: string | null;
  semantic_summary: string | null;
  transcript: string | null;
  audio_transcript: string | null;
  processed_at: string | null;
};

type CandidatePipelineRow = {
  id: string;
  title: string | null;
  llm_model: string | null;
  llm_raw: unknown;
  created_at: string | null;
  last_regenerated_at: string | null;
  regeneration_count: number | null;
  reviewer_notes: string | null;
  source_asset_ids: string[] | null;
  previous_versions: unknown;
};

export type CandidateLlmPipelineStep = {
  id: string;
  kind: 'asset_analysis' | 'candidate_generation' | 'candidate_regeneration';
  label: string;
  promptKeys: StablePromptKey[];
  operation: string | null;
  model: string | null;
  status: 'success' | 'failed' | 'unknown';
  timestamp: string | null;
  inputText: string | null;
  outputText: string | null;
  promptTexts: Record<string, string>;
  telemetry: {
    inputTokens: number | null;
    outputTokens: number | null;
    latencyMs: number | null;
    promptVersion: string | null;
  } | null;
  contentAssetId?: string;
  reviewerNotes?: string | null;
};

export type CandidateLlmPipelineResponse = {
  candidateId: string;
  steps: CandidateLlmPipelineStep[];
};

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

function asPreviousVersions(v: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object');
}

function extractLlmOutputText(llmRaw: unknown): string | null {
  if (!llmRaw || typeof llmRaw !== 'object') return null;
  const text = (llmRaw as Record<string, unknown>).text;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

function formatAnalysisOutput(asset: ContentAssetAnalysisRow): string {
  const parts: string[] = [];
  if (asset.visual_summary?.trim()) parts.push(`Visual summary:\n${asset.visual_summary.trim()}`);
  if (asset.semantic_summary?.trim()) parts.push(`Semantic summary:\n${asset.semantic_summary.trim()}`);
  if (asset.transcript?.trim()) parts.push(`Transcript:\n${asset.transcript.trim()}`);
  if (asset.audio_transcript?.trim()) parts.push(`Audio transcript:\n${asset.audio_transcript.trim()}`);
  return parts.length > 0 ? parts.join('\n\n') : '(no analysis output stored on asset)';
}

function assetLabel(asset: ContentAssetAnalysisRow): string {
  return asset.final_filename?.trim() || asset.current_filename?.trim() || asset.id.slice(0, 8);
}

function metadataString(meta: Record<string, unknown> | null, key: string): string | null {
  const v = meta?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function logMatchesAsset(log: LlmCallLogRow, assetId: string, subOps: string[]): boolean {
  if (metadataString(log.metadata, 'content_asset_id') !== assetId) return false;
  const sub = metadataString(log.metadata, 'sub_operation');
  if (!sub) return true;
  return subOps.includes(sub);
}

function logMatchesCandidate(log: LlmCallLogRow, candidateId: string, operation: string): boolean {
  if (metadataString(log.metadata, 'post_candidate_id') !== candidateId) return false;
  return log.operation === operation;
}

function pickBestLog(logs: LlmCallLogRow[]): LlmCallLogRow | null {
  if (logs.length === 0) return null;
  return logs.find((l) => l.success) ?? logs[logs.length - 1] ?? null;
}

function telemetryFromLog(log: LlmCallLogRow | null): CandidateLlmPipelineStep['telemetry'] {
  if (!log) return null;
  return {
    inputTokens: log.input_token_count,
    outputTokens: log.output_token_count,
    latencyMs: log.latency_ms,
    promptVersion: log.prompt_version,
  };
}

async function loadPromptTexts(
  supabase: SupabaseClient,
  keys: StablePromptKey[],
): Promise<Record<string, string>> {
  const unique = [...new Set(keys)];
  const entries = await Promise.all(
    unique.map(async (key) => {
      const resolved = await loadResolvedStablePrompt(supabase, key);
      return [key, resolved.text] as const;
    }),
  );
  return Object.fromEntries(entries);
}

async function fetchRelatedLogs(
  supabase: SupabaseClient,
  candidateId: string,
  assetIds: string[],
): Promise<LlmCallLogRow[]> {
  const byId = new Map<string, LlmCallLogRow>();

  const { data: candidateLogs } = await supabase
    .from('llm_call_logs')
    .select(
      'id, model, operation, prompt_version, input_token_count, output_token_count, latency_ms, success, error_message, created_at, metadata',
    )
    .filter('metadata->>post_candidate_id', 'eq', candidateId)
    .order('created_at', { ascending: true });

  for (const row of (candidateLogs ?? []) as LlmCallLogRow[]) {
    byId.set(row.id, row);
  }

  for (const assetId of assetIds) {
    const { data: assetLogs } = await supabase
      .from('llm_call_logs')
      .select(
        'id, model, operation, prompt_version, input_token_count, output_token_count, latency_ms, success, error_message, created_at, metadata',
      )
      .filter('metadata->>content_asset_id', 'eq', assetId)
      .order('created_at', { ascending: true });

    for (const row of (assetLogs ?? []) as LlmCallLogRow[]) {
      byId.set(row.id, row);
    }
  }

  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function buildCandidateLlmPipeline(
  supabase: SupabaseClient,
  candidate: CandidatePipelineRow,
): Promise<CandidateLlmPipelineResponse> {
  const assetIds = asStringArray(candidate.source_asset_ids);
  const previousVersions = asPreviousVersions(candidate.previous_versions);
  const regenerationCount =
    typeof candidate.regeneration_count === 'number' ? candidate.regeneration_count : 0;

  const { data: assetRows, error: assetsErr } =
    assetIds.length > 0
      ? await supabase
          .from('content_assets')
          .select(
            'id, current_filename, final_filename, media_type, visual_summary, semantic_summary, transcript, audio_transcript, processed_at',
          )
          .in('id', assetIds)
      : { data: [] as ContentAssetAnalysisRow[], error: null };

  if (assetsErr) throw new Error(assetsErr.message);

  const assets = (assetRows ?? []) as ContentAssetAnalysisRow[];
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const orderedAssets = assetIds
    .map((id) => assetById.get(id))
    .filter((a): a is ContentAssetAnalysisRow => a != null);

  const allPromptKeys = new Set<StablePromptKey>();
  for (const asset of orderedAssets) {
    for (const k of analysisPromptKeysForMediaType(asset.media_type)) allPromptKeys.add(k);
  }
  for (const k of composedTaskPromptKeys('task_generate_candidate')) allPromptKeys.add(k);
  for (const k of composedTaskPromptKeys('task_regenerate_with_notes')) allPromptKeys.add(k);

  const promptTexts = await loadPromptTexts(supabase, [...allPromptKeys]);
  const logs = await fetchRelatedLogs(supabase, candidate.id, assetIds);

  const steps: CandidateLlmPipelineStep[] = [];

  for (const asset of orderedAssets) {
    const promptKeys = analysisPromptKeysForMediaType(asset.media_type);
    const isVideo = (asset.media_type ?? '').toLowerCase().startsWith('video/');
    const operation = isVideo ? 'asset_analysis_video_sampled' : 'asset_analysis_image';
    const assetLogs = logs.filter((l) =>
      logMatchesAsset(
        l,
        asset.id,
        isVideo ? ['video_sampled', 'audio_transcription'] : ['direct_media', 'image_direct', 'audio_direct', 'other_media'],
      ),
    );
    const bestLog = pickBestLog(assetLogs);

    steps.push({
      id: `analysis:${asset.id}`,
      kind: 'asset_analysis',
      label: `Asset analysis · ${assetLabel(asset)}`,
      promptKeys,
      operation,
      model: bestLog?.model ?? null,
      status: bestLog ? (bestLog.success ? 'success' : 'failed') : 'unknown',
      timestamp: asset.processed_at ?? bestLog?.created_at ?? null,
      inputText: null,
      outputText: formatAnalysisOutput(asset),
      promptTexts: Object.fromEntries(promptKeys.map((k) => [k, promptTexts[k] ?? ''])),
      telemetry: telemetryFromLog(bestLog),
      contentAssetId: asset.id,
    });
  }

  const generationOutput =
    regenerationCount === 0
      ? extractLlmOutputText(candidate.llm_raw)
      : extractLlmOutputText(previousVersions[0]?.llm_raw);

  const generationLogs = logs.filter((l) => logMatchesCandidate(l, candidate.id, 'candidate_generation'));
  const generationLog = pickBestLog(generationLogs);
  const generationPromptKeys = composedTaskPromptKeys('task_generate_candidate');

  steps.push({
    id: 'generation',
    kind: 'candidate_generation',
    label: 'Post candidate generation',
    promptKeys: generationPromptKeys,
    operation: 'candidate_generation',
    model: candidate.llm_model ?? generationLog?.model ?? null,
    status: generationOutput ? 'success' : generationLog ? (generationLog.success ? 'success' : 'failed') : 'unknown',
    timestamp: candidate.created_at ?? generationLog?.created_at ?? null,
    inputText: null,
    outputText: generationOutput,
    promptTexts: Object.fromEntries(generationPromptKeys.map((k) => [k, promptTexts[k] ?? ''])),
    telemetry: telemetryFromLog(generationLog),
  });

  for (let i = 1; i <= regenerationCount; i++) {
    const snapshot = previousVersions[i - 1];
    const reviewerNotes =
      typeof snapshot?.reviewer_notes === 'string' ? snapshot.reviewer_notes : candidate.reviewer_notes;
    const outputText =
      i === regenerationCount
        ? extractLlmOutputText(candidate.llm_raw)
        : extractLlmOutputText(previousVersions[i]?.llm_raw);
    const regenLogs = logs.filter((l) => logMatchesCandidate(l, candidate.id, 'candidate_regeneration'));
    const regenLog = pickBestLog(regenLogs.filter((_, idx) => idx === i - 1)) ?? pickBestLog(regenLogs);
    const regenPromptKeys = composedTaskPromptKeys('task_regenerate_with_notes');

    steps.push({
      id: `regeneration:${i}`,
      kind: 'candidate_regeneration',
      label: `Regeneration ${i}${reviewerNotes?.trim() ? '' : ' (no reviewer notes)'}`,
      promptKeys: regenPromptKeys,
      operation: 'candidate_regeneration',
      model: regenLog?.model ?? candidate.llm_model ?? null,
      status: outputText ? 'success' : regenLog ? (regenLog.success ? 'success' : 'failed') : 'unknown',
      timestamp:
        (typeof snapshot?.regenerated_at === 'string' ? snapshot.regenerated_at : null) ??
        (i === regenerationCount ? candidate.last_regenerated_at : null) ??
        regenLog?.created_at ??
        null,
      inputText: reviewerNotes?.trim() ? `Reviewer notes:\n${reviewerNotes.trim()}` : null,
      outputText,
      promptTexts: Object.fromEntries(regenPromptKeys.map((k) => [k, promptTexts[k] ?? ''])),
      telemetry: telemetryFromLog(regenLog),
      reviewerNotes: reviewerNotes ?? null,
    });
  }

  return { candidateId: candidate.id, steps };
}
