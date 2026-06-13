import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  activeTimedOverlayCueAtTime,
  DEFAULT_REEL_RENDER_TEXT_STYLE,
  drawtextColorValue,
  drawtextXExpression,
  drawtextYExpression,
  formatReelOverlayText,
  mergeHookWithOverlayLines,
  normalizeOverlayEndSec,
  normalizeReelSpecOverlay,
  normalizeTimedOverlayCues,
  parseOverlayEndSec,
  parsePartialReelTextStyle,
  parseReelOverlayDraft,
  parseTimedOverlayCues,
  resolveClipsV1ProductionSpec,
  resolveOverlayPreviewText,
  reelOverlayDraftDiffersFromRenderedSpec,
  resolveReelTextStyle,
  timedCueOverlapsOverlayEnd,
  wrapOverlayLine,
  wrapOverlayLinesForRender,
} from './reel-text-style.js';

describe('resolveReelTextStyle', () => {
  test('returns defaults when input empty', () => {
    const s = resolveReelTextStyle();
    assert.deepEqual(s, DEFAULT_REEL_RENDER_TEXT_STYLE);
  });

  test('workspace defaults apply before spec overrides', () => {
    const s = resolveReelTextStyle(
      { fontsize: 50 },
      { fontsize: 44, position: 'top' },
    );
    assert.equal(s.fontsize, 50);
    assert.equal(s.position, 'top');
  });

  test('clamps fontsize and outline', () => {
    const s = resolveReelTextStyle({ fontsize: 999, outline_width: -1 });
    assert.equal(s.fontsize, 72);
    assert.equal(s.outline_width, 0);
  });

  test('ignores invalid position', () => {
    const s = resolveReelTextStyle({ position: 'bottom' as 'top' });
    assert.equal(s.position, 'top_third');
  });
});

describe('drawtextColorValue', () => {
  test('converts 6-digit hex to 0xRRGGBB', () => {
    assert.equal(drawtextColorValue('#ffffff'), '0xFFFFFF');
    assert.equal(drawtextColorValue('#000000'), '0x000000');
  });

  test('converts 3-digit hex to 0xRRGGBB', () => {
    assert.equal(drawtextColorValue('#fff'), '0xFFFFFF');
    assert.equal(drawtextColorValue('#000'), '0x000000');
  });

  test('passes through named colors', () => {
    assert.equal(drawtextColorValue('white'), 'white');
    assert.equal(drawtextColorValue('black'), 'black');
  });
});

describe('drawtext expressions', () => {
  test('y positions', () => {
    assert.equal(drawtextYExpression('top_third'), '(h/3-text_h)/2');
    assert.equal(drawtextYExpression('top'), 'h*0.08');
    assert.equal(drawtextYExpression('center'), '(h-text_h)/2');
  });

  test('x centered vs left', () => {
    assert.equal(drawtextXExpression(true), '(w-text_w)/2');
    assert.equal(drawtextXExpression(false), 'w*0.05');
  });
});

describe('parsePartialReelTextStyle', () => {
  test('parses known fields', () => {
    const p = parsePartialReelTextStyle({
      fontsize: 42,
      font_color: 'yellow',
      position: 'center',
    });
    assert.ok(p);
    assert.equal(p!.fontsize, 42);
    assert.equal(p!.font_color, 'yellow');
    assert.equal(p!.position, 'center');
  });

  test('returns null for empty object', () => {
    assert.equal(parsePartialReelTextStyle({}), null);
  });

  test('coerces numeric strings from JSONB', () => {
    assert.deepEqual(parsePartialReelTextStyle({ fontsize: '48', outline_width: '6' }), {
      fontsize: 48,
      outline_width: 6,
    });
  });
});

describe('mergeHookWithOverlayLines', () => {
  test('uses hook lines when hook is multiline and extends first overlay line', () => {
    const hook =
      "pov : tu t'es dit que traverser la France\nen 94 triathlons était une bonne idée";
    assert.deepEqual(
      mergeHookWithOverlayLines(
        ['pov : tu t\'es dit que traverser la France', 'en 94 triathlons était une bonne idée'],
        hook,
      ),
      [
        "pov : tu t'es dit que traverser la France",
        'en 94 triathlons était une bonne idée',
      ],
    );
  });

  test('drops continuation line already contained in single-line hook', () => {
    const hook =
      "pov : tu t'es dit que traverser la France en 94 triathlons était une bonne idée";
    assert.deepEqual(
      mergeHookWithOverlayLines(
        ['pov : tu t\'es dit que traverser la France', 'en 94 triathlons était une bonne idée'],
        hook,
      ),
      [hook],
    );
  });

  test('dedupes when overlay_lines[0] already embeds newlines', () => {
    const embedded =
      "pov : tu t'es dit que traverser la France\nen 94 triathlons était une bonne idée";
    assert.deepEqual(
      mergeHookWithOverlayLines([embedded, 'en 94 triathlons était une bonne idée'], null),
      [
        "pov : tu t'es dit que traverser la France",
        'en 94 triathlons était une bonne idée',
      ],
    );
  });
});

