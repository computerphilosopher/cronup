
# AI-02 Domain Rules and Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CronUp의 모니터 도메인 타입, job deadline 계산, 상태 전이 알림 규칙, uptime/job 생성 입력 검증을 Worker와 이후 API/UI가 재사용할 수 있는 순수 TypeScript 모듈로 고정한다.

**Architecture:** `shared/domain.ts`는 Worker와 브라우저가 함께 사용할 타입과 외부 효과 없는 도메인 함수를 소유한다. `worker/validation.ts`는 JSON 경계에서 수동 검증을 수행하고, 검증 성공 시 trim된 이름과 타입에 맞는 discriminated union만 반환한다. private 네트워크 차단은 URL 문자열의 hostname을 기준으로 처리하며 DNS 해석이나 실제 네트워크 요청은 이 단계에 포함하지 않는다.

**Tech Stack:** TypeScript, Cloudflare Workers, Vitest 4.1+, `@cloudflare/vitest-pool-workers`

**Source spec:** `docs/specs/cronup-alpha.md`의 3.1, 3.4, 5.2절과 `docs/superpowers/plans/2026-08-20-cronup-alpha-mvp.md`의 AI-02 항목

---

## Scope and fixed decisions

- 생성 요청의 shape은 `{ type, name, config }`로 고정한다.
- `type: "uptime"`의 config는 `{ url }`, `type: "job"`의 config는 `{ periodMinutes, graceMinutes }`만 허용한다.
- 이름은 앞뒤 공백을 제거한 뒤 1~100자여야 하며, 반환 DTO에는 trim된 값을 넣는다.
- uptime URL은 `http:` 또는 `https:`만 허용하고, 사용자명·비밀번호가 없어야 하며, `localhost` 계열과 명시적인 사설/예약 IP literal을 거부한다.
- URL의 hostname이 일반 도메인인 경우 DNS가 사설 주소를 가리키는지 이 모듈에서 조회하지 않는다. 실제 probe 단계의 네트워크 안전성은 AI-07의 범위다.
- 모든 시각은 UTC epoch milliseconds인 safe integer다.
- `periodMinutes`는 1 이상의 safe integer, `graceMinutes`는 0 이상의 safe integer이며, 분을 milliseconds로 변환한 결과와 deadline 합계도 safe integer여야 한다.
- `notificationForTransition`은 명시된 전이만 알림으로 바꾼다. `down ↔ missed`, `healthy → pending`, `down|missed → pending`처럼 스펙에 없는 전이는 `null`이다.
- 오류는 `InvalidMonitorRequest`로 표현하고 API 계층이 나중에 이를 `{ error: { code: "invalid_request", message } }`로 변환한다. 이번 단계에서는 HTTP 응답을 만들지 않는다.

## File map

- `shared/domain.ts`: 모니터·이벤트·webhook DTO와 `nextJobDeadline`, `notificationForTransition`.
- `worker/validation.ts`: 생성 body 파싱, 정확한 key 검증, URL/IP 검증, `InvalidMonitorRequest`.
- `test/domain.worker.test.ts`: 도메인 타입을 소비하는 deadline·상태 전이 테스트.
- `test/validation.worker.test.ts`: 생성 body와 public URL의 허용·거부 케이스.

## Contract to implement

The implementation must expose these signatures:

~~~ts
// shared/domain.ts
export function nextJobDeadline(
  receivedAt: number,
  periodMinutes: number,
  graceMinutes: number,
): number;

export function notificationForTransition(
  previousStatus: MonitorStatus,
  nextStatus: MonitorStatus,
): NotificationEvent | null;

// worker/validation.ts
export class InvalidMonitorRequest extends Error {
  readonly code: "invalid_request";
}

export function parseCreateMonitorRequest(
  input: unknown,
): CreateMonitorRequest;

export function isPublicHttpUrl(value: string): boolean;
~~~

The shared DTOs must have the following exact discriminated shapes:

~~~ts
export type MonitorType = "uptime" | "job";

export type MonitorStatus = "pending" | "healthy" | "down" | "missed";

