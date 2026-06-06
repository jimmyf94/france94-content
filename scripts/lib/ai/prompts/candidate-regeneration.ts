import { type Fr94ProjectPhase, resolveFr94Phase } from './post-planner.js';

export function buildCandidateRegenerationDynamicPayload(params: {
  reviewerNotes: string;
  candidate: unknown;
  assetSummaries: unknown;
  currentDate?: string;
  currentPhase?: Fr94ProjectPhase;
}): string {
  const now = new Date();
  const payload = {
    reviewer_notes: params.reviewerNotes,
    current_date: params.currentDate ?? now.toISOString().slice(0, 10),
    current_phase: params.currentPhase ?? resolveFr94Phase(now),
    candidate: params.candidate,
    asset_summaries: params.assetSummaries,
  };
  return `Dynamic payload (JSON):\n${JSON.stringify(payload, null, 2)}`;
}
