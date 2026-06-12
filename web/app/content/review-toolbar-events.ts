export const REVIEW_TOOLBAR_REFRESH_REQUEST = 'fr94:review-toolbar-refresh';
export const REVIEW_TOOLBAR_GENERATE_REQUEST = 'fr94:review-toolbar-generate';
export const REVIEW_TOOLBAR_HEAL_LEDGER_REQUEST = 'fr94:review-toolbar-heal-ledger';
export const REVIEW_TOOLBAR_TOGGLE_BLOCKED_REQUEST = 'fr94:review-toolbar-toggle-blocked';
export const REVIEW_TOOLBAR_STATE_EVENT = 'fr94:review-toolbar-state';

export type ReviewToolbarState = {
  generatingCandidates: boolean;
  generateDisabled: boolean;
  includeBlocked: boolean;
};

export function requestReviewRefresh(): void {
  window.dispatchEvent(new CustomEvent(REVIEW_TOOLBAR_REFRESH_REQUEST));
}

export function requestReviewGenerate(): void {
  window.dispatchEvent(new CustomEvent(REVIEW_TOOLBAR_GENERATE_REQUEST));
}

export function requestReviewHealLedger(): void {
  window.dispatchEvent(new CustomEvent(REVIEW_TOOLBAR_HEAL_LEDGER_REQUEST));
}

export function requestReviewToggleBlocked(): void {
  window.dispatchEvent(new CustomEvent(REVIEW_TOOLBAR_TOGGLE_BLOCKED_REQUEST));
}

export function notifyReviewToolbarState(state: ReviewToolbarState): void {
  window.dispatchEvent(new CustomEvent(REVIEW_TOOLBAR_STATE_EVENT, { detail: state }));
}

export function isReviewCockpitPath(pathname: string): boolean {
  return pathname === '/content/review';
}
