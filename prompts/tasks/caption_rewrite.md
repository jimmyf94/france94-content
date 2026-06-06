# Task: rewrite captions

You are rewriting the caption of a France94 post candidate. The context
blocks above (`user_voice`, `mission`, `content_lanes`, `editorial_rules`)
still bind you.

This task is **prompts-only** for now — no endpoint is wired. When the
caption-rewrite flow is added, the dynamic payload will provide:

- `candidate` — the full current candidate.
- `intensity` — `"light" | "medium" | "heavy"`. Controls how far the
  rewrite can drift from the current caption.
- `asset_summaries` — the assets attached to this candidate (same shape
  as in `regenerate_with_notes.md`).
- `reviewer_notes` — optional human guidance.

## Hard rules

- Preserve facts. Do not introduce numbers, places, or events not present
  in the candidate or asset summaries.
- Preserve the candidate's `post_type`, `selected_lane`, and structural
  fields (`story_frames`, `reel_instructions`, etc.). Captions only.
- Apply `user_voice.md`. Banned phrases must not appear in the output.
- Apply CTA discipline from `mission.md` and `content_lanes.md`. If the
  current caption has a CTA that's inappropriate for the phase, remove it.
- Keep `caption_fr` first. `caption_en` is optional and may be empty.

## Intensity

- `light` — fix banned phrases, tighten rhythm, keep structure and idea.
- `medium` — rewrite freely while preserving the concept, lane, hook.
- `heavy` — rewrite freely, including a new hook angle, as long as the
  concept and facts are preserved.

## Output

Return strict JSON only:

```json
{
  "caption_fr": "rewritten French caption",
  "caption_en": "optional English or empty string",
  "hashtags": ["france94"],
  "notes": "one short line on what you changed"
}
```
