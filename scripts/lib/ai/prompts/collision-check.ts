import type { CommittedPostForPrompt } from '../../content-ledger.js';

export type CollisionCheckCandidateInput = {
  id: string;
  post_type: string;
  title: string | null;
  hook: string | null;
  concept_summary: string | null;
  caption_fr: string | null;
  selected_series: string | null;
  narrative_function: string | null;
  title_overlay: string | null;
  source_asset_ids: string[];
  primary_asset_id: string | null;
};

export function buildCollisionCheckDynamicText(params: {
  candidate: CollisionCheckCandidateInput;
  recentCommitted: CommittedPostForPrompt[];
}): string {
  const payload = {
    candidate: params.candidate,
    recent_committed: params.recentCommitted,
  };
  return `Dynamic payload (JSON):\n${JSON.stringify(payload, null, 2)}`;
}
