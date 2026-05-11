import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  FR94_MODEL_ROUTE_KEYS,
  getModelRoute,
  mergeResolvedRouteForPreview,
  thinkingLevelFromDb,
  thinkingLevelToDb,
  type Fr94ModelRouteKey,
  type ResolvedModelRoute,
} from '@fr94/ai/gemini-client.js';
import type { LlmRouteSettingsRow } from '@fr94/ai/model-route-resolve.js';
import {
  explicitCachingEnabled,
  getFr94PromptVersion,
  llmLoggingDisabled,
} from '@fr94/ai/prompt-version.js';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

const operationSchema = z
  .string()
  .refine((s): s is Fr94ModelRouteKey =>
    (FR94_MODEL_ROUTE_KEYS as readonly string[]).includes(s),
  );

const putBodySchema = z.object({
  operation: operationSchema,
  model: z.string().trim().min(1).max(256),
  temperature: z.number().min(0).max(2),
  max_output_tokens: z.number().int().min(1).max(32768),
  use_cache: z.boolean(),
  require_json: z.boolean(),
  thinking_level: z.union([z.string(), z.null()]).optional(),
});

function rowFromDb(raw: Record<string, unknown>): LlmRouteSettingsRow | null {
  const op = raw.operation;
  if (typeof op !== 'string') return null;
  return {
    operation: op,
    model: String(raw.model ?? ''),
    temperature: Number(raw.temperature),
    max_output_tokens: Number(raw.max_output_tokens),
    use_cache: Boolean(raw.use_cache),
    require_json: Boolean(raw.require_json),
    thinking_level:
      raw.thinking_level === null || raw.thinking_level === undefined
        ? null
        : String(raw.thinking_level),
    updated_at: raw.updated_at != null ? String(raw.updated_at) : undefined,
  };
}

function effectiveRoute(
  operation: Fr94ModelRouteKey,
  base: ResolvedModelRoute,
  row: LlmRouteSettingsRow | undefined,
): ResolvedModelRoute {
  if (!row) return base;
  return mergeResolvedRouteForPreview(base, row);
}

export async function GET(req: NextRequest) {
  try {
    const denied = assertReviewAuthorized(req);
    if (denied) return denied;

    const supabase = getSupabaseServiceRole();
    const { data: rows, error } = await supabase.from('llm_route_settings').select('*');

    if (error) {
      console.error('[llm-settings]', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const byOp = new Map<string, LlmRouteSettingsRow>();
    for (const r of rows ?? []) {
      const row = rowFromDb(r as Record<string, unknown>);
      if (row) byOp.set(row.operation, row);
    }

    const routes = FR94_MODEL_ROUTE_KEYS.map((operation) => {
      const base = getModelRoute(operation);
      const dbRow = byOp.get(operation);
      const effective = effectiveRoute(operation, base, dbRow);
      return {
        operation,
        effective: {
          model: effective.model,
          temperature: effective.temperature,
          maxOutputTokens: effective.maxOutputTokens,
          useCache: effective.useCache,
          requireJson: effective.requireJson,
          thinkingLevel: thinkingLevelToDb(effective.thinkingLevel),
        },
        modelLockedByEnv: base.modelOverriddenFromEnv,
        dbRow: dbRow
          ? {
              model: dbRow.model,
              temperature: dbRow.temperature,
              max_output_tokens: dbRow.max_output_tokens,
              use_cache: dbRow.use_cache,
              require_json: dbRow.require_json,
              thinking_level: dbRow.thinking_level,
              updated_at: dbRow.updated_at ?? null,
            }
          : null,
      };
    });

    return NextResponse.json({
      routes,
      runtimeHints: {
        fr94PromptVersion: getFr94PromptVersion(),
        geminiExplicitCaching: explicitCachingEnabled(),
        llmLoggingDisabled: llmLoggingDisabled(),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[llm-settings] GET', e);
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

    const body = parsed.data;
    const tlRaw = body.thinking_level;
    const tlStr =
      tlRaw === undefined || tlRaw === null || tlRaw === ''
        ? null
        : String(tlRaw).trim() || null;
    if (tlStr != null && thinkingLevelFromDb(tlStr) == null && tlStr !== '') {
      return NextResponse.json({ error: 'Invalid thinking_level' }, { status: 400 });
    }
    const thinkingLevelDb = tlStr === null || tlStr === '' ? null : thinkingLevelFromDb(tlStr) ?? null;

    const supabase = getSupabaseServiceRole();
    const { error } = await supabase.from('llm_route_settings').upsert(
      {
        operation: body.operation,
        model: body.model,
        temperature: body.temperature,
        max_output_tokens: body.max_output_tokens,
        use_cache: body.use_cache,
        require_json: body.require_json,
        thinking_level: thinkingLevelDb != null ? thinkingLevelToDb(thinkingLevelDb) : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'operation' },
    );

    if (error) {
      console.error('[llm-settings] PUT', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[llm-settings] PUT', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const denied = assertReviewAuthorized(req);
    if (denied) return denied;

    const opRaw = req.nextUrl.searchParams.get('operation')?.trim();
    const opParsed = opRaw ? operationSchema.safeParse(opRaw) : null;
    if (!opParsed?.success) {
      return NextResponse.json({ error: 'Missing or invalid operation' }, { status: 400 });
    }

    const supabase = getSupabaseServiceRole();
    const { error } = await supabase.from('llm_route_settings').delete().eq('operation', opParsed.data);

    if (error) {
      console.error('[llm-settings] DELETE', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[llm-settings] DELETE', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