export type UptimeConfig = {
  url: string;
};

export type JobConfig = {
  periodMinutes: number;
  graceMinutes: number;
};

export type CreateMonitorRequest =
  | { type: "uptime"; name: string; config: UptimeConfig }
  | { type: "job"; name: string; config: JobConfig };

export type EventKind =
  | "uptime_check"
  | "heartbeat_received"
  | "missed_heartbeat";

export type EventOutcome = "healthy" | "down" | "missed";

export type MonitorEventDto = {
  id: string;
  monitorId: string;
  kind: EventKind;
  outcome: EventOutcome;
  observedAt: number;
  statusCode: number | null;
  latencyMs: number | null;
};

export type MonitorDto = {
  id: string;
  name: string;
  status: MonitorStatus;
  createdAt: number;
  updatedAt: number;
  lastObservedAt: number | null;
  nextDeadlineAt: number | null;
} & (
  | { type: "uptime"; config: UptimeConfig }
  | { type: "job"; config: JobConfig; heartbeatUrl?: string }
);

export type NotificationEvent =
  | "monitor.down"
  | "monitor.missed"
  | "monitor.recovered";

export type WebhookPayload = {
  event: NotificationEvent;
  monitor: {
    id: string;
    name: string;
    type: MonitorType;
  };
  previousStatus: MonitorStatus;
  status: MonitorStatus;
  observedAt: number;
  detail?: {
    statusCode?: number;
    latencyMs?: number;
  };
};
~~~

## Implementation tasks

### Task 1: Lock the shared domain types with compiler-visible tests

**Files:**
- Create: `shared/domain.ts`
- Create: `test/domain.worker.test.ts`

- [ ] **Step 1: Write the domain contract test before adding the implementation.**

Create `test/domain.worker.test.ts` with imports from `../shared/domain`. The test must compile against the exact public names and exercise representative DTO assignments:

~~~ts
import { describe, expect, it } from "vitest";
import {
  type CreateMonitorRequest,
  type MonitorDto,
  type MonitorEventDto,
  type WebhookPayload,
} from "../shared/domain";

describe("shared domain contract", () => {
  it("accepts both discriminated monitor creation requests", () => {
    const uptime: CreateMonitorRequest = {
      type: "uptime",
      name: "Website",
      config: { url: "https://example.com" },
    };
    const job: CreateMonitorRequest = {
      type: "job",
      name: "Nightly backup",
      config: { periodMinutes: 60, graceMinutes: 5 },
    };

    expect(uptime.config.url).toBe("https://example.com");
    expect(job.config.periodMinutes).toBe(60);
  });

  it("keeps event and webhook DTO fields typed", () => {
    const event: MonitorEventDto = {
      id: "event-1",
      monitorId: "monitor-1",
      kind: "uptime_check",
      outcome: "healthy",
      observedAt: 1_700_000_000_000,
      statusCode: 204,
      latencyMs: 42,
    };
    const monitor: MonitorDto = {
      id: "monitor-1",
      type: "uptime",
      name: "Website",
      status: "healthy",
      config: { url: "https://example.com" },
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      lastObservedAt: 1_700_000_000_000,
      nextDeadlineAt: null,
    };
    const webhook: WebhookPayload = {
      event: "monitor.down",
      monitor: { id: monitor.id, name: monitor.name, type: monitor.type },
      previousStatus: "healthy",
      status: "down",
      observedAt: event.observedAt,
      detail: {
        statusCode: event.statusCode ?? undefined,
        latencyMs: event.latencyMs ?? undefined,
      },
    };

    expect(webhook.detail?.statusCode).toBe(204);
  });

});
~~~

- [ ] **Step 2: Run the contract test and confirm the missing module failure.**

Run:

~~~bash
npm run test:worker -- domain.worker.test.ts
~~~

Expected: FAIL because `../shared/domain` does not exist yet.

- [ ] **Step 3: Add the shared type definitions and constants.**

