import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Step 11.5 — validates the Vercel Cron configuration itself (vercel.json),
 * not the endpoint it points at (that's tests/automation-run-route.test.ts).
 * A malformed `crons` entry fails silently at deploy time (no error, the
 * schedule just never fires), so this is worth a direct, static check.
 */

function loadVercelConfig(): unknown {
  const source = readFileSync(new URL("../vercel.json", import.meta.url), "utf-8");
  return JSON.parse(source);
}

describe("vercel.json (cron configuration)", () => {
  it("is valid JSON with exactly one cron entry", () => {
    const config = loadVercelConfig() as { crons?: unknown[] };
    expect(Array.isArray(config.crons)).toBe(true);
    expect(config.crons).toHaveLength(1);
  });

  it("schedules the automation trigger endpoint", () => {
    const config = loadVercelConfig() as { crons: Array<{ path: string }> };
    expect(config.crons[0].path).toBe("/api/automation/run");
  });

  it("uses a conservative once-per-day schedule (a single run per calendar day, every day)", () => {
    const config = loadVercelConfig() as { crons: Array<{ schedule: string }> };
    const schedule = config.crons[0].schedule;

    // Standard 5-field cron: minute hour day-of-month month day-of-week.
    const fields = schedule.trim().split(/\s+/);
    expect(fields).toHaveLength(5);
    const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;

    // A fixed minute and hour (not "*") run once per matching day, and
    // "*" for day-of-month/month/day-of-week means every day — together,
    // once per day, every day. A wildcard minute or hour would run far
    // more often than once a day; this guards against that regression.
    expect(minute).not.toBe("*");
    expect(hour).not.toBe("*");
    expect(dayOfMonth).toBe("*");
    expect(month).toBe("*");
    expect(dayOfWeek).toBe("*");
  });

  it("never contains a secret, credential, or header configuration of any kind", () => {
    const source = readFileSync(new URL("../vercel.json", import.meta.url), "utf-8");

    // vercel.json's `crons` entries only ever support `path` and
    // `schedule` — there is no field for custom headers, so this file can
    // never be how the cron request's Authorization header is supplied
    // (see .env.example's AUTOMATION_CRON_SECRET entry for how it
    // actually is). This is a durable guard against a future edit
    // accidentally adding one.
    expect(source).not.toMatch(/headers?/i);
    expect(source).not.toMatch(/authorization/i);
    expect(source).not.toMatch(/bearer/i);
    expect(source).not.toMatch(/secret/i);
    expect(source).not.toMatch(/AUTOMATION_CRON_SECRET/);
    expect(source).not.toMatch(/NEXT_PUBLIC_/);
  });
});
