'use client';

import { useEffect } from 'react';

type Handlers = {
  enabled: boolean;
  onApprove: () => void;
  onRewrite: () => void;
  onReject: () => void;
  onNext: () => void;
  onPrev: () => void;
  onTogglePlay: () => void;
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts({
  enabled,
  onApprove,
  onRewrite,
  onReject,
  onNext,
  onPrev,
  onTogglePlay,
}: Handlers) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      switch (e.key) {
        case 'a':
        case 'A':
          e.preventDefault();
          onApprove();
          break;
        case 'w':
        case 'W':
          e.preventDefault();
          onRewrite();
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          onReject();
          break;
        case 'j':
        case 'J':
        case 'ArrowDown':
          e.preventDefault();
          onNext();
          break;
        case 'k':
        case 'K':
        case 'ArrowUp':
          e.preventDefault();
          onPrev();
          break;
        case ' ':
          e.preventDefault();
          onTogglePlay();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, onApprove, onRewrite, onReject, onNext, onPrev, onTogglePlay]);
}
