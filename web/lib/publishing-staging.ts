/** Client-side mirror of scripts/lib/publishing/staging-gates.ts */
export function canOpenPublishingForCandidate(status: string | null | undefined): boolean {
  const st = (status ?? '').trim();
  return st === 'approved' || st === 'ready_to_publish' || st === 'produced';
}

export function canAutoStagePublishingForCandidate(status: string | null | undefined): boolean {
  const st = (status ?? '').trim();
  return st === 'approved' || st === 'produced';
}