Create `shared/domain.ts` with the exact union and DTO definitions from the “Contract to implement” section. Do not add the domain function implementations until Task 2; Task 1 only establishes the shared type surface. Keep this file free of Worker bindings, Hono imports, `fetch`, database calls, and browser globals so both runtimes can import it.

- [ ] **Step 4: Run the contract test and typecheck.**

Run:

~~~bash
npm run test:worker -- domain.worker.test.ts
npm run build
~~~

Expected: the type contract test passes, and `npm run build` reports no TypeScript errors from the shared module.

### Task 2: Implement safe job deadline arithmetic and notification transitions

**Files:**
- Modify: `shared/domain.ts`
- Modify: `test/domain.worker.test.ts`

- [ ] **Step 1: Add failing deadline boundary tests.**

Append these tests to `test/domain.worker.test.ts`:

Extend the import list with `nextJobDeadline` and `notificationForTransition` before adding the tests below.

~~~ts
describe("nextJobDeadline", () => {
  it.each([
    [0, 1, 0, 60_000],
    [1_700_000_000_000, 10, 5, 1_700_000_900_000],
    [1_700_000_000_001, 1, 1, 1_700_000_120_001],
  ])(
    "adds period and grace minutes: %s + %s + %s = %s",
    (receivedAt, periodMinutes, graceMinutes, expected) => {
      expect(
        nextJobDeadline(receivedAt, periodMinutes, graceMinutes),
      ).toBe(expected);
    },
  );

  it.each([
    [Number.NaN, 1, 0],
    [1.5, 1, 0],
    [Number.MAX_SAFE_INTEGER + 1, 1, 0],
    [0, 0, 0],
    [0, -1, 0],
    [0, 1.5, 0],
    [0, 1, -1],
    [0, 1, 1.5],
    [0, Number.MAX_SAFE_INTEGER, 0],
    [Number.MAX_SAFE_INTEGER - 30_000, 1, 0],
  ])(
    "rejects unsafe or invalid values: %s, %s, %s",
    (receivedAt, periodMinutes, graceMinutes) => {
      expect(() =>
        nextJobDeadline(receivedAt, periodMinutes, graceMinutes),
      ).toThrow(RangeError);
    },
  );
});
~~~

- [ ] **Step 2: Run the deadline tests and verify they fail for the unimplemented function.**

Run:

~~~bash
npm run test:worker -- domain.worker.test.ts
~~~

Expected: FAIL for the deadline cases because `nextJobDeadline` is not implemented with the required arithmetic yet.

- [ ] **Step 3: Implement overflow-safe `nextJobDeadline`.**

Add this implementation to `shared/domain.ts`:

~~~ts
const MINUTE_MS = 60_000;

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(label + " must be a safe integer");
  }
}

export function nextJobDeadline(
  receivedAt: number,
  periodMinutes: number,
  graceMinutes: number,
): number {
  assertSafeInteger(receivedAt, "receivedAt");
  assertSafeInteger(periodMinutes, "periodMinutes");
  assertSafeInteger(graceMinutes, "graceMinutes");

  if (periodMinutes < 1) {
    throw new RangeError("periodMinutes must be at least 1");
  }
  if (graceMinutes < 0) {
    throw new RangeError("graceMinutes must be at least 0");
  }

  const periodMs = periodMinutes * MINUTE_MS;
  const graceMs = graceMinutes * MINUTE_MS;
  if (!Number.isSafeInteger(periodMs) || !Number.isSafeInteger(graceMs)) {
    throw new RangeError("minute values overflow epoch milliseconds");
  }

  const offsetMs = periodMs + graceMs;
  if (!Number.isSafeInteger(offsetMs)) {
    throw new RangeError("period and grace overflow epoch milliseconds");
  }

  const deadline = receivedAt + offsetMs;
  if (!Number.isSafeInteger(deadline)) {
    throw new RangeError("deadline overflows safe epoch milliseconds");
  }
  return deadline;
}
~~~

- [ ] **Step 4: Add the complete notification transition matrix as a failing test.**

Append this table-driven test:

