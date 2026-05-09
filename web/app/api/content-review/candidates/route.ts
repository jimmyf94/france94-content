import { NextRequest, NextResponse } from 'next/server';

import { escapeIlikePattern } from '@/lib/query-escape';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

const DEFAULT_STATUSES = ['needs_review', 'needs_rewrite'];

export async function GET(req: NextRequest) {
  try {
    const denied = assertReviewAuthorized(req);
    if (denied) return denied;

    const supabase = getSupabaseServiceRole();
    const sp = req.nextUrl.searchParams;

    let statuses = DEFAULT_STATUSES;
    const statusParam = sp.get('status')?.trim();
    if (statusParam) {
      statuses = statusParam.split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length === 0) statuses = DEFAULT_STATUSES;
    }

    let q = supabase.from('post_candidates').select('*').in('status', statuses);

    const postType = sp.get('post_type')?.trim();
    if (postType) {
      q = q.eq('post_type', postType);
    }

    const candidateDate = sp.get('candidate_date')?.trim();
    if (candidateDate) {
      q = q.eq('candidate_date', candidateDate);
    }

    const priorityMin = sp.get('priority_min')?.trim();
    if (priorityMin != null && priorityMin !== '') {
      const n = Number(priorityMin);
      if (!Number.isNaN(n)) q = q.gte('priority_score', n);
    }

    const priorityMax = sp.get('priority_max')?.trim();
    if (priorityMax != null && priorityMax !== '') {
      const n = Number(priorityMax);
      if (!Number.isNaN(n)) q = q.lte('priority_score', n);
    }

    const search = sp.get('q')?.trim().replace(/,/g, ' ');
    if (search) {
      const pat = `%${escapeIlikePattern(search)}%`;
      q = q.or(
        `title.ilike.${pat},hook.ilike.${pat},caption_fr.ilike.${pat},caption_en.ilike.${pat}`,
      );
    }

    q = q
      .order('priority_score', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    const { data, error } = await q;

    if (error) {
      console.error('[candidates]', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ candidates: data ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[candidates] unhandled', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
