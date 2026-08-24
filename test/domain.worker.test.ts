import { describe, expectTypeOf, it } from "vitest";
import type {
  CreateMonitorRequest,
  MonitorDto,
  MonitorStatus,
} from "../shared/domain";

describe("uptime monitor domain", () => {
  it("defines the supported monitor states", () => {
    expectTypeOf<MonitorStatus>().toEqualTypeOf<
      "pending" | "healthy" | "down"
    >();

    // @ts-expect-error missed belongs to the heartbeat roadmap.
    const unsupportedStatus: MonitorStatus = "missed";
    void unsupportedStatus;
  });

  it("defines the creation request", () => {
    expectTypeOf<CreateMonitorRequest>().toEqualTypeOf<{
      name: string;
      url: string;
    }>();

    const request: CreateMonitorRequest = {
      name: "Public website",
      url: "https://example.com/health",
    };

    expectTypeOf(request.url).toBeString();

    // @ts-expect-error url is required.
    const missingUrl: CreateMonitorRequest = { name: "Public website" };
    void missingUrl;
  });

  it("defines the current-state response", () => {
    expectTypeOf<MonitorDto>().toEqualTypeOf<{
      id: string;
      name: string;
      url: string;
      status: MonitorStatus;
      createdAt: number;
      updatedAt: number;
      lastCheckedAt: number | null;
      statusCode: number | null;
      latencyMs: number | null;
    }>();

    const monitor: MonitorDto = {
      id: "monitor-1",
      name: "Public website",
      url: "https://example.com/health",
      status: "pending",
      createdAt: 1_777_000_000_000,
      updatedAt: 1_777_000_000_000,
      lastCheckedAt: null,
      statusCode: null,
      latencyMs: null,
    };

    expectTypeOf(monitor.status).toEqualTypeOf<MonitorStatus>();
  });
});
