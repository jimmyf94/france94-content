/** Candidate statuses allowed to create or resume a publishing job. */
export const STAGEABLE_CANDIDATE_STATUSES = [
  'approved',
  'ready_to_publish',
  'produced',
] as const;

export type StageableCandidateStatus = (typeof STAGEABLE_CANDIDATE_STATUSES)[number];

export function isStageableCandidateStatus(status: string | null | undefined): boolean {
  const st = (status ?? '').trim();
  return (STAGEABLE_CANDIDATE_STATUSES as readonly string[]).includes(st);
}
