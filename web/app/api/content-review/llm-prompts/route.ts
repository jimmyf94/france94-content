import path from 'node:path';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  resolveAnalysisPromptPath,
  resolveAudioTranscriptionPromptPath,
  resolveVideoSampledPromptPath,
} from '@fr94/ai/prompts/asset-analysis.js';
import { resolveCandidateRegenerationStablePromptPath } from '@fr94/ai/prompts/candidate-regeneration.js';
import { resolvePostPlannerStablePromptPath } from '@fr94/ai/prompts/post-planner.js';
import {
  loadResolvedStablePrompt,
  STABLE_PROMPT_KEYS,
} from '@fr94/ai/resolve-stable-prompt.js';
import type { StablePromptKey } from '@fr94/ai/resolve-stable-prompt.js';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

const keySchema = z.enum(STABLE_PROMPT_KEYS);

const putBodySchema = z.object({
  key: keySchema,
  body: z.string().min(1).max(400_000),
});

function fileBasenameHint(key: StablePromptKey): string {
  switch (key) {
    case 'direct_media_analysis':
      return path.basename(resolveAnalysisPromptPath());
    case 'video_sampled_analysis':
      return path.basename(resolveVideoSampledPromptPath());
    case 'audio_transcription':
      return path.basename(resolveAudioTranscriptionPromptPath());
    case 'post_planner':
      return path.basename(resolvePostPlannerStablePromptPath());
    case 'candidate_regeneration':
      return path.basename(resolveCandidateRegenerationStablePromptPath());
    default: {
      const _e: never = key;
      return _e;
    }
  }
}

export async function GET(req: NextRequest) {
  try {
    const denied = assertReviewAuthorized(req);
    if (denied) return denied;

    const supabase = getSupabaseServiceRole();
    const { data: rows, error } = await supabase.from('llm_stable_prompts').select('prompt_key, body, updated_at');

    if (error) {
      console.error('[llm-prompts]', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const byKey = new Map<string, { body: string; updated_at: string }>();
    for (const r of rows ?? []) {
      const row = r as { prompt_key?: string; body?: string; updated_at?: string };
      if (row.prompt_key && typeof row.body === 'string' && row.body.trim()) {
        byKey.set(row.prompt_key, {
          body: row.body.trim(),
          updated_at: row.updated_at ?? '',
        });
      }
    }

    const prompts = await Promise.all(
      STABLE_PROMPT_KEYS.map(async (key) => {
        const fileDefault = (await loadResolvedStablePrompt(null, key)).text;
        const db = byKey.get(key);
        const effectiveBody = db?.body ?? fileDefault;
        return {
          key,
          effectiveBody,
          source: db ? ('db' as const) : ('file' as const),
          fileDefaultBody: fileDefault,
          dbBody: db?.body ?? null,
          updated_at: db?.updated_at ?? null,
          fileBasename: fileBasenameHint(key),
        };
      }),
    );

    return NextResponse.json({ prompts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[llm-prompts] GET', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const denied = assertReviewAuthorized(req);
    if (denied) return denied;

    const json: unknown = await req.json().catch(() => null);
    const parsed = putBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { key, body } = parsed.data;
    const trimmed = body.trim();
    if (!trimmed) {
      return NextResponse.json({ error: 'body must be non-empty when trimmed' }, { status: 400 });
    }

    const supabase = getSupabaseServiceRole();
    const { error } = await supabase.from('llm_stable_prompts').upsert(
      {
        prompt_key: key,
        body: trimmed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'prompt_key' },
    );

    if (error) {
      console.error('[llm-prompts] PUT', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[llm-prompts] PUT', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const denied = assertReviewAuthorized(req);
    if (denied) return denied;

    const raw = req.nextUrl.searchParams.get('key')?.trim();
    const parsed = raw ? keySchema.safeParse(raw) : null;
    if (!parsed?.success) {
      return NextResponse.json({ error: 'Missing or invalid key' }, { status: 400 });
    }

    const supabase = getSupabaseServiceRole();
    const { error } = await supabase.from('llm_stable_prompts').delete().eq('prompt_key', parsed.data);

    if (error) {
      console.error('[llm-prompts] DELETE', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[llm-prompts] DELETE', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
