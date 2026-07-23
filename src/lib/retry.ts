/**
 * Phase 5 error auto-retry policy (ported idea from Wayward). Kept as pure,
 * unit-tested helpers so the retry decision lives in `lib/`; `openrouter.ts`
 * wires them around the streaming fetch.
 *
 * Only transient failures retry: network drops and the handful of HTTP statuses
 * that mean "try again" (rate-limit / gateway / overloaded). A 400/401/403 is a
 * bad request or key — retrying just burns the same error, so those surface
 * immediately.
 */

/** How many times a single turn will be attempted before the error surfaces. */
export const MAX_ATTEMPTS = 3;

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

/**
 * Exponential backoff with a fixed ceiling: 500ms, 1000ms, 2000ms, … capped.
 * `attempt` is zero-based (delay taken *before* the next attempt).
 */
export function backoffMs(attempt: number, base = 500, cap = 4000): number {
  return Math.min(cap, base * 2 ** Math.max(0, attempt));
}

/** Abortable delay — rejects with an AbortError if the signal fires first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
