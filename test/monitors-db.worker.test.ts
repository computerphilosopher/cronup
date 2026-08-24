import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { MonitorDto } from "../shared/domain";
import {
  createMonitor,
  deleteMonitor,
  listMonitors,
  selectDueMonitors,
  updateMonitorResult,
} from "../worker/db/monitors";

type TestEnv = {
  DB: D1Database;
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
};

const testEnv = env as unknown as TestEnv;

function monitor(
  id: string,
  createdAt: number,
  lastCheckedAt: number | null = null,
): MonitorDto {
  return {
    id,
    name: `Monitor ${id}`,
    url: `https://${id}.example.com/health`,
    status: "pending",
    createdAt,
    updatedAt: createdAt,
    lastCheckedAt,
    statusCode: null,
    latencyMs: null,
  };
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM monitors").run();
});

describe("monitor D1 storage", () => {
  it("creates and lists monitors in creation order using bound values", async () => {
    const later = monitor("later", 2_000);
    const earlier = {
      ...monitor("earlier", 1_000),
      name: `Robert'); DROP TABLE monitors;--`,
      url: "https://example.com/health?probe='quoted'",
    };

    await createMonitor(testEnv.DB, later);
    await createMonitor(testEnv.DB, earlier);

    await expect(listMonitors(testEnv.DB)).resolves.toEqual([earlier, later]);
  });

  it("deletes an existing monitor and reports missing ids", async () => {
    await createMonitor(testEnv.DB, monitor("delete-me", 1_000));

    await expect(deleteMonitor(testEnv.DB, "delete-me")).resolves.toBe(true);
    await expect(deleteMonitor(testEnv.DB, "delete-me")).resolves.toBe(false);
    await expect(listMonitors(testEnv.DB)).resolves.toEqual([]);
  });

  it("selects never-checked then least-recently-checked monitors up to the limit", async () => {
    await createMonitor(testEnv.DB, monitor("recent", 1_000, 30_000));
    await createMonitor(testEnv.DB, monitor("never-later", 3_000));
    await createMonitor(testEnv.DB, monitor("oldest", 2_000, 10_000));
    await createMonitor(testEnv.DB, monitor("never-earlier", 500));

    const due = await selectDueMonitors(testEnv.DB, 3);

    expect(due.map(({ id }) => id)).toEqual([
      "never-earlier",
      "never-later",
      "oldest",
    ]);
  });

  it("defaults due selection to 20 monitors", async () => {
    await Promise.all(
      Array.from({ length: 21 }, (_, index) =>
        createMonitor(testEnv.DB, monitor(`monitor-${index}`, index)),
      ),
    );

    await expect(selectDueMonitors(testEnv.DB)).resolves.toHaveLength(20);
  });

  it("updates the current probe result", async () => {
    await createMonitor(testEnv.DB, monitor("checked", 1_000));

    await expect(
      updateMonitorResult(testEnv.DB, "checked", {
        status: "healthy",
        checkedAt: 5_000,
        statusCode: 204,
        latencyMs: 87,
      }),
    ).resolves.toBe(true);

    await expect(listMonitors(testEnv.DB)).resolves.toEqual([
      {
        ...monitor("checked", 1_000),
        status: "healthy",
        updatedAt: 5_000,
        lastCheckedAt: 5_000,
        statusCode: 204,
        latencyMs: 87,
      },
    ]);
  });

  it("enforces the uptime-only status constraint and checked-time index", async () => {
    await expect(
      testEnv.DB.prepare(
        `INSERT INTO monitors (
          id, name, url, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind("invalid", "Invalid", "https://example.com", "missed", 1, 1)
        .run(),
    ).rejects.toThrow();

    const index = await testEnv.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
    )
      .bind("idx_monitors_last_checked_at")
      .first<{ name: string }>();

    expect(index).toEqual({ name: "idx_monitors_last_checked_at" });
  });
});
