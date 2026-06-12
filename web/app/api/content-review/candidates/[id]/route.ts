import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  AssetUsageError,
  computeLaneCooldownUntil,
  deletePostCandidateCompletely,
  refreshCandidateAssetConflicts,
  releaseAssetsForCandidate,
  releaseStaleApprovedReservationsIfNeeded,
  reserveAssetsForCandidate,
} from '@fr94/asset-usage';
import { getDriveClient } from '@/lib/google-drive-server';
import {
  extractSeriesFieldsFromLlmRaw,
  extractTitleOverlayFromCandidate,
} from '@fr94/candidate-collision';
import { normalizeReelSpecOverlay, resolveReelTextStyle } from '@fr94/reel-text-style';
import { POST_CANDIDATE_DETAIL_COLUMNS } from '@/lib/post-candidate-api-columns';
import { assertReviewAuthorized, getCurrentUserEmail } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

const reelStructureRowSchema = z.object({
  time: z.string(),
  instruction: z.string(),
});

const reelTextStylePatchSchema = z.object({
  fontsize: z.number().int().min(24).max(72).optional(),
  font_color: z.string().trim().min(1).max(32).optional(),
  outline_width: z.number().int().min(0).max(12).optional(),
  outline_color: z.string().trim().min(1).max(32).optional(),
  position: z.enum(['top_third', 'top', 'center']).optional(),
  line_spacing: z.number().int().min(0).max(40).optional(),
  centered: z.boolean().optional(),
});

