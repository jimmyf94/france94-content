import type { PostCandidate } from './types';

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{title}</h4>
      <div className="space-y-2 text-[var(--text)]">{children}</div>
    </section>
  );
}

function ReelBlock({ data }: { data: Record<string, unknown> }) {
  const dur = data.estimated_duration_seconds;
  const structure = Array.isArray(data.structure) ? data.structure : [];
  const overlays = Array.isArray(data.overlay_text) ? data.overlay_text : [];
  const thumb = typeof data.thumbnail_text === 'string' ? data.thumbnail_text : null;

  return (
    <div className="space-y-3">
      {typeof dur === 'number' && (
        <p>
          <span className="text-[var(--muted)]">Estimated duration:</span> {dur}s
        </p>
      )}
      {structure.length > 0 && (
        <div>
          <p className="mb-1 text-[var(--muted)]">Structure / timeline</p>
          <ul className="list-inside list-disc space-y-1">
            {structure.map((row: unknown, i: number) => {
              const r = row as Record<string, unknown>;
              const t = typeof r.time === 'string' ? r.time : '';
              const ins = typeof r.instruction === 'string' ? r.instruction : '';
              return (
                <li key={i}>
                  <span className="font-medium text-[var(--accent)]">{t}</span> {ins}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {overlays.length > 0 && (
        <div>
          <p className="mb-1 text-[var(--muted)]">Overlay text</p>
          <ul className="list-inside list-decimal space-y-1">
            {overlays.map((o: unknown, i: number) => (
              <li key={i}>{String(o)}</li>
            ))}
          </ul>
        </div>
      )}
      {thumb && (
        <p>
          <span className="text-[var(--muted)]">Thumbnail text:</span> {thumb}
        </p>
      )}
    </div>
  );
}

function StoryFramesBlock({ frames }: { frames: unknown[] }) {
  return (
    <ul className="space-y-3">
      {frames.map((raw, i: number) => {
        const f = raw as Record<string, unknown>;
        const frame = f.frame ?? i + 1;
        const overlay = typeof f.overlay_text === 'string' ? f.overlay_text : '';
        const interaction = typeof f.interaction === 'string' ? f.interaction : '';
        const asset = f.asset_id != null ? String(f.asset_id) : '';
        return (
          <li key={i} className="rounded border border-[var(--border)] p-2">
            <div className="font-medium text-[var(--accent)]">Frame {String(frame)}</div>
            {asset && (
              <div className="text-xs text-[var(--muted)]">Asset: {asset}</div>
            )}
            {overlay && <p className="mt-1">{overlay}</p>}
            {interaction && (
              <p className="mt-1 text-xs text-[var(--muted)]">Interaction: {interaction}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CarouselBlock({ slides }: { slides: unknown[] }) {
  return (
    <ol className="space-y-3">
      {slides.map((raw, i: number) => {
        const s = raw as Record<string, unknown>;
        const slide = s.slide ?? i + 1;
        const headline = typeof s.headline === 'string' ? s.headline : '';
        const body = typeof s.body === 'string' ? s.body : '';
        const asset = s.asset_id != null ? String(s.asset_id) : '';
        return (
          <li key={i} className="rounded border border-[var(--border)] p-2">
            <div className="font-medium text-[var(--accent)]">Slide {String(slide)}</div>
            {headline && <p className="mt-1 font-medium">{headline}</p>}
            {body && <p className="mt-1 whitespace-pre-wrap">{body}</p>}
            {asset && (
              <p className="mt-1 text-xs text-[var(--muted)]">Asset ref: {asset}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StaticPostBlock({ data }: { data: Record<string, unknown> }) {
  const layout = typeof data.layout === 'string' ? data.layout : '';
  const main = typeof data.main_text === 'string' ? data.main_text : '';
  const secondary = typeof data.secondary_text === 'string' ? data.secondary_text : '';
  const cta = typeof data.cta === 'string' ? data.cta : '';

  return (
    <div className="space-y-2">
      {layout && (
        <p>
          <span className="text-[var(--muted)]">Layout:</span> {layout}
        </p>
      )}
      {main && (
        <div>
          <p className="text-[var(--muted)]">Main text</p>
          <p className="whitespace-pre-wrap">{main}</p>
        </div>
      )}
      {secondary && (
        <div>
          <p className="text-[var(--muted)]">Secondary text</p>
          <p className="whitespace-pre-wrap">{secondary}</p>
        </div>
      )}
      {cta && (
        <p>
          <span className="text-[var(--muted)]">CTA:</span> {cta}
        </p>
      )}
    </div>
  );
}

export function InstructionBlocks({ candidate }: { candidate: PostCandidate }) {
  const postType = candidate.post_type;

  if (postType === 'reel' && candidate.reel_instructions && typeof candidate.reel_instructions === 'object') {
    return (
      <Section title="Reel instructions">
        <ReelBlock data={candidate.reel_instructions as Record<string, unknown>} />
      </Section>
    );
  }

  if (postType === 'story_sequence' && Array.isArray(candidate.story_frames)) {
    return (
      <Section title="Story frames">
        <StoryFramesBlock frames={candidate.story_frames} />
      </Section>
    );
  }

  if (postType === 'carousel' && Array.isArray(candidate.carousel_slides)) {
    return (
      <Section title="Carousel slides">
        <CarouselBlock slides={candidate.carousel_slides} />
      </Section>
    );
  }

  if (
    postType === 'static_post' &&
    candidate.static_post_instructions &&
    typeof candidate.static_post_instructions === 'object'
  ) {
    return (
      <Section title="Static post instructions">
        <StaticPostBlock data={candidate.static_post_instructions as Record<string, unknown>} />
      </Section>
    );
  }

  return null;
}

export function RawJsonAccordion({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null;
  const text = JSON.stringify(value, null, 2);
  return (
    <details className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-xs">
      <summary className="cursor-pointer text-[var(--muted)]">{label}</summary>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[var(--muted)]">{text}</pre>
    </details>
  );
}
