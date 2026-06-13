import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DEFAULT_REEL_RENDER_TEXT_STYLE,
  drawtextColorValue,
  drawtextXExpression,
  drawtextYExpression,
  formatReelOverlayText,
  mergeHookWithOverlayLines,
  normalizeReelSpecOverlay,
  parsePartialReelTextStyle,
  parseReelOverlayDraft,
  resolveReelTextStyle,
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
