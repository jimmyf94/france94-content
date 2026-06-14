import { NextRequest, NextResponse } from 'next/server';

import {
  reconcileAllStaleApprovedReservations,
  reconcileLegacyAssetLockCandidates,
  reconcileLegacyHardLockedAssetSummaries,
  reconcilePublishedAutoStaleEligibility,
  reconcileStaleSuggestedUsageSummaries,
} from '@fr94/asset-usage';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

const noStore = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
} as const;

/**
 * Clears `usage_stage = approved` ledger rows for any candidate whose status is no longer
 * in the pipeline (e.g. rejected / needs_rewrite / needs_review with historical orphans).
 */
export async function POST(req: NextRequest) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  try {
    const supabase = getSupabaseServiceRole();
    const { repairedCandidateIds } = await reconcileAllStaleApprovedReservations(supabase);
    const { repairedAssetIds } = await reconcileStaleSuggestedUsageSummaries(supabase);
    const { repairedAssetIds: legacyHardLockAssetIds } =
      await reconcileLegacyHardLockedAssetSummaries(supabase);
    const { repairedCandidateIds: legacyLockCandidateIds } =
      await reconcileLegacyAssetLockCandidates(supabase);
    const { repairedAssetIds: restoredEligibilityAssetIds } =
      await reconcilePublishedAutoStaleEligibility(supabase);
    const maxIds = 200;
    return NextResponse.json(
      {
        repairedCount: repairedCandidateIds.length,
        repairedCandidateIds: repairedCandidateIds.slice(0, maxIds),
        repairedCandidateIdsTruncated: repairedCandidateIds.length > maxIds,
        repairedAssetSummaryCount: repairedAssetIds.length,
        repairedAssetIds: repairedAssetIds.slice(0, maxIds),
        repairedAssetIdsTruncated: repairedAssetIds.length > maxIds,
        legacyHardLockAssetCount: legacyHardLockAssetIds.length,
        legacyHardLockAssetIds: legacyHardLockAssetIds.slice(0, maxIds),
        legacyHardLockAssetIdsTruncated: legacyHardLockAssetIds.length > maxIds,
        legacyLockCandidateCount: legacyLockCandidateIds.length,
        legacyLockCandidateIds: legacyLockCandidateIds.slice(0, maxIds),
        legacyLockCandidateIdsTruncated: legacyLockCandidateIds.length > maxIds,
        restoredEligibilityAssetCount: restoredEligibilityAssetIds.length,
        restoredEligibilityAssetIds: restoredEligibilityAssetIds.slice(0, maxIds),
        restoredEligibilityAssetIdsTruncated: restoredEligibilityAssetIds.length > maxIds,
      },
      { headers: noStore },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[reconcile-asset-reservations]', e);
    return NextResponse.json({ error: msg }, { status: 500, headers: noStore });
  }
}
