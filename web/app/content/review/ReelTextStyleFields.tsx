'use client';

import {
  REEL_TEXT_POSITIONS,
  type ReelRenderTextStyle,
  type ReelTextPosition,
} from '@fr94/reel-text-style';

const POSITION_LABELS: Record<ReelTextPosition, string> = {
  top_third: 'Top third',
  top: 'Top',
  center: 'Center',
};

const NAMED_COLORS: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  yellow: '#ffff00',
};

function toColorInputValue(color: string): string {
  const trimmed = color.trim().toLowerCase();
  if (trimmed.startsWith('#') && (trimmed.length === 7 || trimmed.length === 4)) {
    return trimmed.length === 4
      ? `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`
      : trimmed;
  }
  return NAMED_COLORS[trimmed] ?? '#ffffff';
}

function ColorField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const pickerValue = toColorInputValue(value);

  return (
    <label className="block text-sm">
      <span className="font-medium text-[var(--muted)]">{label}</span>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="color"
          value={pickerValue}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-10 shrink-0 cursor-pointer rounded-md border border-[var(--border)] bg-[var(--surface-2)] disabled:opacity-50"
          title={`Pick ${label.toLowerCase()}`}
        />
        <input
          type="text"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="white, black, #hex…"
          className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] disabled:opacity-50"
        />
      </div>
    </label>
  );
}

export function ReelTextStyleFields({
  style,
  onChange,
  disabled,
}: {
  style: ReelRenderTextStyle;
  onChange: (next: ReelRenderTextStyle) => void;
  disabled?: boolean;
}) {
  const set = <K extends keyof ReelRenderTextStyle>(key: K, value: ReelRenderTextStyle[K]) => {
    onChange({ ...style, [key]: value });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-[var(--muted)]">Font size</span>
          <input
            type="number"
            min={24}
            max={72}
            value={style.fontsize}
            disabled={disabled}
            onChange={(e) => set('fontsize', Number(e.target.value))}
            className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] disabled:opacity-50"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-[var(--muted)]">Line spacing</span>
          <input
            type="number"
            min={0}
            max={40}
            value={style.line_spacing}
            disabled={disabled}
            onChange={(e) => set('line_spacing', Number(e.target.value))}
            className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] disabled:opacity-50"
          />
        </label>
        <ColorField
          label="Text color"
          value={style.font_color}
          disabled={disabled}
          onChange={(v) => set('font_color', v)}
        />
        <ColorField
          label="Outline color"
          value={style.outline_color}
          disabled={disabled}
          onChange={(v) => set('outline_color', v)}
        />
        <label className="block text-sm">
          <span className="font-medium text-[var(--muted)]">Outline width</span>
          <input
            type="number"
            min={0}
            max={12}
            value={style.outline_width}
            disabled={disabled}
            onChange={(e) => set('outline_width', Number(e.target.value))}
            className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] disabled:opacity-50"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-[var(--muted)]">Position</span>
          <select
            value={style.position}
            disabled={disabled}
            onChange={(e) => set('position', e.target.value as ReelTextPosition)}
            className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] disabled:opacity-50"
          >
            {REEL_TEXT_POSITIONS.map((p) => (
              <option key={p} value={p}>
                {POSITION_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={style.centered}
          disabled={disabled}
          onChange={(e) => set('centered', e.target.checked)}
          className="h-4 w-4 rounded border-[var(--border)]"
        />
        <span className="text-[var(--muted)]">Center text horizontally</span>
      </label>
    </div>
  );
}
