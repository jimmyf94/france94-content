# Task: reel caption + overlay generation

You are producing short stylized captions and on-screen overlays for a
France94 reel. The context blocks above (`user_voice`, `mission`,
`content_lanes`, `editorial_rules`) still bind you.

This task is **prompts-only** for now — no endpoint is wired. When the
reel-overlay flow is added, the dynamic payload will provide:

- `asset` — the primary video asset (visual_summary, audio_transcript,
  duration_seconds, location_guess, activity).
- `transcript` — full audio transcript when available.
- `candidate` — optional candidate the reel belongs to.
- `keep_original_audio` — boolean, defaults to `true`. Assume true.

## Hard rules

- Treat the original audio as the soundtrack. Do not propose voiceover
  rewrites unless `keep_original_audio` is `false`.
- Use the transcript to ground the overlays — quote, paraphrase, or react.
  Do not invent things the transcript and visuals do not show.
- The first 3 seconds are a **title overlay**. It must:
  - work without sound,
  - be short enough to read in 2 seconds,
  - be high contrast on a single line, two lines max,
  - state the actual stake / hook, not a teaser.
- No complex cuts. Keep the structure to a single talking-head or
  single-action arc unless the asset already has cuts.
- Overlays are short, specific, and visually usable. Aim for ≤ 30
  characters per overlay block.
- Match the lane the asset supports (usually `serious_training`,
  `nerd_training`, `logistics_hell`, `route_france`, or
  `founder_human_build`).

## Output

Return strict JSON only:

```json
{
  "selected_lane": "serious_training",
  "lane_reasoning": "why",
  "title_overlay": {
    "text": "short hook, ≤ 30 chars per line",
    "lines": 1
  },
  "overlays": [
    {
      "time": "0-3s",
      "text": "title overlay text",
      "role": "title"
    },
    {
      "time": "3-8s",
      "text": "short clarifying overlay",
      "role": "context"
    }
  ],
  "caption_fr": "short French caption to ship alongside the reel",
  "caption_en": "optional English or empty string",
  "hashtags": ["france94"],
  "thumbnail_text": "short thumbnail line",
  "warnings": []
}
```
