'use client';

import { useEffect, useState } from 'react';

import { readJsonResponse } from '@/lib/read-json-response';
import type { CandidateLlmPipelineResponse, CandidateLlmPipelineStep } from '@/lib/candidate-llm-pipeline';

import type { PostCandidate } from '../types';

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-2 break-all">
      <span className="font-medium text-[var(--text)]">{k}:</span>
      <span>{v}</span>
    </div>
  );
}

function statusBadge(status: CandidateLlmPipelineStep['status']) {
  const cls =
    status === 'success'
      ? 'border-[var(--good)] text-[var(--good)]'
      : status === 'failed'
        ? 'border-[var(--bad)] text-[var(--bad)]'
        : 'border-[var(--border)] text-[var(--muted)]';
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>
      {status}
    </span>
  );
}

function PipelineStepCard({ step, defaultOpen }: { step: CandidateLlmPipelineStep; defaultOpen?: boolean }) {
  return (
    <details
      open={defaultOpen}
      className="rounded-md border border-[var(--border)] bg-[var(--surface-2)]"
    >
      <summary className="cursor-pointer list-none px-3 py-2 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[var(--text)]">{step.label}</span>
          {statusBadge(step.status)}
          {step.model ? (
            <span className="font-mono text-[10px] text-[var(--muted)]">{step.model}</span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-[var(--muted)]">
          {step.operation ? <span>{step.operation}</span> : null}
          {step.timestamp ? <span>{new Date(step.timestamp).toLocaleString()}</span> : null}
          {step.telemetry?.outputTokens != null ? (
            <span>{step.telemetry.outputTokens.toLocaleString()} out tok</span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {step.promptKeys.map((k) => (
            <span
              key={k}
              className="rounded bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--muted)]"
            >
              {k}
            </span>
          ))}
        </div>
      </summary>
      <div className="space-y-3 border-t border-[var(--border)] px-3 py-3">
        {step.inputText ? (
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
              Input
            </div>
            <pre className="scrollbar-thin mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--border)] bg-[var(--bg)] p-2 text-[11px] text-[var(--text)]">
              {step.inputText}
            </pre>
          </div>
        ) : null}
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
            Output
          </div>
          <pre className="scrollbar-thin mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--border)] bg-[var(--bg)] p-2 text-[11px] text-[var(--text)]">
            {step.outputText ?? '(no output stored)'}
          </pre>
        </div>
        <details className="rounded border border-[var(--border)] bg-[var(--surface)] p-2">
          <summary className="cursor-pointer text-[10px] font-medium text-[var(--muted)]">
            Prompt text ({step.promptKeys.length} key{step.promptKeys.length === 1 ? '' : 's'})
          </summary>
          <div className="mt-2 space-y-2">
            {step.promptKeys.map((key) => (
              <div key={key}>
                <div className="font-mono text-[10px] text-[var(--text)]">{key}</div>
                <pre className="scrollbar-thin mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[10px] text-[var(--muted)]">
                  {step.promptTexts[key] ?? '(prompt not loaded)'}
                </pre>
              </div>
            ))}
          </div>
        </details>
      </div>
    </details>
  );
}

export function DebugTab({ candidate }: { candidate: PostCandidate }) {
  const [pipeline, setPipeline] = useState<CandidateLlmPipelineResponse | null>(null);
  const [pipelineErr, setPipelineErr] = useState<string | null>(null);
  const [loadingPipeline, setLoadingPipeline] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingPipeline(true);
      setPipelineErr(null);
      try {
        const res = await fetch(`/api/content-review/candidates/${candidate.id}/llm-pipeline`, {
          credentials: 'include',
        });
        const json = await readJsonResponse<CandidateLlmPipelineResponse & { error?: string }>(res);
        if (!res.ok) throw new Error(json.error || res.statusText);
        if (!cancelled) setPipeline(json);
      } catch (e) {
        if (!cancelled) {
          setPipeline(null);
          setPipelineErr(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoadingPipeline(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candidate.id]);

  return (
    <div className="space-y-4 text-xs text-[var(--muted)]">
      <section>
        <h3 className="text-sm font-semibold text-[var(--text)]">LLM pipeline</h3>
        <p className="mt-1">
          Ordered steps for this candidate: source-asset analysis, generation, and any regenerations.
          Prompt keys and stored outputs are shown per step.
        </p>
        {loadingPipeline ? <p className="mt-2">Loading pipeline…</p> : null}
        {pipelineErr ? <p className="mt-2 text-[var(--bad)]">{pipelineErr}</p> : null}
        {pipeline?.steps.length ? (
          <div className="mt-3 space-y-2">
            {pipeline.steps.map((step, i) => (
              <PipelineStepCard key={step.id} step={step} defaultOpen={i === pipeline.steps.length - 1} />
            ))}
          </div>
        ) : !loadingPipeline && !pipelineErr ? (
          <p className="mt-2">No pipeline steps found.</p>
        ) : null}
      </section>

      <section className="border-t border-[var(--border)] pt-4">
        <h3 className="text-sm font-semibold text-[var(--text)]">Content collisions</h3>
        <div className="mt-2 space-y-2">
          {candidate.collision_risk ? (
            <KV k="collision_risk" v={candidate.collision_risk} />
          ) : null}
          {candidate.collision_summary ? (
            <KV k="collision_summary" v={candidate.collision_summary} />
          ) : null}
          {candidate.selected_series ? <KV k="selected_series" v={candidate.selected_series} /> : null}
          {candidate.collision_overridden_at ? (
            <KV
              k="collision_overridden"
              v={`${candidate.collision_overridden_by ?? 'unknown'} @ ${candidate.collision_overridden_at}`}
            />
          ) : null}
        </div>
        {candidate.collision_details != null &&
        typeof candidate.collision_details === 'object' &&
        Array.isArray((candidate.collision_details as { collisions?: unknown }).collisions) ? (
          <ul className="mt-3 space-y-2">
            {(
              candidate.collision_details as {
                collisions: Array<{
                  against_label?: string;
                  kind?: string;
                  reason?: string;
                }>;
              }
            ).collisions.map((c, i) => (
              <li
                key={i}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-2"
              >
                <div className="font-medium text-[var(--text)]">
                  {c.against_label ?? 'Committed post'}
                  {c.kind ? (
                    <span className="ml-1 font-normal text-[var(--muted)]">({c.kind})</span>
                  ) : null}
                </div>
                {c.reason ? <div className="mt-1 text-[var(--muted)]">{c.reason}</div> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2">No collision detail rows (run generation or check collision_details).</p>
        )}
      </section>

      <section className="border-t border-[var(--border)] pt-4">
        <h3 className="text-sm font-semibold text-[var(--text)]">Identifiers</h3>
        <div className="mt-2 space-y-2">
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
        </div>
      </section>

      {candidate.llm_raw != null && (
        <details className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
          <summary className="cursor-pointer text-[var(--text)]">Raw LLM payload (latest)</summary>
          <pre className="scrollbar-thin mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words">
            {JSON.stringify(candidate.llm_raw, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
