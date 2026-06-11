import type { SupabaseClient } from '@supabase/supabase-js';

import { STABLE_SECTION_SEPARATOR } from './ai/prompts/composed-context.js';

export type SeriesStatus = 'active' | 'archived';

export const SERIES_POST_TYPES = [
  'reel',
  'carousel',
  'static_post',
  'story_sequence',
  'long_form_video',
] as const;

export type SeriesPostType = (typeof SERIES_POST_TYPES)[number];

export type SeriesExample = {
  hook?: string;
  notes?: string;
  url?: string;
};

export type SeriesRow = {
  id: string;
  slug: string;
  name: string;
  weight: number;
  body_md: string;
  status: SeriesStatus;
  description: string;
  vision: string;
  tone: string;
  discovery_patterns: string[];
  examples: SeriesExample[];
  example_creators: string[];
  target_platforms: string[];
  enabled_post_types: string[];
  created_at: string;
  updated_at: string;
};

function stringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

function exampleArray(raw: unknown): SeriesExample[] {
  if (!Array.isArray(raw)) return [];
  const out: SeriesExample[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && v.trim()) {
      out.push({ hook: v.trim() });
    } else if (v != null && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const ex: SeriesExample = {};
      if (typeof o.hook === 'string' && o.hook.trim()) ex.hook = o.hook.trim();
      if (typeof o.notes === 'string' && o.notes.trim()) ex.notes = o.notes.trim();
      if (typeof o.url === 'string' && o.url.trim()) ex.url = o.url.trim();
      if (ex.hook || ex.notes || ex.url) out.push(ex);
    }
  }
  return out;
}

export function normalizeSeriesRow(raw: Record<string, unknown>): SeriesRow {
  const weight = Number(raw.weight);
  return {
    id: String(raw.id),
    slug: String(raw.slug ?? '').trim(),
    name: String(raw.name ?? '').trim(),
    weight: Number.isFinite(weight) ? weight : 1,
    body_md: String(raw.body_md ?? ''),
    status: raw.status === 'archived' ? 'archived' : 'active',
    description: String(raw.description ?? ''),
    vision: String(raw.vision ?? ''),
    tone: String(raw.tone ?? ''),
    discovery_patterns: stringArray(raw.discovery_patterns),
    examples: exampleArray(raw.examples),
    example_creators: stringArray(raw.example_creators),
    target_platforms: stringArray(raw.target_platforms),
    enabled_post_types: stringArray(raw.enabled_post_types),
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? ''),
  };
}

/** True when the series allows the given post type (empty config = all types allowed). */
export function seriesAllowsPostType(series: SeriesRow, postType: string): boolean {
  if (series.enabled_post_types.length === 0) return true;
  return series.enabled_post_types.includes(postType);
}

export async function loadActiveSeries(supabase: SupabaseClient | null): Promise<SeriesRow[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('content_series')
    .select('*')
    .eq('status', 'active')
    .order('weight', { ascending: false })
    .order('name', { ascending: true });

  if (error || !Array.isArray(data)) return [];
  return data.map((row) => normalizeSeriesRow(row as Record<string, unknown>));
}

function normalizeWeights(series: SeriesRow[]): Array<SeriesRow & { normalizedWeight: number }> {
  const total = series.reduce((sum, s) => sum + Math.max(0, s.weight), 0);
  if (total <= 0) {
    const even = series.length > 0 ? 1 / series.length : 0;
    return series.map((s) => ({ ...s, normalizedWeight: even }));
  }
  return series.map((s) => ({
    ...s,
    normalizedWeight: Math.max(0, s.weight) / total,
  }));
}

/** Compact markdown block injected into Gemini system instructions. */
export function formatSeriesBlockForPrompt(series: SeriesRow[]): string {
  if (series.length === 0) return '';

  const weighted = normalizeWeights(series);
  const parts: string[] = [
    '## Active content series (operator-approved)',
    '',
    'Pick exactly one **primary series** per candidate. Bias selection toward higher-weight series.',
    'Reuse a listed hook when it fits, or write a new hook in that series voice.',
    '',
  ];

  for (const s of weighted) {
    const pct = Math.round(s.normalizedWeight * 100);
    parts.push(`### ${s.name} (\`${s.slug}\`, weight ${s.weight}, ~${pct}% bias)`);
    parts.push('');
    if (s.description.trim()) parts.push(`Description: ${s.description.trim()}`);
    if (s.vision.trim()) parts.push(`Vision: ${s.vision.trim()}`);
    if (s.tone.trim()) parts.push(`Tone: ${s.tone.trim()}`);
    if (s.discovery_patterns.length > 0) {
      parts.push(`Discovery patterns: ${s.discovery_patterns.join('; ')}`);
    }
    if (s.enabled_post_types.length > 0) {
      parts.push(`Enabled post types: ${s.enabled_post_types.join(', ')}`);
    }
    if (s.example_creators.length > 0) {
      parts.push(`Example creators (style references): ${s.example_creators.join(', ')}`);
    }
    if (s.examples.length > 0) {
      parts.push('Example posts:');
      for (const ex of s.examples.slice(0, 8)) {
        const bits = [ex.hook, ex.notes].filter((t) => t?.trim());
        if (bits.length > 0) parts.push(`- ${bits.join(' — ')}`);
      }
    }
    if (s.body_md.trim()) {
      parts.push('');
      parts.push(s.body_md.trim());
    }
    parts.push('');
  }

  return parts.join('\n').trim();
}

export function appendSeriesToSystemInstruction(
  baseInstruction: string,
  series: SeriesRow[],
): string {
  const block = formatSeriesBlockForPrompt(series).trim();
  if (!block) return baseInstruction;
  const base = baseInstruction.trim();
  if (!base) return block;
  return `${base}${STABLE_SECTION_SEPARATOR}${block}`;
}

export async function loadComposedSystemInstructionWithSeries(
  supabase: SupabaseClient | null,
  baseInstruction: string,
): Promise<{ instruction: string; activeSeries: SeriesRow[] }> {
  const activeSeries = await loadActiveSeries(supabase);
  return {
    instruction: appendSeriesToSystemInstruction(baseInstruction, activeSeries),
    activeSeries,
  };
}
