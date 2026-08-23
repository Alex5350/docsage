import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatBytes, formatDate, formatRelative } from "./format";

describe("formatBytes", () => {
  it("renders bytes, KB, MB, GB sensibly", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2_048)).toBe("2.0 KB");
    expect(formatBytes(26 * 1024 * 1024)).toBe("26.0 MB");
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
  });

  it("rejects garbage", () => {
    expect(formatBytes(Number.NaN)).toBe("—");
    expect(formatBytes(-5)).toBe("—");
  });
});

describe("formatRelative", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("uses compact Intl.RelativeTimeFormat labels", () => {
    expect(formatRelative(new Date(Date.now() - 10_000).toISOString())).toBe("just now");
    expect(formatRelative(new Date(Date.now() - 5 * 60_000).toISOString())).toBe(
      "5 minutes ago",
    );
    expect(formatRelative(new Date(Date.now() - 55 * 60_000).toISOString())).toBe(
      "55 minutes ago",
    );
    expect(formatRelative(new Date(Date.now() - 2 * 3600_000).toISOString())).toBe(
      "2 hours ago",
    );
    // Intl numeric:"auto" renders single-day distances as "yesterday"
    expect(formatRelative(new Date(Date.now() - 26 * 3600_000).toISOString())).toBe(
      "yesterday",
    );
    expect(formatRelative(new Date(Date.now() - 3 * 86_400_000).toISOString())).toBe(
      "3 days ago",
    );
  });

  it("degrades gracefully on invalid input", () => {
    expect(formatRelative("not-a-date")).toBe("—");
  });
});

describe("formatDate", () => {
  it("renders a short localized date and rejects garbage", () => {
    expect(formatDate("2026-08-27T00:00:00Z")).toMatch(/2026/);
    expect(formatDate("nope")).toBe("—");
  });
});
