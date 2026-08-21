import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("CronUp Worker scaffold", () => {
  it("returns the health response", async () => {
    const response = await exports.default.fetch(
      "https://cronup.test/api/health",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("exports a scheduled handler", () => {
    expect(exports.default.scheduled).toBeTypeOf("function");
  });
});
