import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

const SIGNED_URL_TTL_SECONDS = 60 * 60;
const REDIRECT_CACHE_SECONDS = 5 * 60;

export async function redirectToSignedStorageObject(params: {
  supabase: SupabaseClient;
  bucket: string;
  objectPath: string;
  logPrefix: string;
}): Promise<NextResponse> {
  const { supabase, bucket, objectPath, logPrefix } = params;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    const msg = error?.message ?? 'Signed URL failed';
    console.error(logPrefix, objectPath, msg);
    return NextResponse.json({ error: msg }, { status: 404 });
  }

  const res = NextResponse.redirect(data.signedUrl, 307);
  res.headers.set('Cache-Control', `private, max-age=${REDIRECT_CACHE_SECONDS}`);
  return res;
}
