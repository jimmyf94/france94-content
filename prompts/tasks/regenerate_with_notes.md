# Task: regenerate a candidate from reviewer notes

You are rewriting **one existing France94 post candidate** after human
review. The context blocks above (`user_voice`, `mission`, `content_lanes`,
`editorial_rules`) still bind you.

## Input

A dynamic JSON payload follows this prompt. It contains:

- `reviewer_notes` — what Jimmy wants changed (may be terse or vague).
- `candidate` — the current candidate structure (post_type, title, hook,
  caption_fr, caption_en, hashtags, story_frames, reel_instructions,
  carousel_slides, static_post_instructions, scores).
- `asset_summaries` — the assets **currently** attached to this candidate.
  If the reviewer removed assets in the review UI, those assets are not
  here. Treat this list as the only valid asset universe.

## Source of truth

- The current `candidate` object is the source of truth for what already
  works. Preserve what is good.
- The current `asset_summaries` are the only assets you can reference.
  Never reuse asset ids that aren't in this list. Any asset id you put
  inside `story_frames` or `carousel_slides` must be in `asset_summaries`.
- The `reviewer_notes` describe the delta Jimmy wants. Apply them
  surgically.

## What to change

- Only change what the notes require, plus obviously broken pieces.
- If the notes are silent on a field, leave it close to the current value.
- Keep the same `post_type` unless the notes clearly imply the format is
  wrong (e.g. "this should be a reel, not a static post"), or the assets
  no longer support the current format.
- Keep `selected_lane` the same unless the notes imply a better lane,
  or the assets no longer fit it.
- If the assets were reduced and the concept no longer works, lower the
  scores and add a `warnings` entry rather than inventing content.

## Voice and editorial

- Apply `user_voice.md` and `editorial_rules.md` exactly as in fresh
  generation. The forbidden-phrase list applies — if the current caption
  contains a banned phrase, fix it even if the notes don't mention it.
- French-first. English optional and concise.
- CTA discipline from `mission.md` and `content_lanes.md` applies.

## Output

Return **strict JSON only**, no markdown fences, no commentary. Exactly
one rewritten candidate using this schema:

```json
{
  "post_type": "reel | story_sequence | carousel | static_post | sponsor_post | archive_note",
  "title": "short internal title",
  "hook": "front-facing hook",
  "concept_summary": "what the post is about",
  "rationale": "why this should be made",
  "caption_fr": "French caption draft",
  "caption_en": "optional English caption or empty string",
  "hashtags": ["france94"],
  "priority_score": 0,
  "mission_score": 0,
  "human_score": 0,
  "sponsor_safety_score": 0,
  "effort_score": 0,
  "selected_lane": "serious_training",
  "secondary_flavor": "logistics_hell",
  "lane_reasoning": "why this lane still fits",
  "target_audience": "who this is for in one short phrase",
  "asset_fit_score": 0,
  "caption_strategy": "one sentence on what the caption is trying to do",
  "overlay_strategy": "one sentence on overlays/headlines (omit if not relevant)",
  "cta_strategy": "explicit | implicit | none | donation",
  "warnings": ["optional notes about asset weaknesses or risks"],
  "story_frames": [],
  "reel_instructions": {},
  "carousel_slides": [],
  "static_post_instructions": {}
}
```

Format-specific sub-objects (`reel_instructions`, `story_frames`,
`carousel_slides`, `static_post_instructions`) use the same shapes as
`generate_candidate.md`.

Scoring is on the same 0–10 scale.

The server preserves `source_asset_ids` and `source_drive_file_ids`
from the existing candidate, so do not include them in your output.
