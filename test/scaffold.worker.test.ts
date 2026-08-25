import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../worker/index";
import type { Env } from "../worker/env";

function authorization(): string {
  return `Basic ${btoa("admin:scaffold-secret")}`;
}

describe("CronUp Worker scaffold", () => {
  it("returns the health response", async () => {
    const response = await worker.fetch!(
      new Request("https://cronup.test/api/health", {
        headers: { Authorization: authorization() },
      }),
      { ADMIN_SECRET: "scaffold-secret" } as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("exports a scheduled handler", () => {
    expect(exports.default.scheduled).toBeTypeOf("function");
  });
});