describe('formatReelOverlayText', () => {
  test('joins multiple overlay lines', () => {
    assert.equal(
      formatReelOverlayText(['pov : line one', 'line two']),
      'pov : line one\nline two',
    );
  });

  test('prefers longer hook when it extends first overlay line', () => {
    assert.equal(
      formatReelOverlayText(['pov : tes potes prévoient leur week-end'], {
        hook: 'pov : tes potes prévoient leur week-end mais toi t\'aas 94 triathlons à preparer',
      }),
      'pov : tes potes prévoient leur week-end mais toi t\'aas 94 triathlons à preparer',
    );
  });

  test('falls back to hook when overlay empty', () => {
    assert.equal(formatReelOverlayText([], { hook: 'pov : test' }), 'pov : test');
  });
});

describe('parseReelOverlayDraft', () => {
  test('splits on newlines and trims', () => {
    assert.deepEqual(parseReelOverlayDraft(' line one \nline two\n'), ['line one', 'line two']);
  });
});

describe('normalizeReelSpecOverlay', () => {
  test('extends overlay_lines[0] from hook', () => {
    const spec = normalizeReelSpecOverlay(
      {
        version: 'clips-v1',
        overlay_lines: ['pov : short'],
        clips: [],
      },
      'pov : short but longer hook',
    );
    assert.deepEqual(spec.overlay_lines, ['pov : short but longer hook']);
  });
});

describe('resolveClipsV1ProductionSpec', () => {
  test('prefers candidate timed cues and text_style over stale job spec', () => {
    const spec = resolveClipsV1ProductionSpec(
      {
        version: 'clips-v1',
        clips: [{ clip_id: 'c1', asset_id: 'a1', start_sec: 0, end_sec: 2 }],
        timed_overlay_cues: [{ start_sec: 1, end_sec: 2, text: 'new cue' }],
        text_style: { fontsize: 52, font_color: '#ff0000' },
      },
      {
        version: 'clips-v1',
        clips: [{ clip_id: 'c1', asset_id: 'a1', start_sec: 0, end_sec: 2 }],
        overlay_lines: ['old static only'],
        text_style: { fontsize: 38, font_color: 'white' },
      },
    );
    assert.equal(spec?.version, 'clips-v1');
    assert.deepEqual(spec?.timed_overlay_cues, [{ start_sec: 1, end_sec: 2, text: 'new cue' }]);
    assert.deepEqual(spec?.text_style, { fontsize: 52, font_color: '#ff0000' });
  });

  test('falls back to job clips when candidate has none', () => {
    const spec = resolveClipsV1ProductionSpec(
      {
        version: 'clips-v1',
        timed_overlay_cues: [{ start_sec: 0, end_sec: 1, text: 'cue' }],
      },
      {
        version: 'clips-v1',
        clips: [{ clip_id: 'c1', asset_id: 'a1', start_sec: 0, end_sec: 2 }],
      },
    );
    assert.deepEqual(spec?.clips, [{ clip_id: 'c1', asset_id: 'a1', start_sec: 0, end_sec: 2 }]);
  });
});

describe('reelOverlayDraftDiffersFromRenderedSpec', () => {
  test('detects timed cue changes against produced spec', () => {
    const style = resolveReelTextStyle({ fontsize: 40 });
    const differs = reelOverlayDraftDiffersFromRenderedSpec({
      draftOverlay: 'intro',
      draftOverlayEndSec: 5,
      draftTimedCues: [{ start_sec: 10, end_sec: 16, text: 'new cue' }],
      draftStyle: style,
      renderedSpec: {
        overlay_lines: ['intro'],
        overlay_end_sec: 5,
        timed_overlay_cues: [{ start_sec: 5, end_sec: 10, text: 'old cue' }],
        text_style: style,
      },
    });
    assert.equal(differs, true);
  });

  test('returns false when draft matches produced spec', () => {
    const style = resolveReelTextStyle({ fontsize: 40 });
    const cues = [
      { start_sec: 5, end_sec: 10, text: 'mid' },
      { start_sec: 10, end_sec: 16, text: 'end' },
    ];
    const differs = reelOverlayDraftDiffersFromRenderedSpec({
      draftOverlay: 'intro',
      draftOverlayEndSec: 5,
      draftTimedCues: cues,
      draftStyle: style,
      renderedSpec: {
        overlay_lines: ['intro'],
        overlay_end_sec: 5,
        timed_overlay_cues: cues,
        text_style: style,
      },
    });
    assert.equal(differs, false);
  });
});

describe('wrapOverlayLine', () => {
  test('wraps long POV lines for 1080px frame', () => {
    const long =
      "pov : tes potes prévoient leur week-end mais toi t'as 94 triathlons à preparer pour l'année prochaine, l'eau commence à se réchauffer";
    const lines = wrapOverlayLine(long, { fontSize: 38 });
    assert.ok(lines.length >= 2);
    assert.ok(lines.every((l) => l.length <= 45));
    assert.equal(lines.join(' '), long);
  });

  test('keeps short lines on one row', () => {
    assert.deepEqual(wrapOverlayLine('pov : court', { fontSize: 38 }), ['pov : court']);
  });
});

