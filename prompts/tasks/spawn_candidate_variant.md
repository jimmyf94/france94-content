# Task: spawn a candidate variant from a working post

You are creating **one new France94 post candidate** as an iteration of a
post that already performed well or was published. The context blocks above
(`user_voice`, `mission`, `editorial_rules`) and the active content series
block still bind you.

## Input

A dynamic JSON payload follows this prompt. It contains:

- `spawn_mode` — one of:
  - `keep_text_change_assets` — preserve hook, captions, concept, and series;
    pick different assets from the pool and align structure to them.
  - `shuffle_assets` — preserve text closely; reorder or swap assets within
    the allowed pool (same post type).
  - `shuffle_assets_and_text` — create a **sibling iteration**: same winning
    idea, narrative function, and structure; fresh footage and refreshed wording.
- `operator_notes` — optional human direction (may be empty).
- `source_candidate` — the published/working candidate (post_type, title,
  hook, captions, structure fields, scores, selected_series).
- `source_structure_contract` — hard constraints from the source:
  - `source_asset_count`, `source_clip_count`, `source_slide_count`
  - `preserve_asset_count`, `preserve_clip_count`
  - `creative_anchors` — hook, caption_fr, concept_summary, title, series
- `asset_summaries` — assets you may use. Every `source_asset_ids` entry and
  every `asset_id` inside structure fields **must** come from this list.
  Source assets from the published post are **excluded** from this list for
  replacement modes.

## Creative DNA (all modes)

The source post worked. Your iteration must feel like a **direct sibling**,
not a generic new POV from scratch.

- Read `creative_anchors` and `source_candidate` before writing anything.
- Keep the same `post_type` and `selected_series` unless operator notes say otherwise.
- Match `source_structure_contract.source_asset_count` exactly when
  `preserve_asset_count` is true.
- For clip reels, match `source_clip_count` when `preserve_clip_count` is true.
- Do not invent a unrelated motivational POV if the source hook was specific.

## Rules by mode

### keep_text_change_assets

- Keep `caption_fr`, `caption_en`, `hook`, and `concept_summary` as close as
  possible to the source (minor punctuation fixes only).
- Change `source_asset_ids` to a **different** set from `asset_summaries`.
- Rebuild structure fields to reference the new assets only.
- Preserve clip count and total duration band when the source was a clip reel.

### shuffle_assets

- Keep text fields nearly identical to the source.
- Change asset selection or order materially within `asset_summaries`.
- Do not rewrite hooks/captions unless a structure field requires a tiny fix.
- Preserve asset count and clip/slide count from the structure contract.

### shuffle_assets_and_text

- Preserve the **core premise** from `creative_anchors`: same emotional angle,
  narrative function, and series fit as the source.
- Refresh hook, overlay, and caption enough to feel new — not a copy-paste,
  but clearly the same idea wearing different words.
- At least one of hook or caption must visibly echo the source premise
  (shared key nouns, situation, or tension).
- Use a **fresh** asset set from `asset_summaries`; never reuse source assets.
- Preserve asset count and clip/slide count from the structure contract.
- For clip reels: pick clips that support the same script angle, not random
  generic POV footage.

## Voice and editorial

- Apply forbidden phrases from `user_voice.md`.
- French-first captions.
- Avoid generic growth-hack tone. Stay Jimmy / France94.

## Output

Return **strict JSON only**, no markdown fences. Return **one candidate object at the top level** — do not wrap it in `{ "candidates": [...] }`.

Exactly one candidate:

```json
{
  "post_type": "reel | story_sequence | carousel | static_post | sponsor_post | archive_note",
  "title": "short internal title",
  "hook": "front-facing hook",
  "concept_summary": "what the post is about",
  "rationale": "why this iteration should work as a sibling of the source",
  "caption_fr": "French caption draft",
  "caption_en": "optional English caption or empty string",
  "hashtags": ["france94"],
  "source_asset_ids": ["uuid"],
  "source_drive_file_ids": ["drive_id"],
  "priority_score": 0,
  "mission_score": 0,
  "human_score": 0,
  "sponsor_safety_score": 0,
  "effort_score": 0,
  "selected_series": "series-slug",
  "series_reasoning": "why this series still fits",
  "target_audience": "who this is for",
  "asset_fit_score": 0,
  "caption_strategy": "one sentence",
  "overlay_strategy": "one sentence or empty",
  "cta_strategy": "explicit | implicit | none | donation",
  "warnings": [],
  "story_frames": [],
  "reel_instructions": {},
  "carousel_slides": [],
  "static_post_instructions": {}
}
```

Format-specific sub-objects use the same shapes as `generate_candidate.md`.
Every `source_drive_file_id` must match the drive id of its paired asset.
