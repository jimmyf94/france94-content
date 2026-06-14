export type PublishNowFeedback = {
  message: string;
  dispatched: boolean;
  startedAt: string;
};

export const PUBLISH_PIPELINE_IN_PROGRESS_STATUSES = new Set([
  'scheduled',
  'media_prepared',
  'containers_created',
  'processing',
  'ready_to_publish',
  'publishing',
]);

export function isPublishPipelineTerminal(status: string): boolean {
  return status === 'published' || status === 'failed';
}

export function isPublishPipelineInProgress(status: string): boolean {
  return PUBLISH_PIPELINE_IN_PROGRESS_STATUSES.has(status);
}

export function defaultPublishNowMessage(dispatched: boolean): string {
  return dispatched
    ? 'Publishing pipeline started. Waiting for Instagram…'
    : 'Publish scheduled. Worker will pick it up within ~5 minutes.';
}

export function publishPipelineProgressLabel(
  status: string,
  feedback?: PublishNowFeedback | null,
  acting = false,
): string {
  if (acting) return 'Starting publish pipeline…';

  if (status === 'publishing') return 'Publishing to Instagram…';
  if (status === 'processing' || status === 'containers_created') {
    return 'Waiting for Instagram containers…';
  }
  if (status === 'media_prepared' || status === 'ready_to_publish') {
    return 'Preparing media for Instagram…';
  }
  if (status === 'scheduled') {
    return feedback?.message ?? defaultPublishNowMessage(feedback?.dispatched ?? true);
  }

  return feedback?.message ?? defaultPublishNowMessage(feedback?.dispatched ?? true);
}