~~~ts
describe("notificationForTransition", () => {
  it.each([
    ["pending", "healthy", null],
    ["pending", "pending", null],
    ["healthy", "healthy", null],
    ["down", "down", null],
    ["missed", "missed", null],
    ["pending", "down", "monitor.down"],
    ["healthy", "down", "monitor.down"],
    ["pending", "missed", "monitor.missed"],
    ["healthy", "missed", "monitor.missed"],
    ["down", "healthy", "monitor.recovered"],
    ["missed", "healthy", "monitor.recovered"],
    ["down", "missed", null],
    ["missed", "down", null],
    ["healthy", "pending", null],
    ["down", "pending", null],
    ["missed", "pending", null],
  ] as const)(
    "%s -> %s emits %s",
    (previousStatus, nextStatus, expected) => {
      expect(
        notificationForTransition(previousStatus, nextStatus),
      ).toBe(expected);
    },
  );
});
~~~

- [ ] **Step 5: Implement the transition function and run the focused suite.**

Add this implementation to `shared/domain.ts`:

~~~ts
export function notificationForTransition(
  previousStatus: MonitorStatus,
  nextStatus: MonitorStatus,
): NotificationEvent | null {
  if (previousStatus === nextStatus) {
    return null;
  }

  if (
    (previousStatus === "pending" || previousStatus === "healthy") &&
    (nextStatus === "down" || nextStatus === "missed")
  ) {
    return nextStatus === "down" ? "monitor.down" : "monitor.missed";
  }

  if (
    (previousStatus === "down" || previousStatus === "missed") &&
    nextStatus === "healthy"
  ) {
    return "monitor.recovered";
  }

  return null;
}
~~~

Run:

~~~bash
npm run test:worker -- domain.worker.test.ts
~~~

Expected: all contract, deadline, overflow, and transition tests PASS.

### Task 3: Add strict monitor creation validation and public URL checks

**Files:**
- Create: `worker/validation.ts`
- Create: `test/validation.worker.test.ts`

- [ ] **Step 1: Write accepted and rejected request tests before implementing validation.**

Create `test/validation.worker.test.ts`:

~~~ts
import { describe, expect, it } from "vitest";
import {
  InvalidMonitorRequest,
  isPublicHttpUrl,
  parseCreateMonitorRequest,
} from "../worker/validation";

describe("parseCreateMonitorRequest", () => {
  it("trims a valid uptime name and preserves its URL", () => {
    expect(
      parseCreateMonitorRequest({
        type: "uptime",
        name: "  Public website  ",
        config: { url: "https://example.com/health" },
      }),
    ).toEqual({
      type: "uptime",
      name: "Public website",
      config: { url: "https://example.com/health" },
    });
  });

  it("accepts a valid job request", () => {
    expect(
      parseCreateMonitorRequest({
        type: "job",
        name: "  Nightly backup ",
        config: { periodMinutes: 60, graceMinutes: 5 },
      }),
    ).toEqual({
      type: "job",
      name: "Nightly backup",
      config: { periodMinutes: 60, graceMinutes: 5 },
    });
  });

  it.each([
    undefined,
    null,
    [],
    { type: "other", name: "Monitor", config: {} },
    { type: "uptime", name: "", config: { url: "https://example.com" } },
    { type: "uptime", name: "   ", config: { url: "https://example.com" } },
    {
      type: "uptime",
      name: "Monitor",
      config: { url: "ftp://example.com" },
    },
    {
      type: "uptime",
      name: "Monitor",
      config: { periodMinutes: 5, graceMinutes: 0 },
    },
    {
      type: "job",
      name: "Monitor",
      config: { periodMinutes: 0, graceMinutes: 0 },
    },
    {
      type: "job",
      name: "Monitor",
      config: { periodMinutes: 5.5, graceMinutes: 0 },
    },
    {
      type: "job",
      name: "Monitor",
      config: { periodMinutes: 5, graceMinutes: -1 },
    },
    {
      type: "job",
      name: "Monitor",
      config: { periodMinutes: 5, graceMinutes: Number.MAX_SAFE_INTEGER },
    },
    {
      type: "uptime",
      name: "Monitor",
      config: { url: "https://example.com" },
      status: "healthy",
    },
    {
      type: "job",
      name: "Monitor",
      config: { periodMinutes: 5, graceMinutes: 0 },
      token: "raw-token-must-not-be-accepted",
    },
  ])("rejects invalid request %#", (input) => {
    expect(() => parseCreateMonitorRequest(input)).toThrow(
      InvalidMonitorRequest,
    );
  });

  it("rejects names longer than 100 characters", () => {
    expect(() =>
      parseCreateMonitorRequest({
        type: "uptime",
        name: "x".repeat(101),
        config: { url: "https://example.com" },
      }),
    ).toThrow(InvalidMonitorRequest);
  });
});

