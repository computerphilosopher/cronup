import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { CheckDto } from "../shared/domain";
import { createMonitor, deleteMonitor, getMonitorByToken, listMonitors, updatePing } from "../worker/db/monitors";

const testEnv = env as typeof env & { DB: D1Database; TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };

function check(id: string, createdAt = 1_000): CheckDto {
  return { id, name: `Check ${id}`, pingToken: `token-${id}`, schedule: { kind: "period", periodSeconds: 3600 }, graceSeconds: 60, status: "new", lastPingAt: null, createdAt, updatedAt: createdAt };
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM checks").run();
});

describe("check D1 storage", () => {
  it("creates and lists checks", async () => {
    await createMonitor(testEnv.DB, check("one"));
    await expect(listMonitors(testEnv.DB)).resolves.toEqual([check("one")]);
    await expect(getMonitorByToken(testEnv.DB, "token-one")).resolves.toEqual(check("one"));
  });

  it("records a ping and marks the check up", async () => {
    await createMonitor(testEnv.DB, check("one"));
    await updatePing(testEnv.DB, "one", 5_000);
    await expect(listMonitors(testEnv.DB)).resolves.toEqual([{ ...check("one"), status: "up", lastPingAt: 5_000, updatedAt: 5_000 }]);
  });

  it("deletes an existing check", async () => {
    await createMonitor(testEnv.DB, check("one"));
    await expect(deleteMonitor(testEnv.DB, "one")).resolves.toBe(true);
    await expect(deleteMonitor(testEnv.DB, "one")).resolves.toBe(false);
  });
});
