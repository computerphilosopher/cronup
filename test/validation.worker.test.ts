import { describe, expect, it } from "vitest";
import { InvalidCheckRequest, parseCreateCheckRequest } from "../worker/validation";

function invalid(input: unknown) {
  expect(() => parseCreateCheckRequest(input)).toThrowError(InvalidCheckRequest);
}

describe("parseCreateCheckRequest", () => {
  it("accepts a period check", () => {
    expect(parseCreateCheckRequest({ name: " Backup ", schedule: { kind: "period", periodSeconds: 3600 }, graceSeconds: 60 })).toEqual({
      name: "Backup", schedule: { kind: "period", periodSeconds: 3600 }, graceSeconds: 60,
    });
  });

  it("accepts a cron check with timezone", () => {
    expect(parseCreateCheckRequest({ name: "Backup", schedule: { kind: "cron", expression: "0 2 * * *", timezone: "Asia/Seoul" }, graceSeconds: 300 }).schedule.kind).toBe("cron");
  });

  it.each([undefined, null, [], {}, { name: "x", schedule: { kind: "period", periodSeconds: 30 }, graceSeconds: 1 }, { name: "x", schedule: { kind: "cron", expression: "bad", timezone: "UTC" }, graceSeconds: 1 }, { name: "x", schedule: { kind: "period", periodSeconds: 60 }, graceSeconds: -1 }])("rejects invalid input", invalid);
});
