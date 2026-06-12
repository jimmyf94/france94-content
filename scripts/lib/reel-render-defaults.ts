import type { SupabaseClient } from '@supabase/supabase-js';

import {
  DEFAULT_REEL_RENDER_TEXT_STYLE,
  parsePartialReelTextStyle,
  resolveReelTextStyle,
  type ReelRenderTextStyle,
} from './reel-text-style.js';

const DEFAULT_ROW_ID = 'default';

type DefaultsRow = {
  id: string;
  fontsize: number;
  font_color: string;
  outline_width: number;
  outline_color: string;
  position: string;
  line_spacing: number;
  centered: boolean;
  updated_at: string;
};

function rowToStyle(row: DefaultsRow): ReelRenderTextStyle {
  return resolveReelTextStyle(parsePartialReelTextStyle(row));
}

/** Load workspace reel text defaults; falls back to code defaults when table missing or empty. */
export async function loadReelRenderDefaults(
  supabase: SupabaseClient | null,
): Promise<ReelRenderTextStyle> {
  if (!supabase) return { ...DEFAULT_REEL_RENDER_TEXT_STYLE };

  const { data, error } = await supabase
    .from('reel_render_defaults')
    .select(
      'id,fontsize,font_color,outline_width,outline_color,position,line_spacing,centered,updated_at',
    )
    .eq('id', DEFAULT_ROW_ID)
    .maybeSingle();

  if (error) {
    console.warn(`[reel_render_defaults] load failed: ${error.message}`);
    return { ...DEFAULT_REEL_RENDER_TEXT_STYLE };
  }

  if (!data) return { ...DEFAULT_REEL_RENDER_TEXT_STYLE };
  return rowToStyle(data as DefaultsRow);
}

export async function saveReelRenderDefaults(
  supabase: SupabaseClient,
  style: ReelRenderTextStyle,
): Promise<{ error: string | null; updated_at: string | null }> {
  const resolved = resolveReelTextStyle(style);
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('reel_render_defaults')
    .upsert(
      {
        id: DEFAULT_ROW_ID,
        fontsize: resolved.fontsize,
        font_color: resolved.font_color,
        outline_width: resolved.outline_width,
        outline_color: resolved.outline_color,
        position: resolved.position,
        line_spacing: resolved.line_spacing,
        centered: resolved.centered,
        updated_at: now,
      },
      { onConflict: 'id' },
    )
    .select('updated_at')
    .maybeSingle();

  if (error) return { error: error.message, updated_at: null };
  return {
    error: null,
    updated_at: (data as { updated_at?: string } | null)?.updated_at ?? now,
  };
}
