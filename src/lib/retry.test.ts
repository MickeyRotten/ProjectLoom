import { describe, expect, it, vi } from "vitest";
import { MAX_ATTEMPTS, backoffMs, isRetryableStatus, sleep } from "./retry";

describe("isRetryableStatus", () => {
  it("retries transient / overloaded statuses", () => {
    for (const s of [408, 425, 429, 500, 502, 503, 504]) {
      expect(isRetryableStatus(s)).toBe(true);
    }
  });

  it("does not retry client errors that will just repeat", () => {
    for (const s of [400, 401, 403, 404, 422]) {
      expect(isRetryableStatus(s)).toBe(false);
    }
  });
});

describe("backoffMs", () => {
  it("grows exponentially from the base", () => {
    expect(backoffMs(0)).toBe(500);
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(2000);
  });

  it("never exceeds the cap", () => {
    expect(backoffMs(10)).toBe(4000);
    expect(backoffMs(3, 500, 3000)).toBe(3000);
  });

  it("treats negative attempts as the first", () => {
    expect(backoffMs(-1)).toBe(500);
  });
});

describe("MAX_ATTEMPTS", () => {
  it("allows more than one try", () => {
    expect(MAX_ATTEMPTS).toBeGreaterThan(1);
  });
});

describe("sleep", () => {
  it("resolves after the delay", async () => {
    vi.useFakeTimers();
    let done = false;
    const p = sleep(1000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
    vi.useRealTimers();
  });

  it("rejects immediately if the signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(sleep(1000, ctrl.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects when the signal fires mid-wait", async () => {
    vi.useFakeTimers();
    const ctrl = new AbortController();
    const p = sleep(1000, ctrl.signal);
    const assertion = expect(p).rejects.toMatchObject({ name: "AbortError" });
    ctrl.abort();
    await assertion;
    vi.useRealTimers();
  });
});
