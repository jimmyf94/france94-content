import type { SupabaseClient } from '@supabase/supabase-js';

const PIPELINE_SINGLETON = true;

/** Whether clip-based reels should auto-queue render jobs (generation, approve, variants). */
export async function loadAutoReelRenderEnabled(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase
    .from('pipeline_settings')
    .select('auto_reel_render_enabled')
    .eq('singleton', PIPELINE_SINGLETON)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.auto_reel_render_enabled === true;
}
