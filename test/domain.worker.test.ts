import { describe, expectTypeOf, it } from "vitest";
import type { CheckDto, CheckStatus, CreateCheckRequest } from "../shared/domain";

describe("cron check domain", () => {
  it("defines the Healthchecks-style states", () => {
    expectTypeOf<CheckStatus>().toEqualTypeOf<"new" | "up" | "late" | "down" | "paused">();
  });

  it("defines a period check", () => {
    const request: CreateCheckRequest = {
      name: "Nightly backup",
      schedule: { kind: "period", periodSeconds: 86400 },
      graceSeconds: 300,
    };
    expectTypeOf(request.schedule.kind).toEqualTypeOf<"period" | "cron">();
    const check: CheckDto = {
      id: "check-1", name: request.name, pingToken: "secret", schedule: request.schedule,
      graceSeconds: request.graceSeconds, status: "new", lastPingAt: null, createdAt: 1, updatedAt: 1,
    };
    expectTypeOf(check.lastPingAt).toEqualTypeOf<number | null>();
  });
});
