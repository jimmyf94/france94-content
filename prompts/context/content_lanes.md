# Editorial content lanes

These are the editorial lanes France94 publishes against. Every candidate
must pick exactly one **primary lane** and may pick one **secondary flavor**.
The lane selection drives tone, opening, and CTA strength.

Return the selected lane in the field `selected_lane` (exact name from the
list below, lowercase with underscores) and your reasoning in `lane_reasoning`.

---

## serious_training

- **Purpose**: prove this is real preparation, not a stunt.
- **When to use**: long sessions, hard sessions, swim/bike/run with real numbers,
  fatigue, recovery, injury management.
- **Tone**: factual, no drama. Numbers welcome (distance, time, heart rate,
  perceived effort). Honesty about what went badly.
- **Good openings**: "10 km. 38 min. Genoux qui crient." / "Première sortie
  vélo à jeun depuis…" / "Test du seuil aujourd'hui."
- **What to avoid**: motivational framing, "warrior" energy, dramatic music
  cues, photos of medals/podiums (not applicable here anyway).
- **Best formats**: static_post, carousel, story_sequence.
- **CTA strength**: very low. Usually no CTA.

## nerd_training

- **Purpose**: show the thinking behind training. Build credibility with
  endurance/sports-science audience.
- **When to use**: explaining a session structure, a periodization choice, a
  nutrition trial, a gear test, an HR/power zone analysis.
- **Tone**: curious, explanatory, slightly dry. Like talking to a coach over
  coffee.
- **Good openings**: "Pourquoi je fais une sortie de 40 km à 70 % FCmax aujourd'hui…"
  / "Petit test : gel toutes les 25 min vs 35 min."
- **What to avoid**: gatekeeping, jargon for jargon's sake, "I am the smartest
  triathlete in the room".
- **Best formats**: carousel (best fit), static_post, reel (when there's an asset).
- **CTA strength**: low. Optional "what would you test?" engagement prompt.

## logistics_hell

- **Purpose**: show the operational reality of moving across 94 departments
  in 94 days. Build trust by exposing friction.
- **When to use**: route planning headaches, accommodation problems, gear
  failures, weather, admin (insurance, permits, partners), transport between
  stages without motor.
- **Tone**: dry, slightly exasperated, often self-deprecating.
- **Good openings**: "Le problème c'est pas le vélo. C'est de dormir." /
  "94 départements. 94 nuits. Je viens de finir la 12e feuille Excel."
- **What to avoid**: complaining as a vibe (one-liners only), naming partners
  negatively, leaking confidential supplier info.
- **Best formats**: static_post, carousel, story_sequence, reel (talking head).
- **CTA strength**: low to medium. Sometimes "des idées d'hébergement dans le 23 ?"
  is appropriate.

## route_france

- **Purpose**: showcase the geography of the challenge — terrain, departments,
  rivers, climbs.
- **When to use**: location-tagged training, reconnaissance trips, scouting
  rides, a department's specifics, a swim spot, a climb.
- **Tone**: observational, place-first. Department number first if known.
- **Good openings**: "16. Charente. Fleuve plat, route défoncée." / "Premier
  test du bassin de la Vilaine."
- **What to avoid**: tourism-board language, "France is beautiful" as a
  punchline, postcard captions.
- **Best formats**: static_post, carousel, reel.
- **CTA strength**: very low. No CTA most of the time.

## mission_cause

- **Purpose**: connect the project to Institut Curie and cancer research,
  honestly and without guilt-tripping.
- **When to use**: a Curie update, an explanation of what the funds support,
  a personal note about why this mission, a partner milestone.
- **Tone**: serious, plain, no melodrama. State, don't sell.
- **Good openings**: "Pourquoi Curie." / "Ce que finance vraiment l'argent
  qu'on lèvera."
- **What to avoid**: "every kilometer saves a life" energy, candle-emoji
  reverence, recycled charity slogans, photos of patients.
- **Best formats**: static_post (best fit), carousel.
- **CTA strength**: medium to high — this is where donation CTAs are
  legitimate, but only with the current phase's CTA discipline.

## founder_human_build

- **Purpose**: show Jimmy as a person and the project as a human-scale build,
  not a media product.
- **When to use**: the why, the doubts, the day-job context, the team of one,
  process posts about building France94 itself.
- **Tone**: first person, plain, slightly vulnerable but never sentimental.
- **Good openings**: "8 mois je flottais comme un sac. Aujourd'hui 3000 m."
  / "Je raconte pourquoi je fais ça, version courte."
- **What to avoid**: hero arc framing, "I quit everything to chase…",
  third-person narration of Jimmy.
- **Best formats**: static_post, carousel, reel (talking head).
- **CTA strength**: low. Sometimes "subscribe to the newsletter" makes sense.

## event_milestone

- **Purpose**: mark a concrete milestone — a partner announcement, an
  open-water test passed, a first century ride, the route reveal, a press hit.
- **When to use**: only when something verifiable happened.
- **Tone**: announcement-grade but still grounded. The event speaks for itself.
- **Good openings**: "Officiel : Curie est partenaire." / "Premier 100 km vélo
  bouclé. Notes en story."
- **What to avoid**: inventing milestones, hyping a non-event, "huge news"
  with no news.
- **Best formats**: static_post (best fit for announcements), carousel.
- **CTA strength**: medium. CTAs should match the milestone (subscribe,
  donate, partner inquiry) and be specific.

## light_fun_training

- **Purpose**: lower-stakes posts that keep the feed human and varied.
- **When to use**: small training wins, funny mishaps, food, recovery,
  bike-cleaning, dog photos that are tangentially related.
- **Tone**: warm, dry, brief.
- **Good openings**: "Première fois que je rentre sans saigner du genou."
  / "Plan du dimanche : 0 km. C'est validé."
- **What to avoid**: forced-funny captions, "tag a friend who…", trend
  copycats with no asset support.
- **Best formats**: story_sequence, reel, static_post.
- **CTA strength**: none. Pure rhythm.

---

## Picking a lane

- Start from the **strongest signal in the assets**, not from a desired
  posting cadence.
- If two lanes fit, pick the lane the *assets* support best, then mention
  the other one as a `secondary_flavor`.
- Refuse to force `mission_cause` or `event_milestone` if there is no real
  hook in the assets — pick a training/logistics lane instead.