describe("isPublicHttpUrl", () => {
  it.each([
    "http://example.com",
    "https://example.com/health?full=1",
    "https://8.8.8.8:443/",
  ])("accepts public HTTP(S) URL %s", (url) => {
    expect(isPublicHttpUrl(url)).toBe(true);
  });

  it.each([
    "http://localhost",
    "https://api.localhost/health",
    "http://127.0.0.1:8080",
    "http://0.0.0.0",
    "http://169.254.10.20",
    "http://10.0.0.2",
    "http://172.16.0.1",
    "http://192.168.1.10",
    "http://[::]",
    "http://[::1]",
    "http://[fe80::1]",
    "http://[fd00::1]",
    "http://[::ffff:127.0.0.1]",
    "https://user:password@example.com",
    "ftp://example.com",
    "https://",
    "not a URL",
  ])("rejects non-public URL %s", (url) => {
    expect(isPublicHttpUrl(url)).toBe(false);
  });
});
~~~

- [ ] **Step 2: Run the validation test and verify the missing module failure.**

Run:

~~~bash
npm run test:worker -- validation.worker.test.ts
~~~

Expected: FAIL because `worker/validation.ts` does not exist yet.

- [ ] **Step 3: Implement strict request parsing and error type.**

Create `worker/validation.ts` with this implementation. The exact-key checks ensure server-controlled `status`, `token`, and unknown configuration fields cannot enter the domain layer.

~~~ts
import {
  nextJobDeadline,
  type CreateMonitorRequest,
  type JobConfig,
  type UptimeConfig,
} from "../shared/domain";

type JsonRecord = Record<string, unknown>;

export class InvalidMonitorRequest extends Error {
  readonly code = "invalid_request" as const;

  constructor(message: string) {
    super(message);
    this.name = "InvalidMonitorRequest";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): JsonRecord {
  if (!isRecord(value)) {
    throw new InvalidMonitorRequest(path + " must be an object");
  }
  return value;
}

function requireExactKeys(
  value: JsonRecord,
  allowed: readonly string[],
  path: string,
): void {
  const allowedKeys = new Set(allowed);
  const invalidKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (invalidKey) {
    throw new InvalidMonitorRequest(
      path + "." + invalidKey + " is not allowed",
    );
  }
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new InvalidMonitorRequest(path + " must be a string");
  }
  return value;
}

function parseName(value: unknown): string {
  const name = requireString(value, "name").trim();
  if (name.length < 1 || name.length > 100) {
    throw new InvalidMonitorRequest("name must contain 1 to 100 characters");
  }
  return name;
}

function requireSafeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new InvalidMonitorRequest(path + " must be a safe integer");
  }
  return value;
}

function parseUptimeConfig(value: unknown): UptimeConfig {
  const config = requireRecord(value, "config");
  requireExactKeys(config, ["url"], "config");
  const url = requireString(config.url, "config.url").trim();
  if (!isPublicHttpUrl(url)) {
    throw new InvalidMonitorRequest(
      "config.url must be a public HTTP(S) URL",
    );
  }
  return { url };
}

