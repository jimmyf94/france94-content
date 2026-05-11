import { NextRequest, NextResponse } from 'next/server';

import {
  explicitCachingEnabled,
  getFr94PromptVersion,
  llmLoggingDisabled,
} from '@fr94/ai/prompt-version.js';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

type RpcRow = {
  day: string;
  output_tokens: number | string;
  input_tokens: number | string;
  total_tokens: number | string;
  call_count: number | string;
  failed_count: number | string;
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
    const { data, error } = await supabase.rpc('fr94_llm_usage_daily', { p_days: days });

    if (error) {
      console.error('[llm-usage]', error);
      return NextResponse.json({ error: error.message, series: [] }, { status: 500 });
    }

    const rows = (Array.isArray(data) ? data : []) as RpcRow[];
    const series = rows.map((r) => ({
      day: String(r.day),
      outputTokens: Number(r.output_tokens) || 0,
      inputTokens: Number(r.input_tokens) || 0,
      totalTokens: Number(r.total_tokens) || 0,
      callCount: Number(r.call_count) || 0,
      failedCount: Number(r.failed_count) || 0,
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

    return NextResponse.json({
      days,
      series,
      totals,
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