describe('wrapOverlayLinesForRender', () => {
  test('joins wrapped physical lines with newlines', () => {
    const out = wrapOverlayLinesForRender(
      [
        "pov : tes potes prévoient leur week-end mais toi t'as 94 triathlons à preparer pour l'année prochaine",
      ],
      { fontsize: 38 },
    );
    assert.ok(out.includes('\n'));
  });
});

describe('parseTimedOverlayCues', () => {
  test('parses valid cue rows', () => {
    assert.deepEqual(
      parseTimedOverlayCues([
        { start_sec: 0, end_sec: 2.5, text: 'hook line' },
        { start_sec: 2.5, end_sec: 8, text: 'body line' },
      ]),
      [
        { start_sec: 0, end_sec: 2.5, text: 'hook line' },
        { start_sec: 2.5, end_sec: 8, text: 'body line' },
      ],
    );
  });

  test('drops invalid rows', () => {
    assert.deepEqual(
      parseTimedOverlayCues([
        { start_sec: -1, end_sec: 2, text: 'bad' },
        { start_sec: 1, end_sec: 1, text: 'zero duration' },
        { start_sec: 2, end_sec: 5, text: '  ok  ' },
      ]),
      [{ start_sec: 2, end_sec: 5, text: 'ok' }],
    );
  });
});

describe('normalizeTimedOverlayCues', () => {
  test('sorts and clamps to max duration', () => {
    assert.deepEqual(
      normalizeTimedOverlayCues(
        [
          { start_sec: 5, end_sec: 10, text: 'second' },
          { start_sec: 0, end_sec: 3, text: 'first' },
        ],
        { maxDurationSec: 8 },
      ),
      [
        { start_sec: 0, end_sec: 3, text: 'first' },
        { start_sec: 5, end_sec: 8, text: 'second' },
      ],
    );
  });
});

describe('activeTimedOverlayCueAtTime', () => {
  test('returns cue for half-open interval', () => {
    const cues = [
      { start_sec: 0, end_sec: 2, text: 'a' },
      { start_sec: 2, end_sec: 5, text: 'b' },
    ];
    assert.equal(activeTimedOverlayCueAtTime(cues, 0)?.text, 'a');
    assert.equal(activeTimedOverlayCueAtTime(cues, 1.9)?.text, 'a');
    assert.equal(activeTimedOverlayCueAtTime(cues, 2)?.text, 'b');
    assert.equal(activeTimedOverlayCueAtTime(cues, 5), null);
  });
});

describe('parseOverlayEndSec', () => {
  test('parses positive numbers and rejects invalid', () => {
    assert.equal(parseOverlayEndSec(3.2), 3.2);
    assert.equal(parseOverlayEndSec(null), null);
    assert.equal(parseOverlayEndSec(0), null);
  });
});

describe('normalizeOverlayEndSec', () => {
  test('clamps to max duration', () => {
    assert.equal(normalizeOverlayEndSec(15, 10), 10);
    assert.equal(normalizeOverlayEndSec(null, 10), null);
  });
});

describe('resolveOverlayPreviewText', () => {
  test('prefers active cue over static overlay', () => {
    const result = resolveOverlayPreviewText({
      overlayLines: ['hook'],
      overlayEndSec: 5,
      timedCues: [{ start_sec: 2, end_sec: 4, text: 'cue text' }],
      timeSec: 3,
    });
    assert.deepEqual(result, { text: 'cue text', source: 'cue' });
  });

  test('shows static overlay before end when handoff is set', () => {
    const result = resolveOverlayPreviewText({
      overlayLines: ['hook'],
      overlayEndSec: 3,
      timedCues: [{ start_sec: 3, end_sec: 6, text: 'later' }],
      timeSec: 1,
    });
    assert.deepEqual(result, { text: 'hook', source: 'static' });
  });

  test('hides static when timed cues exist without overlay end', () => {
    const result = resolveOverlayPreviewText({
      overlayLines: ['hook'],
      timedCues: [{ start_sec: 0, end_sec: 2, text: 'cue' }],
      timeSec: 2.5,
    });
    assert.deepEqual(result, { text: null, source: null });
  });

  test('shows static for whole reel when no cues', () => {
    const result = resolveOverlayPreviewText({
      overlayLines: ['hook'],
      timedCues: [],
      timeSec: 8,
    });
    assert.deepEqual(result, { text: 'hook', source: 'static' });
  });
});

describe('timedCueOverlapsOverlayEnd', () => {
  test('detects overlap before overlay end', () => {
    assert.equal(
      timedCueOverlapsOverlayEnd([{ start_sec: 1, end_sec: 4, text: 'x' }], 3),
      true,
    );
    assert.equal(
      timedCueOverlapsOverlayEnd([{ start_sec: 3, end_sec: 5, text: 'x' }], 3),
      false,
    );
  });
});
