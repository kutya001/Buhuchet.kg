import type { ApiError } from '@buhuchet/shared';

export function apiError(code: string, message: string, details?: unknown): ApiError {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}
