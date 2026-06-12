export const PUBLISHING_SCHEDULABLE_STATUSES = new Set([
  'draft',
  'media_prepared',
  'containers_created',
  'processing',
  'ready_to_publish',
  'scheduled',
]);

export function canSchedulePublishingJob(status: string): boolean {
  return PUBLISHING_SCHEDULABLE_STATUSES.has(status);
}

export function canUnschedulePublishingJob(status: string): boolean {
  return status === 'scheduled';
}

export function canPublishPublishingJobNow(status: string): boolean {
  return canSchedulePublishingJob(status) && status !== 'published' && status !== 'publishing';
}
