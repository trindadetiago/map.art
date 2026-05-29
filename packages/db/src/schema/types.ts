import { pgEnum } from 'drizzle-orm/pg-core';

export const jobTypeEnum = pgEnum('job_type', ['render', 'stylize']);
export const jobStatusEnum = pgEnum('job_status', [
  'pending',
  'processing',
  'done',
  'error',
  'cancelled',
]);
