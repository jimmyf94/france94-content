# Editorial rules

General output discipline. Apply to every content-generation task.

## Asset-first

- The assets in the dynamic payload are the source of truth.
- Caption, hook, overlay, and slide structure must come from what is visible
  / audible / tagged in those assets, plus their metadata and transcripts.
- Do not invent scenes, weather, locations, people, conversations, emotions,
  or events that the assets do not show or imply.
- If the assets are weak or off-topic, say so via `warnings` instead of
  fabricating a concept.

## Concreteness

- Prefer the exact terrain, session type, location, problem, gear, or
  constraint that appears in the assets.
- Numbers from metadata (distance, duration, department number, postal code,
  time of day) beat vague descriptors.
- Never write "a long ride" when the metadata says "78 km".

## Avoid LLM slop

- No generic endurance language.
- No generic charity language.
- No "let me take you through my journey" framings.
- No motivational closers.
- No hashtag dumps — keep hashtags purposeful and short (≤ 8).
- See `prompts/context/user_voice.md` for the full forbidden-phrases list.

## France94 explainer discipline

- Do **not** explain the full France94 project (94 triathlons / 94 days /
  94 departments / Curie) in every caption. It pollutes the feed.
- Include the full explainer **only** if:
  - the post is explicitly an introduction / explainer / milestone, OR
  - the dynamic payload says `assume_cold_audience: true`.
- A one-line tag like "France94 — 94 triathlons en 94 jours" is acceptable
  occasionally, not by default.

## CTA discipline

- Most posts do not need a CTA. Silence is fine.
- Match CTA strength to the lane (see `content_lanes.md`) and to the
  current phase (see `mission.md`).
- Donation CTAs (Curie) are only appropriate when:
  - the lane is `mission_cause` or `event_milestone`, AND
  - the current phase is `pre_challenge_build`, `challenge_live`, or
    `aftermath_legacy`.
  - In `foundation_public_build`, donation CTAs are reserved for explicit
    Curie-partnership posts only.
- Never close with "link in bio" unless there is something in bio worth
  pointing at right now.
- CTAs should be specific: "réponds en DM si tu connais un coin pour dormir
  dans le 23" beats "DM me".

## Language

- French-first. English is optional and should only appear when it adds
  something (international partner audience, a quote, a meme).
- `caption_en` can be empty string. That is the expected default.
- Do not translate the French caption word-for-word into English — that
  reads like a brochure. Either skip English or write a different angle.

## Structure rules per format

- Static post: one idea, one image, short caption.
- Carousel: max 8 slides, each slide stands on its own visually.
- Reel: hook in the first 2 seconds, overlay text short and high-contrast,
  no complex cuts required.
- Story sequence: 3–6 frames max, light and immediate.
- Sponsor post: sober tone, no fake hype, partner is named once.

## Safety / sponsor-safety

- No comments on other athletes' performance.
- No politics, no religion, no commentary on hot news cycles.
- No competitor partner names.
- No medical claims about training or recovery.
- No raw GPX traces of accommodations or daily routines that expose Jimmy's
  location in real-time.
