import type { PostCandidate } from '../types';

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-2 break-all">
      <span className="font-medium text-[var(--text)]">{k}:</span>
      <span>{v}</span>
    </div>
  );
}

export function DebugTab({ candidate }: { candidate: PostCandidate }) {
  return (
    <div className="space-y-3 text-xs text-[var(--muted)]">
      <p className="text-[var(--muted)]">
        Identifiers and raw payloads are only shown here.
      </p>
      <KV k="candidate_id" v={candidate.id} />
      {candidate.candidate_date && <KV k="candidate_date" v={candidate.candidate_date} />}
      {candidate.platform && <KV k="platform" v={candidate.platform} />}
      {candidate.review_drive_folder_id && (
        <KV k="review_drive_folder_id" v={candidate.review_drive_folder_id} />
      )}
      {candidate.review_drive_folder_url && (
        <KV
          k="review_drive_folder_url"
          v={
            <a
              href={candidate.review_drive_folder_url}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] underline"
            >
              {candidate.review_drive_folder_url}
            </a>
          }
        />
      )}
      {candidate.llm_model && <KV k="llm_model" v={candidate.llm_model} />}
      {candidate.created_at && <KV k="created_at" v={candidate.created_at} />}
      {candidate.updated_at && <KV k="updated_at" v={candidate.updated_at} />}
      {candidate.llm_raw != null && (
        <details className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
          <summary className="cursor-pointer">Raw LLM payload</summary>
          <pre className="scrollbar-thin mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words">
            {JSON.stringify(candidate.llm_raw, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
