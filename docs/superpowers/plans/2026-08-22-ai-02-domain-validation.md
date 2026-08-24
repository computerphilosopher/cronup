# AI-02 Uptime Domain and Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uptime-only MVP가 Worker와 React에서 공유할 monitor 타입과 외부 생성 입력 검증을 고정한다.

**Architecture:** `shared/domain.ts`는 uptime monitor의 DTO와 순수 타입만 소유한다. `worker/validation.ts`는 JSON 경계에서 `{ name, url }`만 수동 검증한다. probe 네트워크 정책, D1, Hono, Basic Auth는 이 단계에 포함하지 않는다.

**Tech Stack:** TypeScript, Cloudflare Workers, Vitest, `@cloudflare/vitest-pool-workers`

**Source spec:** `docs/superpowers/specs/2026-08-24-uptime-only-mvp-scope-design.md`

---

## Scope and fixed decisions

- MVP monitor type은 uptime 하나뿐이다. `type` discriminator를 만들지 않는다.
- 생성 요청 shape은 `{ name, url }`로 고정한다.
- 이름은 trim 후 1~100자다.
- URL은 `http:` 또는 `https:`만 허용하고 username/password를 거부한다.
- custom IPv4/IPv6 parser, DNS lookup, redirect 검사는 만들지 않는다. 실제 probe는 AI-06에서 `redirect: "manual"`로 처리한다.
- 모든 epoch ms와 latency 값은 safe integer다.
- API 계층은 `InvalidMonitorRequest`를 나중에 `{ error: { code: "invalid_request", message } }`로 변환한다. 이번 단계에서는 HTTP 응답을 만들지 않는다.

## Public contract

```ts
// shared/domain.ts
export type MonitorStatus = "pending" | "healthy" | "down";

export type CreateMonitorRequest = {
  name: string;
  url: string;
};

export type MonitorDto = {
  id: string;
  name: string;
  url: string;
  status: MonitorStatus;
  createdAt: number;
  updatedAt: number;
  lastCheckedAt: number | null;
  statusCode: number | null;
  latencyMs: number | null;
};

// worker/validation.ts
export class InvalidMonitorRequest extends Error {
  readonly code: "invalid_request";
}

export function parseCreateMonitorRequest(
  input: unknown,
): CreateMonitorRequest;

export function isHttpUrl(value: string): boolean;
```

`MonitorDto`에는 heartbeat token, deadline, event, webhook, target credential이 없다.

## File map

- `shared/domain.ts`: uptime status, creation request, monitor response DTO
- `worker/validation.ts`: strict object/key/name/URL parsing
- `test/domain.worker.test.ts`: compile-time-visible DTO contract
- `test/validation.worker.test.ts`: accepted/rejected request cases
- `test/tsconfig.domain.json`: `npm run build`가 shared/test contract를 실제로 typecheck하도록 하는 좁은 project reference

## Implementation tasks

### Task 1: Lock the uptime domain types

**Files:**
- Create: `shared/domain.ts`
- Create: `test/domain.worker.test.ts`
- Create: `test/tsconfig.domain.json`
- Modify: `tsconfig.json`

- [ ] **Step 1: Write the failing contract test.**

  `test/domain.worker.test.ts`에서 `CreateMonitorRequest`, `MonitorDto`, `MonitorStatus`를 import하고 uptime 생성 요청과 `MonitorDto` 대입을 테스트한다. 지원되지 않는 status literal과 누락된 `url`에는 `@ts-expect-error`를 둔다.

- [ ] **Step 2: Run the contract test and typecheck.**

  Run `npm run test:worker -- domain.worker.test.ts` and `npm run build`. The implementation import/type surface is missing, so the type project must fail before implementation.

- [ ] **Step 3: Add only the three uptime types.**

  `shared/domain.ts`에 위 Public contract의 정확한 declarations만 추가한다. Worker binding, Hono, `fetch`, D1, browser global은 import하지 않는다.

- [ ] **Step 4: Make the contract compiler-visible and verify green.**

  `test/tsconfig.domain.json`을 `domain.worker.test.ts`와 `shared/domain.ts`만 포함하도록 만들고 root `tsconfig.json`에 reference를 추가한다. Run `npm run test:worker -- domain.worker.test.ts`, `npm run build`, `git diff --check`.

- [ ] **Step 5: Commit the domain surface.**

  ```bash
  git add shared/domain.ts test/domain.worker.test.ts test/tsconfig.domain.json tsconfig.json
  git commit -m "feat: define uptime monitor domain types"
  ```

### Task 2: Add strict creation validation

**Files:**
- Create: `worker/validation.ts`
- Create: `test/validation.worker.test.ts`
- Modify: `test/tsconfig.domain.json`

- [ ] **Step 1: Write accepted and rejected request tests.**

  Accepted input:

  ```ts
  parseCreateMonitorRequest({
    name: "  Public website  ",
    url: "https://example.com/health",
  });
  // { name: "Public website", url: "https://example.com/health" }
  ```

  Rejected inputs must include `undefined`, `null`, arrays, missing fields, blank/101-character names, `ftp://example.com`, malformed URLs, credentials, unknown top-level keys such as `status` and `token`, and non-string fields. Every rejection is `InvalidMonitorRequest` with `code === "invalid_request"`.

- [ ] **Step 2: Run the validation test to verify it fails.**

  Run `npm run test:worker -- validation.worker.test.ts`. Expected: FAIL because `worker/validation.ts` does not exist.

- [ ] **Step 3: Implement the smallest strict parser.**

  Use a plain-record guard and an exact-key check allowing only `name` and `url`. Trim the name and URL before returning. Implement `isHttpUrl` with `new URL(value)`, accept only `http:`/`https:`, and reject non-empty `username` or `password`. Do not resolve DNS and do not call `fetch`.

- [ ] **Step 4: Verify validation and compiler coverage.**

  Run `npm run test:worker -- validation.worker.test.ts domain.worker.test.ts`, `npm run build`, and `git diff --check`. Confirm `rg -n "fetch\\(|D1Database|Hono|parseIpv[46]" worker/validation.ts shared/domain.ts` returns no matches.

- [ ] **Step 5: Commit validation.**

  ```bash
  git add worker/validation.ts test/validation.worker.test.ts test/tsconfig.domain.json
  git commit -m "feat: validate uptime monitor creation"
  ```

## AI-02 acceptance checklist

- [ ] Only uptime DTOs and `{ name, url }` are exported.
- [ ] Unknown server-controlled fields are rejected.
- [ ] Names are trimmed and limited to 1~100 characters.
- [ ] Only credential-free HTTP(S) URLs pass.
- [ ] No job, heartbeat, event, webhook, retention, DNS, or network behavior exists in the module.
- [ ] Focused tests, full build, and diff check pass.
