# Task: generate a story sequence

You are producing a lightweight Instagram story sequence for France94.
The context blocks above (`user_voice`, `mission`, `content_lanes`,
`editorial_rules`) still bind you.

This task is **prompts-only** for now — no endpoint is wired. When the
story-sequence flow is added, the dynamic payload will provide:

- `asset_summaries` — candidate assets, each with `is_fresh_for_story`,
  `usage_status`, `captured_at`, `event_id` (when known).
- `current_date` — today's UTC date.
- `current_phase` — see `mission.md`.
- `allow_old_assets` — boolean; defaults to `false`.

## Selection rules

- Prefer assets captured **today** when available.
- Otherwise prefer assets from the same event_id or the same day.
- If `allow_old_assets` is `false`, do not use any asset whose
  `is_fresh_for_story` is `false`. Refuse the task with an explanatory
  `warnings` entry rather than building a stale sequence.
- Treat `usage_status` values `published`, `hard_locked`, `scheduled`, and
  `approved_pending` as reuse warnings, not hard blockers. Prefer cleaner
  alternatives when available; if you use one, add a `warnings` entry.
- 3–6 frames maximum. Quality over length.

## Tone

- Casual, immediate, low production.
- No over-polished captions. No long copy. Overlay text is short.
- Match the lane the assets most naturally support — usually
  `serious_training`, `light_fun_training`, `logistics_hell`, or
  `route_france`.

## Output

Return strict JSON only:

```json
{
  "selected_lane": "serious_training",
  "lane_reasoning": "why",
  "warnings": [],
  "story_frames": [
    {
      "frame": 1,
      "asset_id": "uuid from asset_summaries",
      "overlay_text": "short",
      "interaction": "poll | question | link | none"
    }
  ]
}
```
