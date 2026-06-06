import { NextRequest, NextResponse } from 'next/server';

import { estimateLlmCostUsd } from '@fr94/ai/gemini-client.js';
import {
  explicitCachingEnabled,
  getFr94PromptVersion,
  llmLoggingDisabled,
} from '@fr94/ai/prompt-version.js';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

type RpcDailyRow = {
  day: string;
  output_tokens: number | string;
  input_tokens: number | string;
  total_tokens: number | string;
  call_count: number | string;
  failed_count: number | string;
};

type RpcModelRow = {
  day: string;
  model: string;
  output_tokens: number | string;
  input_tokens?: number | string;
  call_count: number | string;
};

type RpcOperationRow = {
  day: string;
  operation: string;
  call_count: number | string;
  output_tokens: number | string;
};

export async function GET(req: NextRequest) {
  try {
    const denied = assertReviewAuthorized(req);
    if (denied) return denied;

    const rawDays = req.nextUrl.searchParams.get('days');
    let days = 30;
    if (rawDays != null && rawDays !== '') {
      const n = Number.parseInt(rawDays, 10);
      if (Number.isFinite(n)) days = Math.min(90, Math.max(1, n));
    }

    const supabase = getSupabaseServiceRole();
    const [dailyRes, modelRes, opRes] = await Promise.all([
      supabase.rpc('fr94_llm_usage_daily', { p_days: days }),
      supabase.rpc('fr94_llm_usage_by_model_daily', { p_days: days }),
      supabase.rpc('fr94_llm_usage_by_operation_daily', { p_days: days }),
    ]);

    if (dailyRes.error) {
      console.error('[llm-usage] daily', dailyRes.error);
      return NextResponse.json({ error: dailyRes.error.message, series: [] }, { status: 500 });
    }

    const dailyRows = (Array.isArray(dailyRes.data) ? dailyRes.data : []) as RpcDailyRow[];
    const series = dailyRows.map((r) => ({
      day: String(r.day),
      outputTokens: Number(r.output_tokens) || 0,
      inputTokens: Number(r.input_tokens) || 0,
      totalTokens: Number(r.total_tokens) || 0,
      callCount: Number(r.call_count) || 0,
      failedCount: Number(r.failed_count) || 0,
    }));

    const modelRows = modelRes.error
      ? []
      : ((Array.isArray(modelRes.data) ? modelRes.data : []) as RpcModelRow[]);
    const operationRows = opRes.error
      ? []
      : ((Array.isArray(opRes.data) ? opRes.data : []) as RpcOperationRow[]);

    if (modelRes.error) {
      console.warn('[llm-usage] by_model RPC missing or failed:', modelRes.error.message);
    }
    if (opRes.error) {
      console.warn('[llm-usage] by_operation RPC missing or failed:', opRes.error.message);
    }

    const byModelDaily = modelRows.map((r) => {
      const inputTokens = Number(r.input_tokens) || 0;
      const outputTokens = Number(r.output_tokens) || 0;
      const model = String(r.model ?? '(unknown)');
      return {
        day: String(r.day),
        model,
        inputTokens,
        outputTokens,
        callCount: Number(r.call_count) || 0,
        estimatedCostUsd: estimateLlmCostUsd(model, inputTokens, outputTokens),
      };
    });

    const byOperationDaily = operationRows.map((r) => ({
      day: String(r.day),
      operation: String(r.operation ?? '(unknown)'),
      callCount: Number(r.call_count) || 0,
      outputTokens: Number(r.output_tokens) || 0,
    }));

    const totals = series.reduce(
      (acc, p) => ({
        outputTokens: acc.outputTokens + p.outputTokens,
        inputTokens: acc.inputTokens + p.inputTokens,
        totalTokens: acc.totalTokens + p.totalTokens,
        callCount: acc.callCount + p.callCount,
        failedCount: acc.failedCount + p.failedCount,
      }),
      { outputTokens: 0, inputTokens: 0, totalTokens: 0, callCount: 0, failedCount: 0 },
    );

    const tokensByModel = new Map<string, { inputTokens: number; outputTokens: number }>();
    for (const row of byModelDaily) {
      const prev = tokensByModel.get(row.model) ?? { inputTokens: 0, outputTokens: 0 };
      tokensByModel.set(row.model, {
        inputTokens: prev.inputTokens + row.inputTokens,
        outputTokens: prev.outputTokens + row.outputTokens,
      });
    }

    let estimatedCostUsd = 0;
    let unpricedModelCount = 0;
    for (const [model, tok] of tokensByModel) {
      const rowCost = estimateLlmCostUsd(model, tok.inputTokens, tok.outputTokens);
      if (rowCost == null) unpricedModelCount++;
      else estimatedCostUsd += rowCost;
    }

    const estimatedDailyCostUsd =
      days > 0 && estimatedCostUsd != null ? estimatedCostUsd / days : null;
    const estimatedWeeklyCostUsd =
      estimatedDailyCostUsd != null ? estimatedDailyCostUsd * 7 : null;

    return NextResponse.json({
      days,
      series,
      byModelDaily,
      byOperationDaily,
      breakdownRpcErrors: {
        model: modelRes.error?.message ?? null,
        operation: opRes.error?.message ?? null,
      },
      totals,
      cost: {
        estimatedTotalUsd: estimatedCostUsd,
        estimatedDailyUsd: estimatedDailyCostUsd,
        estimatedWeeklyUsd: estimatedWeeklyCostUsd,
        pricedModelCount: tokensByModel.size - unpricedModelCount,
        unpricedModelCount,
        note: 'List-price estimates from scripts/lib/ai/model-routes.ts (standard Gemini API tier).',
      },
      runtimeHints: {
        fr94PromptVersion: getFr94PromptVersion(),
        geminiExplicitCaching: explicitCachingEnabled(),
        llmLoggingDisabled: llmLoggingDisabled(),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[llm-usage]', e);
    return NextResponse.json({ error: msg, series: [] }, { status: 500 });
  }
}
