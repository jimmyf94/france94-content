export const OPEN_SCHEDULE_DRAWER_EVENT = 'fr94:open-schedule-drawer';
export const SCHEDULE_QUEUE_CHANGED_EVENT = 'fr94:schedule-queue-changed';
export const SCHEDULE_SELECT_CANDIDATE_EVENT = 'fr94:schedule-select-candidate';
export const REVIEW_SELECTED_CANDIDATE_EVENT = 'fr94:review-selected-candidate';

export const SCHEDULE_DRAWER_REFRESH_EVENT = 'fr94:schedule-drawer-refresh';

export function openScheduleDrawer(): void {
  window.dispatchEvent(new CustomEvent(OPEN_SCHEDULE_DRAWER_EVENT));
}

export function notifyScheduleQueueChanged(): void {
  window.dispatchEvent(new CustomEvent(SCHEDULE_QUEUE_CHANGED_EVENT));
}

export function notifyScheduleDrawerRefresh(): void {
  window.dispatchEvent(new CustomEvent(SCHEDULE_DRAWER_REFRESH_EVENT));
}

export function notifyScheduleSelectCandidate(candidateId: string): void {
  window.dispatchEvent(
    new CustomEvent(SCHEDULE_SELECT_CANDIDATE_EVENT, { detail: { candidateId } }),
  );
}

export function syncReviewSelectedCandidate(candidateId: string | null): void {
  window.dispatchEvent(
    new CustomEvent(REVIEW_SELECTED_CANDIDATE_EVENT, { detail: { candidateId } }),
  );
}