const reelInstructionsPatchSchema = z
  .object({
    structure: z.array(reelStructureRowSchema).optional(),
    overlay_text: z.array(z.string()).optional(),
    overlay_lines: z.array(z.string()).optional(),
    text_style: reelTextStylePatchSchema.optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.structure !== undefined ||
      v.overlay_text !== undefined ||
      v.overlay_lines !== undefined ||
      v.text_style !== undefined,
    { message: 'Provide at least one reel_instructions field' },
  );

const patchSchema = z
  .object({
    status: z.enum(['approved', 'rejected', 'needs_rewrite']).optional(),
    override_collision: z.boolean().optional(),
    reviewer_notes: z.string().optional().nullable(),
    caption_fr: z.string().optional().nullable(),
    caption_en: z.string().optional().nullable(),
    hashtags: z.array(z.string()).optional().nullable(),
    reel_instructions: reelInstructionsPatchSchema.optional(),
    re_render: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.reviewer_notes !== undefined ||
      v.caption_fr !== undefined ||
      v.caption_en !== undefined ||
      v.hashtags !== undefined ||
      v.reel_instructions !== undefined ||
      v.re_render === true,
    { message: 'Provide at least one field to update' },
  );

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();
  const { data, error } = await supabase
    .from('post_candidates')
    .select(POST_CANDIDATE_DETAIL_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[candidate get]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  const row = data as unknown as { status: string };

  const noStore = {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
  } as const;

  try {
    if (await releaseStaleApprovedReservationsIfNeeded(supabase, id, row.status)) {
      const { data: healed, error: healErr } = await supabase
        .from('post_candidates')
        .select(POST_CANDIDATE_DETAIL_COLUMNS)
        .eq('id', id)
        .maybeSingle();
      if (!healErr && healed) {
        return NextResponse.json({ candidate: healed }, { headers: noStore });
      }
    }
  } catch (e) {
    console.error('[candidate get] stale reservation heal', e);
  }

  return NextResponse.json({ candidate: data }, { headers: noStore });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const {
    status,
    override_collision,
    reviewer_notes,
    caption_fr,
    caption_en,
    hashtags,
    reel_instructions,
    re_render,
  } = parsed.data;
  const now = new Date().toISOString();
  const reviewedBy = await getCurrentUserEmail(req);

  const supabase = getSupabaseServiceRole();

  if (status === 'approved' && override_collision === true) {
    const { error: ovErr } = await supabase
      .from('post_candidates')
      .update({
        collision_overridden_by: reviewedBy,
        collision_overridden_at: now,
        updated_at: now,
      })
      .eq('id', id);
    if (ovErr) {
      console.error('[candidate patch] collision override', ovErr);
      return NextResponse.json({ error: ovErr.message }, { status: 500 });
    }
  }

  if (status === 'approved') {
    try {
      await reserveAssetsForCandidate(supabase, id);
    } catch (e) {
      const msg = e instanceof AssetUsageError ? e.message : e instanceof Error ? e.message : String(e);
      const code = e instanceof AssetUsageError ? e.code : 'asset_usage';
      const statusCode = e instanceof AssetUsageError && e.code === 'no_assets' ? 400 : 409;
      console.warn('[candidate patch] reserve failed', { id, code, msg });
      return NextResponse.json({ error: msg, code }, { status: statusCode });
    }
  }

  if (status === 'rejected' || status === 'needs_rewrite') {
    try {
      await releaseAssetsForCandidate(supabase, id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[candidate patch] release before demote', e);
      return NextResponse.json({ error: `Could not release source assets: ${msg}` }, { status: 500 });
    }
  }

  let mergedReel: Record<string, unknown> | undefined;
  if (reel_instructions !== undefined) {
    const { data: existing, error: readErr } = await supabase
      .from('post_candidates')
      .select('reel_instructions')
      .eq('id', id)
      .maybeSingle();
    if (readErr) {
      console.error('[candidate patch] read reel', readErr);
      return NextResponse.json({ error: readErr.message }, { status: 500 });
    }
    const prev =
      existing?.reel_instructions != null && typeof existing.reel_instructions === 'object'
        ? (existing.reel_instructions as Record<string, unknown>)
        : {};
    if (prev.version === 'clips-v1') {
      mergedReel = { ...prev };
      if (reel_instructions.overlay_lines !== undefined) {
        mergedReel.overlay_lines = reel_instructions.overlay_lines
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 3);
      }
      if (reel_instructions.text_style !== undefined) {
        const prevStyle =
          prev.text_style != null && typeof prev.text_style === 'object' && !Array.isArray(prev.text_style)
            ? (prev.text_style as Record<string, unknown>)
            : {};
        mergedReel.text_style = resolveReelTextStyle({
          ...prevStyle,
          ...reel_instructions.text_style,
        });
      }
    } else {
      mergedReel = { ...prev };
      if (reel_instructions.structure !== undefined) {
        mergedReel.structure = reel_instructions.structure;
      }
      if (reel_instructions.overlay_text !== undefined) {
        mergedReel.overlay_text = reel_instructions.overlay_text;
      }
    }
  }

  const update: Record<string, unknown> = {
    updated_at: now,
  };
  if (reviewer_notes !== undefined) {
    update.reviewer_notes = reviewer_notes ?? null;
  }
  if (status !== undefined) {
    update.status = status;
    update.reviewed_at = now;
    update.reviewed_by = reviewedBy;
  }

  if (status === 'approved') {
    const { data: laneRow, error: laneErr } = await supabase
      .from('post_candidates')
      .select('post_type,selected_series,narrative_function,title_overlay,llm_raw,reel_instructions,static_post_instructions')
      .eq('id', id)
      .maybeSingle();
    if (!laneErr && laneRow) {
      const r = laneRow as {
        post_type?: string | null;
        selected_series?: string | null;
        narrative_function?: string | null;
        title_overlay?: string | null;
        llm_raw?: unknown;
        reel_instructions?: unknown;
        static_post_instructions?: unknown;
      };
      const fromRaw = extractSeriesFieldsFromLlmRaw(r.llm_raw);
      if (!r.selected_series?.trim() && fromRaw.selected_series) {
        update.selected_series = fromRaw.selected_series;
      }
      if (!r.narrative_function?.trim() && fromRaw.narrative_function) {
        update.narrative_function = fromRaw.narrative_function;
      }
      if (!r.title_overlay?.trim()) {
        const overlay = extractTitleOverlayFromCandidate(r);
        if (overlay) update.title_overlay = overlay;
      }
      update.cooldown_until = computeLaneCooldownUntil(r.post_type, new Date(now));
    }
  }
  if (caption_fr !== undefined) {
    update.caption_fr = caption_fr ?? null;
  }
  if (caption_en !== undefined) {
    update.caption_en = caption_en ?? null;
  }
  if (hashtags !== undefined) {
    update.hashtags = hashtags ?? null;
  }
  if (mergedReel !== undefined) {
    update.reel_instructions = mergedReel;
    const overlay0 = Array.isArray(mergedReel.overlay_lines)
      ? (mergedReel.overlay_lines as string[])[0]?.trim()
      : '';
    if (overlay0) update.title_overlay = overlay0;
  }

  const { data, error } = await supabase
    .from('post_candidates')
    .update(update)
    .eq('id', id)
    .select(POST_CANDIDATE_DETAIL_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error('[candidate patch]', error);
    if (status === 'approved') {
      try {
        await releaseAssetsForCandidate(supabase, id);
      } catch (re) {
        console.error('[candidate patch] rollback reserve failed', re);
      }
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    if (status === 'approved') {
      try {
        await releaseAssetsForCandidate(supabase, id);
      } catch (re) {
        console.error('[candidate patch] rollback reserve (no row)', re);
      }
    }
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  if (status === 'approved') {
    try {
      await refreshCandidateAssetConflicts(supabase, id);
    } catch (e) {
      console.error('[candidate patch] refresh conflicts (approved)', e);
    }
  }

  const { data: fresh, error: readBackErr } = await supabase
    .from('post_candidates')
    .select(POST_CANDIDATE_DETAIL_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (readBackErr) {
    console.error('[candidate patch] read-back', readBackErr);
    return NextResponse.json({ error: readBackErr.message }, { status: 500 });
  }

  const candidateOut = fresh ?? data;

  if (re_render === true && candidateOut) {
    const c = candidateOut as {
      id: string;
      post_type?: string;
      hook?: string | null;
      reel_instructions: unknown;
      source_asset_ids: unknown;
      source_drive_file_ids: unknown;
    };
    const riRaw =
      c.reel_instructions != null && typeof c.reel_instructions === 'object'
        ? (c.reel_instructions as Record<string, unknown>)
        : null;
    if (c.post_type === 'reel' && riRaw?.version === 'clips-v1') {
      const ri = normalizeReelSpecOverlay(riRaw, c.hook ?? null);
      const sa = Array.isArray(c.source_asset_ids) ? (c.source_asset_ids as string[]) : [];
      const sd = Array.isArray(c.source_drive_file_ids)
        ? (c.source_drive_file_ids as string[])
        : [];
      const { error: pjErr } = await supabase.from('production_jobs').upsert(
        {
          post_candidate_id: c.id,
          production_type: 'reel',
          status: 'queued',
          source_asset_ids: sa,
          source_drive_file_ids: sd,
          instructions: ri,
          reel_specification: ri,
          output_video_url: null,
          thumbnail_url: null,
          render_log: null,
          render_strategy: null,
          error_message: null,
          updated_at: now,
        },
        { onConflict: 'post_candidate_id,production_type' },
      );
      if (pjErr) console.error('[candidate patch] re_render production_jobs', pjErr);
    }
  }

  if (status === 'approved' && candidateOut) {
    const pt = (candidateOut as { post_type?: string }).post_type?.trim();
    if (pt === 'reel') {
      const c = candidateOut as unknown as {
        id: string;
        reel_instructions: unknown;
        source_asset_ids: unknown;
        source_drive_file_ids: unknown;
      };
      const sa = Array.isArray(c.source_asset_ids) ? (c.source_asset_ids as string[]) : [];
      const sd =
        Array.isArray(c.source_drive_file_ids) ? (c.source_drive_file_ids as string[]) : [];
      // Clip-based reels auto-render at generation; don't reset a job that is
      // already queued/rendering/produced — only (re)queue when missing or failed.
      const { data: existingJob } = await supabase
        .from('production_jobs')
        .select('id,status')
        .eq('post_candidate_id', c.id)
        .eq('production_type', 'reel')
        .maybeSingle();
      const existingStatus = (existingJob as { status?: string } | null)?.status ?? null;
      const shouldQueue =
        existingStatus == null || existingStatus === 'failed' || existingStatus === 'needs_manual_production';
      if (shouldQueue)
        void supabase
        .from('production_jobs')
        .upsert(
          {
            post_candidate_id: c.id,
            production_type: 'reel',
            status: 'queued',
            source_asset_ids: sa,
            source_drive_file_ids: sd,
            instructions: c.reel_instructions ?? {},
            error_message: null,
            render_log: null,
            output_video_url: null,
            output_drive_file_id: null,
            render_strategy: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'post_candidate_id,production_type' },
        )
        .then(({ error: pjErr }) => {
          if (pjErr) console.error('[candidate patch] production_jobs upsert', pjErr);
        });
    }
  }

  const noStore = {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
  } as const;

  return NextResponse.json({ candidate: candidateOut }, { headers: noStore });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();

  try {
    const drive = await getDriveClient();
    const result = await deletePostCandidateCompletely(supabase, id, drive);
    return NextResponse.json({ ok: true, drive_folder_deleted: result.drive_folder_deleted });
  } catch (e) {
    if (e instanceof AssetUsageError) {
      const status = e.code === 'not_found' ? 404 : 409;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[candidate delete]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