function parseJobConfig(value: unknown): JobConfig {
  const config = requireRecord(value, "config");
  requireExactKeys(config, ["periodMinutes", "graceMinutes"], "config");
  const periodMinutes = requireSafeInteger(
    config.periodMinutes,
    "config.periodMinutes",
  );
  const graceMinutes = requireSafeInteger(
    config.graceMinutes,
    "config.graceMinutes",
  );

  if (periodMinutes < 1) {
    throw new InvalidMonitorRequest(
      "config.periodMinutes must be at least 1",
    );
  }
  if (graceMinutes < 0) {
    throw new InvalidMonitorRequest(
      "config.graceMinutes must be at least 0",
    );
  }

  try {
    nextJobDeadline(0, periodMinutes, graceMinutes);
  } catch {
    throw new InvalidMonitorRequest(
      "config period and grace exceed safe epoch milliseconds",
    );
  }

  return { periodMinutes, graceMinutes };
}

export function parseCreateMonitorRequest(
  input: unknown,
): CreateMonitorRequest {
  const body = requireRecord(input, "body");
  requireExactKeys(body, ["type", "name", "config"], "body");
  const name = parseName(body.name);

  if (body.type === "uptime") {
    return { type: "uptime", name, config: parseUptimeConfig(body.config) };
  }
  if (body.type === "job") {
    return { type: "job", name, config: parseJobConfig(body.config) };
  }
  throw new InvalidMonitorRequest("type must be uptime or job");
}
~~~

- [ ] **Step 4: Implement hostname classification without adding a runtime dependency.**

Append the following helpers and exported URL validator to `worker/validation.ts`:

~~~ts
function parseIpv4(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return null;
  }

  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) {
    return null;
  }
  return octets as [number, number, number, number];
}

function isPrivateIpv4(hostname: string): boolean {
  const parsed = parseIpv4(hostname);
  if (!parsed) {
    return false;
  }

  const [first, second] = parsed;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function parseIpv6(hostname: string): number[] | null {
  if (!hostname.includes(":")) {
    return null;
  }

  const sections = hostname.toLowerCase().split("::");
  if (sections.length > 2) {
    return null;
  }

  const parseSection = (section: string): number[] | null => {
    if (section === "") {
      return [];
    }

    const words: number[] = [];
    for (const part of section.split(":")) {
      if (part.includes(".")) {
        const ipv4 = parseIpv4(part);
        if (!ipv4) {
          return null;
        }
        words.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(part)) {
          return null;
        }
        words.push(Number.parseInt(part, 16));
      }
    }
    return words;
  };

  const left = parseSection(sections[0]);
  const right = sections.length === 2 ? parseSection(sections[1]) : [];
  if (!left || !right) {
    return null;
  }

  if (sections.length === 1) {
    return left.length === 8 ? left : null;
  }

  const gap = 8 - left.length - right.length;
  if (gap < 1) {
    return null;
  }
  return [...left, ...Array.from({ length: gap }, () => 0), ...right];
}

function isPrivateIpv6(hostname: string): boolean {
  const groups = parseIpv6(hostname);
  if (!groups) {
    return false;
  }

  const allZero = groups.every((group) => group === 0);
  const loopback =
    groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  const linkLocal = (groups[0] & 0xffc0) === 0xfe80;
  const uniqueLocal = (groups[0] & 0xfe00) === 0xfc00;
  const ipv4Mapped =
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;

  if (ipv4Mapped) {
    const ipv4 =
      (groups[6] >> 8) +
      "." +
      (groups[6] & 0xff) +
      "." +
      (groups[7] >> 8) +
      "." +
      (groups[7] & 0xff);
    return isPrivateIpv4(ipv4);
  }

  return allZero || loopback || linkLocal || uniqueLocal;
}

export function isPublicHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }
  if (url.username !== "" || url.password !== "") {
    return false;
  }

  const hostname = url.hostname.toLowerCase().replace(/^\\[|\\]$/g, "");
  const canonicalHostname = hostname.endsWith(".")
    ? hostname.slice(0, -1)
    : hostname;

  if (
    canonicalHostname === "localhost" ||
    canonicalHostname.endsWith(".localhost") ||
    isPrivateIpv4(canonicalHostname) ||
    isPrivateIpv6(canonicalHostname)
  ) {
    return false;
  }
  return canonicalHostname.length > 0;
}
~~~

