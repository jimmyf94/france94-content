import type { SupabaseClient } from '@supabase/supabase-js';
import { createPartFromText } from '@google/genai';
import { z } from 'zod';

import {
  type CommittedPostForPrompt,
  type ContentLedgerRow,
  toCommittedPostForPrompt,
} from './content-ledger.js';
import {
  callGeminiWithLogging,
  createGeminiClient,
  getResolvedModelRoute,
  responseToJson,
} from './ai/gemini-client.js';
import { buildCollisionCheckDynamicText } from './ai/prompts/collision-check.js';
import { loadComposedStableSystemInstruction, STABLE_CONTEXT_KEYS } from './ai/resolve-stable-prompt.js';
import { getFr94PromptVersion } from './ai/prompt-version.js';

const collisionKindEnumRaw = z.enum([
  'asset_reuse',
  'series',
  'hook',
  'caption',
  'visual_subject',
  'transcript',
  'timing',
  'platform_surface',
]);

const COLLISION_KIND_ALIASES: Record<string, z.infer<typeof collisionKindEnumRaw>> = {
  lane: 'series',
};

const collisionKindEnum = z.preprocess((v) => {
  if (typeof v === 'string' && v in COLLISION_KIND_ALIASES) {
    return COLLISION_KIND_ALIASES[v];
  }
  return v;
}, collisionKindEnumRaw);

const collisionItemSchema = z.object({
  against_ledger_id: z.string(),
  against_label: z.string(),
  kind: collisionKindEnum,
  reason: z.string(),
});

const judgeResponseSchema = z.object({
  risk: z.enum(['low', 'medium', 'high', 'blocked']),
  distinctiveness_note: z.string(),
  collisions: z.array(collisionItemSchema).optional().default([]),
});

export type CollisionRisk = z.infer<typeof judgeResponseSchema>['risk'];

const FEED_STRICT_TYPES = new Set(['reel', 'carousel', 'static_post', 'sponsor_post']);

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return v.trim();
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

function assetOverlap(a: string[], b: string[] | null | undefined): boolean {
  if (!b?.length) return false;
  const set = new Set(b);
  return a.some((id) => set.has(id));
}

export type AssetPrefilterResult =
  | { blocked: true; summary: string; details: Record<string, unknown> }
  | { blocked: false };

export function runAssetOverlapPrefilter(
  candidate: {
    post_type: string;
    source_asset_ids: string[];
    primary_asset_id: string | null;
  },
  recentCommitted: ContentLedgerRow[],
): AssetPrefilterResult {
  const assetIds = candidate.source_asset_ids;
  const primary = candidate.primary_asset_id ?? assetIds[0] ?? null;
  const strictFeed = FEED_STRICT_TYPES.has(candidate.post_type);

  for (const row of recentCommitted) {
    const committedAssets = asStringArray(row.source_asset_ids);
    if (committedAssets.length === 0) continue;

    const label = `${row.post_type}${row.selected_series ? ` · ${row.selected_series}` : ''}${row.committed_at ? ` · ${row.committed_at.slice(0, 10)}` : ''}`;

    if (primary && row.primary_asset_id === primary) {
      return {
        blocked: true,
        summary: `Primary asset already committed (${label}).`,
        details: {
          prefilter: 'primary_asset_match',
          against_ledger_id: row.ledger_id,
          against_label: label,
          evaluated_at: new Date().toISOString(),
        },
      };
    }

    if (strictFeed && assetOverlap(assetIds, committedAssets)) {
      const committedIsStory =
        row.post_type === 'story' || row.post_type === 'story_sequence';
      if (!committedIsStory) {
        return {
          blocked: true,
          summary: `Source asset already used in committed ${row.post_type} (${label}).`,
          details: {
            prefilter: 'asset_overlap',
            against_ledger_id: row.ledger_id,
            against_label: label,
            evaluated_at: new Date().toISOString(),
          },
        };
      }
    }
  }

  return { blocked: false };
}

function collisionSummaryFromJudge(
  risk: CollisionRisk,
  distinctiveness_note: string,
  collisions: z.infer<typeof collisionItemSchema>[],
): string {
  const note = distinctiveness_note.trim();
  if (risk === 'low' || risk === 'medium') {
    return note || 'Distinct from recent committed content.';
  }
  const first = collisions[0]?.reason?.trim();
  return first || note || 'Too close to recent committed content.';
}

