/**
 * Centralized error handling utilities
 */

/**
 * Safely extract a user-facing error message from an unknown error
 */
export function getErrorMessage(err: unknown, fallback = 'An unexpected error occurred'): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return fallback;
}
