import type { PostCandidate } from '../types';

function SectionWrap({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 text-sm">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        {title}
      </h3>
      <div>{children}</div>
    </section>
  );
}

function ReelView({ data }: { data: Record<string, unknown> }) {
  const dur = typeof data.estimated_duration_seconds === 'number' ? data.estimated_duration_seconds : null;
  const structure = Array.isArray(data.structure) ? data.structure : [];
  const overlays = Array.isArray(data.overlay_text) ? data.overlay_text : [];
  const thumb = typeof data.thumbnail_text === 'string' ? data.thumbnail_text : null;
  return (
    <div className="space-y-3">
      {dur != null && (
        <p>
          <span className="text-[var(--muted)]">Duration:</span> {dur}s
        </p>
      )}
      {structure.length > 0 && (
        <ol className="space-y-1">
          {structure.map((row, i) => {
            const r = (row ?? {}) as Record<string, unknown>;
            const time = typeof r.time === 'string' ? r.time : '';
            const inst = typeof r.instruction === 'string' ? r.instruction : '';
            return (
              <li key={i} className="rounded border border-[var(--border)] px-2 py-1.5">
                <span className="font-medium tabular-nums text-[var(--accent)]">{time}</span>{' '}
                {inst}
              </li>
            );
          })}
        </ol>
      )}
      {overlays.length > 0 && (
        <div>
          <p className="mb-1 text-[var(--muted)]">Overlays</p>
          <ul className="list-inside list-decimal space-y-1">
            {overlays.map((o, i) => (
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

function StoryFrames({ frames }: { frames: unknown[] }) {
  return (
    <ul className="space-y-2">
      {frames.map((raw, i) => {
        const f = (raw ?? {}) as Record<string, unknown>;
        const overlay = typeof f.overlay_text === 'string' ? f.overlay_text : '';
        const interaction = typeof f.interaction === 'string' ? f.interaction : '';
        const hasAsset = f.asset_id != null;
        return (
          <li key={i} className="rounded border border-[var(--border)] p-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">
              Frame {i + 1}
              {hasAsset && (
                <span className="ml-2 font-normal text-[var(--muted)]">· Asset #{i + 1}</span>
              )}
            </div>
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

function CarouselView({ slides }: { slides: unknown[] }) {
  return (
    <ol className="space-y-2">
      {slides.map((raw, i) => {
        const s = (raw ?? {}) as Record<string, unknown>;
        const headline = typeof s.headline === 'string' ? s.headline : '';
        const body = typeof s.body === 'string' ? s.body : '';
        const hasAsset = s.asset_id != null;
        return (
          <li key={i} className="rounded border border-[var(--border)] p-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">
              Slide {i + 1}
              {hasAsset && (
                <span className="ml-2 font-normal text-[var(--muted)]">· Asset #{i + 1}</span>
              )}
            </div>
            {headline && <p className="mt-1 font-medium">{headline}</p>}
            {body && <p className="mt-1 whitespace-pre-wrap">{body}</p>}
          </li>
        );
      })}
    </ol>
  );
}

function StaticView({ data }: { data: Record<string, unknown> }) {
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
          <p className="text-[var(--muted)]">Main</p>
          <p className="whitespace-pre-wrap">{main}</p>
        </div>
      )}
      {secondary && (
        <div>
          <p className="text-[var(--muted)]">Secondary</p>
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

export function StructureTab({ candidate }: { candidate: PostCandidate }) {
  const t = candidate.post_type;
  if (
    t === 'reel' &&
    candidate.reel_instructions &&
    typeof candidate.reel_instructions === 'object'
  ) {
    return (
      <SectionWrap title="Reel timeline">
        <ReelView data={candidate.reel_instructions as Record<string, unknown>} />
      </SectionWrap>
    );
  }
  if (t === 'story_sequence' && Array.isArray(candidate.story_frames)) {
    return (
      <SectionWrap title="Story frames">
        <StoryFrames frames={candidate.story_frames} />
      </SectionWrap>
    );
  }
  if (t === 'carousel' && Array.isArray(candidate.carousel_slides)) {
    return (
      <SectionWrap title="Carousel slides">
        <CarouselView slides={candidate.carousel_slides} />
      </SectionWrap>
    );
  }
  if (
    t === 'static_post' &&
    candidate.static_post_instructions &&
    typeof candidate.static_post_instructions === 'object'
  ) {
    return (
      <SectionWrap title="Static post">
        <StaticView data={candidate.static_post_instructions as Record<string, unknown>} />
      </SectionWrap>
    );
  }
  return <p className="text-sm text-[var(--muted)]">No structure for this post type.</p>;
}