export async function evaluateCandidateCollision(
  supabase: SupabaseClient,
  candidateId: string,
  recentCommitted: ContentLedgerRow[],
): Promise<{ risk: CollisionRisk; summary: string }> {
  const { data: row, error } = await supabase
    .from('post_candidates')
    .select(
      'id,post_type,title,hook,concept_summary,caption_fr,selected_series,narrative_function,title_overlay,source_asset_ids',
    )
    .eq('id', candidateId)
    .maybeSingle();

  if (error) throw new Error(`evaluateCandidateCollision(load): ${error.message}`);
  if (!row) throw new Error(`evaluateCandidateCollision: candidate not found ${candidateId}`);

  const source_asset_ids = asStringArray((row as { source_asset_ids?: unknown }).source_asset_ids);
  const primary_asset_id = source_asset_ids[0] ?? null;
  const post_type = String((row as { post_type?: string }).post_type ?? '').trim();

  const pre = runAssetOverlapPrefilter(
    { post_type, source_asset_ids, primary_asset_id },
    recentCommitted,
  );

  if (pre.blocked) {
    await persistCollisionResult(supabase, candidateId, {
      risk: 'blocked',
      summary: pre.summary,
      details: pre.details,
      model: null,
    });
    return { risk: 'blocked', summary: pre.summary };
  }

  const apiKey = requireEnv('GEMINI_API_KEY');
  const ai = createGeminiClient(apiKey);
  const composed = await loadComposedStableSystemInstruction(supabase, 'task_collision_check');
  const committedForPrompt = recentCommitted.map(toCommittedPostForPrompt);
  const dynamicText = buildCollisionCheckDynamicText({
    candidate: {
      id: candidateId,
      post_type,
      title: (row as { title?: string | null }).title ?? null,
      hook: (row as { hook?: string | null }).hook ?? null,
      concept_summary: (row as { concept_summary?: string | null }).concept_summary ?? null,
      caption_fr: (row as { caption_fr?: string | null }).caption_fr ?? null,
      selected_series: (row as { selected_series?: string | null }).selected_series ?? null,
      narrative_function: (row as { narrative_function?: string | null }).narrative_function ?? null,
      title_overlay: (row as { title_overlay?: string | null }).title_overlay ?? null,
      source_asset_ids,
      primary_asset_id,
    },
    recentCommitted: committedForPrompt,
  });

  const promptVersion = getFr94PromptVersion();
  const route = await getResolvedModelRoute(supabase, 'collision_check');

  const { response, modelUsed } = await callGeminiWithLogging({
    ai,
    supabase,
    route,
    promptVersion,
    cacheKey: `collision_check:${candidateId}:${promptVersion}`,
    stableSystemInstruction: composed.text,
    entity: {
      prompt_keys: [...STABLE_CONTEXT_KEYS, 'task_collision_check'],
      pipeline_step: 'collision_check',
      post_candidate_id: candidateId,
    },
    getContentsImplicit: () => [
      createPartFromText(composed.text),
      createPartFromText(dynamicText),
    ],
    getContentsExplicit: () => [createPartFromText(dynamicText)],
  });

  const text = response.text?.trim();
  if (!text) throw new Error('collision_check: empty model response');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```$/i, '').trim());
  } catch {
    throw new Error('collision_check: invalid JSON from model');
  }

  const validated = judgeResponseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`collision_check schema: ${validated.error.message}`);
  }

  const { risk, distinctiveness_note, collisions } = validated.data;
  const summary = collisionSummaryFromJudge(risk, distinctiveness_note, collisions);
  const details: Record<string, unknown> = {
    ...responseToJson(response),
    risk,
    distinctiveness_note,
    collisions,
    model: modelUsed,
    evaluated_at: new Date().toISOString(),
  };

  await persistCollisionResult(supabase, candidateId, {
    risk,
    summary,
    details,
    model: modelUsed,
  });

  return { risk, summary };
}

async function persistCollisionResult(
  supabase: SupabaseClient,
  candidateId: string,
  params: {
    risk: CollisionRisk;
    summary: string;
    details: Record<string, unknown>;
    model: string | null;
  },
): Promise<void> {
  const { error } = await supabase
    .from('post_candidates')
    .update({
      collision_risk: params.risk,
      collision_summary: params.summary,
      collision_details: params.details,
      updated_at: new Date().toISOString(),
    })
    .eq('id', candidateId);

  if (error) throw new Error(`persistCollisionResult: ${error.message}`);
}

export function extractSeriesFieldsFromLlmRaw(llmRaw: unknown): {
  selected_series: string | null;
  narrative_function: string | null;
} {
  if (!llmRaw || typeof llmRaw !== 'object') {
    return { selected_series: null, narrative_function: null };
  }
  const o = llmRaw as Record<string, unknown>;
  const series =
    typeof o.selected_series === 'string'
      ? o.selected_series.trim()
      : typeof o.selected_lane === 'string'
        ? o.selected_lane.trim()
        : '';
  const nf = typeof o.narrative_function === 'string' ? o.narrative_function.trim() : '';
  return {
    selected_series: series || null,
    narrative_function: nf || null,
  };
}

export function extractTitleOverlayFromCandidate(row: {
  reel_instructions?: unknown;
  static_post_instructions?: unknown;
}): string | null {
  const reel = row.reel_instructions;
  if (reel != null && typeof reel === 'object' && !Array.isArray(reel)) {
    const t = (reel as Record<string, unknown>).thumbnail_text;
    if (typeof t === 'string' && t.trim()) return t.trim();
  }
  const st = row.static_post_instructions;
  if (st != null && typeof st === 'object' && !Array.isArray(st)) {
    const t = (st as Record<string, unknown>).main_text;
    if (typeof t === 'string' && t.trim()) return t.trim();
  }
  return null;
}
