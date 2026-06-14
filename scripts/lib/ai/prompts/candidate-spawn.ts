import { type Fr94ProjectPhase, resolveFr94Phase } from './post-planner.js';

export type CandidateSpawnMode =
  | 'keep_text_change_assets'
  | 'shuffle_assets'
  | 'shuffle_assets_and_text';

export type SourceStructureContract = {
  post_type: unknown;
  source_asset_count: number;
  source_clip_count: number | null;
  source_slide_count: number | null;
  source_duration_sec: number | null;
  preserve_asset_count: boolean;
  preserve_clip_count: boolean;
  creative_anchors: {
    hook: unknown;
    caption_fr: unknown;
    concept_summary: unknown;
    title: unknown;
    selected_series: unknown;
  };
};

export function buildCandidateSpawnDynamicPayload(params: {
  spawnMode: CandidateSpawnMode;
  operatorNotes?: string;
  sourceCandidate: unknown;
  sourceStructureContract: SourceStructureContract;
  assetSummaries: unknown;
  currentDate?: string;
  currentPhase?: Fr94ProjectPhase;
}): string {
  const now = new Date();
  const payload = {
    spawn_mode: params.spawnMode,
    operator_notes: params.operatorNotes?.trim() || '',
    current_date: params.currentDate ?? now.toISOString().slice(0, 10),
    current_phase: params.currentPhase ?? resolveFr94Phase(now),
    source_candidate: params.sourceCandidate,
    source_structure_contract: params.sourceStructureContract,
    asset_summaries: params.assetSummaries,
  };
  return `Dynamic payload (JSON):\n${JSON.stringify(payload, null, 2)}`;
}
