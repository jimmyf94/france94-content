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

export function stagingProgressLabel(
  jobStatus: string | null | undefined,
  stagingActive: boolean,
): string {
  if (stagingActive && !jobStatus) return 'Starting staging…';
  if (jobStatus === 'draft') return 'Creating publishing job…';
  if (jobStatus === 'media_prepared') return 'Preparing media for Instagram…';
  if (jobStatus === 'processing' || jobStatus === 'containers_created') {
    return 'Waiting for Instagram containers…';
  }
  if (jobStatus === 'ready_to_publish') return 'Ready to schedule or publish';
  if (stagingActive) return 'Staging for publishing…';
  return 'Loading publishing job…';
}

export function showPublishPipelineProgress(
  status: string,
  feedback?: PublishNowFeedback | null,
  publishActing = false,
): boolean {
  if (publishActing) return true;
  if (!feedback) return false;
  if (isPublishPipelineTerminal(status)) return false;
  return isPublishPipelineInProgress(status) || status === 'draft' || status === 'scheduled';
}

export function countActivePublishingJobs(
  items: Array<{ id: string; status: string }>,
  feedbackByJobId: Record<string, PublishNowFeedback>,
  publishActingJobId?: string | null,
): number {
  const activeIds = new Set<string>();
  for (const item of items) {
    const feedback = feedbackByJobId[item.id] ?? null;
    const fromFeedback = showPublishPipelineProgress(
      item.status,
      feedback,
      publishActingJobId === item.id,
    );
    const fromStatus =
      item.status === 'publishing' ||
      item.status === 'processing' ||
      item.status === 'containers_created';
    if (fromFeedback || fromStatus) {
      activeIds.add(item.id);
    }
  }
  if (publishActingJobId && !activeIds.has(publishActingJobId)) {
    activeIds.add(publishActingJobId);
  }
  return activeIds.size;
}
