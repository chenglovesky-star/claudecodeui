import type { ApiErrorPayload } from './types';

export async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function resolveApiErrorMessage(payload: ApiErrorPayload | null, fallback: string): string {
  if (!payload) {
    return fallback;
  }

  // Support new format: { error: { code, message } }
  if (payload.error && typeof payload.error === 'object' && 'message' in payload.error) {
    return (payload.error as { message: string }).message;
  }

  // Legacy format: { error: "string" } or { message: "string" }
  if (typeof payload.error === 'string') {
    return payload.error;
  }

  return payload.message ?? fallback;
}