- [ ] **Step 5: Run focused validation tests and the full build.**

Run:

~~~bash
npm run test:worker -- validation.worker.test.ts
npm run test:worker -- domain.worker.test.ts validation.worker.test.ts
npm run build
~~~

Expected: all request, URL, deadline, and transition tests PASS, and the shared module typechecks in the Worker build.

### Task 4: Verify AI-02 boundaries and commit the vertical slice

**Files:**
- Verify only: `shared/domain.ts`, `worker/validation.ts`, `test/domain.worker.test.ts`, `test/validation.worker.test.ts`

- [ ] **Step 1: Confirm no unapproved runtime dependency or HTTP/database behavior was introduced.**

Run:

~~~bash
node -e 'const p=require("./package.json"); const actual=Object.keys(p.dependencies).sort(); const expected=["hono","react","react-dom"]; if (JSON.stringify(actual)!==JSON.stringify(expected)) process.exit(1); console.log(actual.join(","))'
rg -n "from [\"'](hono|react|react-dom)|fetch\(|D1Database|DB\.|Hono" shared worker/validation.ts
~~~

Expected: the dependency command prints `hono,react,react-dom`; the second command finds no HTTP, database, or router implementation in the AI-02 modules.

- [ ] **Step 2: Run the complete repository verification.**

Run:

~~~bash
npm test
npm run build
git diff --check
~~~

Expected: Worker and app suites PASS, the production build succeeds, and `git diff --check` prints no whitespace errors.

- [ ] **Step 3: Review the acceptance matrix.**

Confirm all of the following before marking AI-02 complete:

| Area | Required evidence |
| --- | --- |
| Shared types | All monitor, event, notification, webhook, and API DTO unions compile with the names in this plan. |
| Deadline | Valid minute inputs produce exact epoch-ms sums; invalid integers and unsafe arithmetic throw `RangeError`. |
| State transitions | Every listed transition has a test; unlisted transitions return `null`. |
| Request shape | Only `{ type, name, config }` and the matching config keys are accepted. |
| Name | Trimmed 1–100 character names pass; blank and 101-character names fail. |
| Uptime URL | Only credential-free HTTP(S) URLs with non-local/public hostnames pass. |
| Job config | Positive integer period, non-negative integer grace, and safe combined duration pass. |
| Scope | No D1 schema, route, auth, probe, scheduler, webhook delivery, or UI code is added. |

- [ ] **Step 4: Commit the completed AI-02 slice.**

~~~bash
git add shared/domain.ts worker/validation.ts test/domain.worker.test.ts test/validation.worker.test.ts docs/superpowers/plans/2026-08-22-ai-02-domain-validation.md
git commit -m "feat: add monitor domain rules and validation"
~~~

Expected: one commit contains the AI-02 implementation, its focused tests, and this implementation plan.

## Completion criteria

AI-02 is complete when:

1. `shared/domain.ts` exports the exact domain types and pure functions defined above.
2. `worker/validation.ts` parses only valid uptime/job creation bodies and rejects credentials, local/private IP literals, type/config mismatches, unknown server-controlled fields, and unsafe job durations.
3. `test/domain.worker.test.ts` and `test/validation.worker.test.ts` are discovered by the existing `vitest.worker.config.ts` include pattern and pass.
4. `npm test`, `npm run build`, and `git diff --check` pass.
5. The implementation adds no persistence, route, authentication, scheduler, webhook delivery, or UI behavior reserved for AI-03 and later.

## Self-review notes

- The plan uses `.worker.test.ts` filenames because the current Worker Vitest configuration includes only `test/**/*.worker.test.ts`; this avoids silently skipping the new tests.
- The public URL validator deliberately checks hostname literals, not DNS resolution. This matches the AI-02 input-validation boundary and leaves runtime egress policy to the uptime probe implementation.
- The IPv4-mapped IPv6 condition is written in corrected form as `groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff`, so ordinary `::` and `::1` classification remains separate.
