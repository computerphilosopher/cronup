import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { CheckDto } from "../shared/domain";
import { evaluateCheck, evaluateChecks, receivePing } from "../worker/cron";
import { createMonitor } from "../worker/db/monitors";

const testEnv = env as typeof env & { DB: D1Database; TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };
function check(overrides: Partial<CheckDto> = {}): CheckDto { return { id: "one", name: "Backup", pingToken: "token", schedule: { kind: "period", periodSeconds: 3600 }, graceSeconds: 300, status: "new", lastPingAt: 1_000, createdAt: 1_000, updatedAt: 1_000, ...overrides }; }

beforeEach(async () => { await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS); await testEnv.DB.prepare("DELETE FROM checks").run(); });

describe("cron dead-man switch", () => {
  it("moves a check from up to late and down around its grace window", () => {
    const up = check({ status: "up" });
    expect(evaluateCheck(up, 3_599_000)).toBe("up");
    expect(evaluateCheck(up, 3_601_000)).toBe("late");
    expect(evaluateCheck(up, 3_901_000)).toBe("down");
  });

  it("accepts a valid ping and recovers a down check", async () => {
    await createMonitor(testEnv.DB, check({ status: "down" }));
    const transition = await receivePing(testEnv.DB, "token", 10_000);
    expect(transition).toMatchObject({ from: "down", to: "up" });
  });

  it("evaluates persisted checks and excludes paused checks", async () => {
    await createMonitor(testEnv.DB, check({ status: "up" }));
    await createMonitor(testEnv.DB, check({ id: "paused", pingToken: "paused-token", status: "paused" }));
    const transitions = await evaluateChecks(testEnv.DB, 3_901_000);
    expect(transitions.map(({ check: item }) => item.id)).toEqual(["one"]);
  });
});
