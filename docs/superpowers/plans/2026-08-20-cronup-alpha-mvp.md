# CronUp Uptime-only MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** tiny project보다 무거운 모니터링 인프라를 운영하지 않고, Cloudflare 계정 하나에 직접 배포해 HTTP(S) URL의 현재 uptime 상태를 확인하는 MVP를 완성한다.

**Architecture:** 하나의 Cloudflare Worker가 Hono 기반 admin API와 `scheduled()` uptime runner를 제공하고, 같은 배포물의 React/Vite 정적 자산이 현재 monitor 상태를 보여준다. D1에는 현재 상태만 저장한다. 이벤트, heartbeat, webhook, demo 전용 계층은 만들지 않는다.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, D1 raw SQL, React, Vite, Cloudflare Vite plugin, Vitest, Wrangler, npm

**Source spec:** `docs/specs/cronup-alpha.md`

**Product thesis:** 작은 프로젝트에도 외부 모니터링은 필요하지만 모니터링 시스템이 프로젝트 자체만큼 무거워서는 안 된다. MVP는 별도 VM, agent fleet, coordination service, 전용 시계열 데이터베이스 없이 Workers, Cron Triggers, D1, Static Assets만으로 현재 uptime을 제공한다. Cloudflare Free plan의 관대한 한도를 활용하되 무료 운영 자체를 제품 보장으로 약속하지 않는다.

---

## Scope lock

MVP의 사용자 흐름은 `Basic Auth → URL 생성 → 1분 자동 GET → 현재 상태 조회 → 삭제`다.

배포 전략은 BYO Cloudflare 우선이다. 사용자·조직·과금·중앙 control plane은 만들지 않는다. 향후 managed offering은 선택지로 남기지만 MVP 구현이 이를 선행 설계하지 않으며, 가능한 경우 BYO 배포의 단일 소유자·단일 D1 경계를 유지한다.

`CronUp`은 임시 이름이다. uptime 제품의 최종 이름이 정해지면 repository 이름도 함께 변경하며, 그 전까지 기존 package, Worker, Basic Auth realm 이름은 유지한다.

포함:

- uptime monitor만 지원
- `pending | healthy | down` 상태
- Basic Auth 기반 단일 관리자
- GET 1회, 10초 timeout, no retry, manual redirect
- 1분 Cron Trigger, 가장 오래 확인되지 않은 monitor 최대 20개
- D1 current-state row 하나
- React 단일 admin 화면
- 한 가지 배포 경로, AGPL-3.0-only 문서

로드맵으로 이동:

- job heartbeat, `missed`, token, deadline/grace
- events table/history/retention
- state-transition notification, Generic Webhook, outbox/retry
- `/demo`, public status page
- DNS-aware SSRF policy, VPC egress integration
- incidents, rollups, users/teams/roles

## Existing implementation status

- AI-01의 Cloudflare Worker + React scaffold는 `b1efc19`에서 이미 구현되어 active task에서 제외한다.
- `codex/ai-02-domain-validation`의 `7a26519`는 아직 `main`에 병합되지 않은 이전 범위의 실험 브랜치다. job/event/webhook 타입이 포함되어 uptime-only MVP 기준으로 완료 처리하거나 병합하지 않는다.
- 실제 다음 구현은 uptime-only 계약에 맞춘 AI-02 domain/validation부터 시작한다.

## File map

```text
migrations/0001_initial.sql
shared/domain.ts
worker/validation.ts
worker/auth.ts
worker/errors.ts
worker/db/monitors.ts
worker/routes/monitors.ts
worker/uptime.ts
worker/index.ts
src/api.ts
src/App.tsx
src/styles.css
src/components/MonitorList.tsx
src/components/CreateMonitorForm.tsx
test/domain.worker.test.ts
test/validation.worker.test.ts
test/auth.worker.test.ts
test/monitors-api.worker.test.ts
test/uptime.worker.test.ts
test/scheduled.worker.test.ts
test/dashboard.test.tsx
README.md
LICENSE
docs/release/uptime-mvp-smoke-checklist.md
```

## Dependency order

```text
AI-01 scaffold
  ├─ AI-02 domain/validation ─ AI-03 D1 ─ AI-05 API ─┬─ AI-06 probe ─ AI-07 scheduler
  └─ AI-04 auth ──────────────────────────────────────┘                 │
                                                    AI-08 dashboard ───┤
                                                    AI-09 docs ─────────┤
                                                    AI-10 release check ┘
```

AI-01은 이미 존재하는 scaffold다. AI-02 상세 절차는 `docs/superpowers/plans/2026-08-22-ai-02-domain-validation.md`에 고정한다.

---

### AI-02: Uptime domain과 입력 검증

**크기:** 0.5일

**의존성:** AI-01

**Files:** AI-02 상세 계획의 파일 목록

- [ ] 상세 계획의 Task 1에서 `MonitorStatus`, `CreateMonitorRequest`, `MonitorDto`만 추가한다.
- [ ] 상세 계획의 Task 2에서 `{ name, url }` strict parser와 credential-free HTTP(S) 검증을 추가한다.
- [ ] `job`, `event`, `webhook`, `retention`, custom IP parser, DNS lookup가 없는지 `rg`로 확인한다.
- [ ] Run: `npm run test:worker -- domain.worker.test.ts validation.worker.test.ts` — Expected: all focused tests PASS.
- [ ] Run: `npm run build` — Expected: Worker/client build PASS.
- [ ] Commit: `feat: define uptime domain and validation`

완료 조건은 [AI-02 상세 계획](/docs/superpowers/plans/2026-08-22-ai-02-domain-validation.md)의 acceptance checklist다.

### AI-03: D1 monitors schema와 query

**크기:** 0.5~1일

**의존성:** AI-02

**Files:**
- Create: `migrations/0001_initial.sql`
- Create: `worker/db/monitors.ts`
- Create: `test/monitors-db.worker.test.ts`

- [ ] `monitors` 테이블을 `id`, `name`, `url`, `status`, `last_checked_at`, `last_status_code`, `last_latency_ms`, `created_at`, `updated_at` 컬럼으로 만든다. status CHECK는 `pending`, `healthy`, `down`만 허용한다.
- [ ] `last_checked_at` 정렬을 위한 index를 만들고 events/token/deadline index는 만들지 않는다.
- [ ] prepared SQL 함수 `createMonitor`, `listMonitors`, `deleteMonitor`, `selectDueMonitors(limit=20)`, `updateMonitorResult`를 구현한다.
- [ ] 외부 값은 모두 bind parameter로 전달하고 URL/name을 문자열 연결하지 않는다.
- [ ] Run: `npx wrangler d1 migrations apply DB --local` — Expected: migration PASS.
- [ ] Run: `npm run test:worker -- monitors-db.worker.test.ts` — Expected: create/list/delete, oldest-first limit, result update PASS.
- [ ] Commit: `feat: add uptime monitor D1 storage`

### AI-04: Basic Auth와 공통 오류

**크기:** 0.5일

**의존성:** AI-01

**Files:**
- Create: `worker/auth.ts`, `worker/errors.ts`
- Create: `test/auth.worker.test.ts`
- Modify: `worker/env.ts`, `worker/index.ts`

- [ ] username `admin`과 `env.ADMIN_SECRET`를 비교하는 Basic Auth parser를 만든다. secret이 없거나 빈 문자열이면 fail closed한다.
- [ ] `/`와 `/api/*`에 `401` 및 `WWW-Authenticate: Basic realm="CronUp"`를 적용한다. 정적 asset은 인증된 `/` 요청을 통해서만 관리 화면에 제공한다.
- [ ] POST/DELETE는 JSON 요청의 `Content-Type: application/json`과 same-origin `Origin`을 검사한다.
- [ ] `/demo`, `/ping/:token`, heartbeat 예외는 만들지 않는다. 이번 MVP에는 public route가 없다.
- [ ] 모든 API 오류를 `{ error: { code, message } }`로 만드는 `jsonError` helper를 추가한다.
- [ ] Run: `npm run test:worker -- auth.worker.test.ts` — Expected: success/failure/missing-secret/origin cases PASS.
- [ ] Commit: `feat: protect uptime admin routes`

### AI-05: Monitor create/list/delete API

**크기:** 1일

**의존성:** AI-02, AI-03, AI-04

**Files:**
- Create: `worker/routes/monitors.ts`
- Create: `test/monitors-api.worker.test.ts`
- Modify: `worker/index.ts`

- [ ] `GET /api/monitors`는 현재 monitor row를 생성순으로 `MonitorDto[]`로 반환한다.
- [ ] `POST /api/monitors`는 `parseCreateMonitorRequest`를 호출하고 서버가 UUID, `pending`, timestamps를 만든 뒤 monitor를 저장한다.
- [ ] `DELETE /api/monitors/:id`는 삭제 후 `204`를 반환한다. 존재하지 않는 id는 공통 `404` 오류를 반환한다.
- [ ] update endpoint, events endpoint, heartbeat URL, token, status 직접 쓰기를 만들지 않는다.
- [ ] Run: `npm run test:worker -- monitors-api.worker.test.ts` — Expected: create/list/delete, validation, auth, error shape PASS.
- [ ] Commit: `feat: add uptime monitor administration API`

### AI-06: 단일 uptime probe

**크기:** 1일

**의존성:** AI-02, AI-03, AI-05

**Files:**
- Create: `worker/uptime.ts`
- Create: `test/uptime.worker.test.ts`

- [ ] `probeUptime(url, fetcher, clock)`를 구현한다. `fetcher(url, { method: "GET", redirect: "manual", signal })` 한 번만 호출하고 10초 timeout을 적용한다.
- [ ] 최종 status 200~399는 `{ status: "healthy", statusCode, latencyMs }`로, 그 밖의 status와 timeout/network error는 `{ status: "down", statusCode|null, latencyMs|null }`로 정규화한다.
- [ ] retry, redirect follow, body parsing, response assertion을 추가하지 않는다.
- [ ] monotonic clock 차이로 latency를 계산한다. D1 오류는 probe 결과와 분리해 호출자가 기존 상태를 보존할 수 있게 한다.
- [ ] Run: `npm run test:worker -- uptime.worker.test.ts` — Expected: success/failure/timeout/network/manual-redirect/no-retry PASS.
- [ ] Commit: `feat: add single uptime probe`

### AI-07: Scheduled bounded runner

**크기:** 0.5~1일

**의존성:** AI-03, AI-05, AI-06

**Files:**
- Create: `worker/scheduled.ts`
- Create: `test/scheduled.worker.test.ts`
- Modify: `worker/index.ts`

- [ ] `scheduled(controller, env, ctx)`에서 `controller.scheduledTime`을 한 번 캡처한다.
- [ ] `selectDueMonitors(20)`으로 오래 확인되지 않은 monitor만 고르고, 한 tick에 한 번만 처리한다.
- [ ] 선택된 monitor의 probe/update 작업을 bounded `Promise.allSettled`로 실행한다. 별도 retry와 delayed tick replay loop는 만들지 않는다.
- [ ] probe 결과는 해당 row의 상태/last-check/status-code/latency를 갱신한다. 개별 probe 실패는 down으로 저장하고 D1/코드 오류는 기존 row를 유지한다.
- [ ] `ctx.waitUntil()`에서 scheduler promise를 실행하고 rejection은 구조화된 log로 남긴다.
- [ ] Run: `npm run test:worker -- scheduled.worker.test.ts` — Expected: oldest-first, cap 20, no replay, internal-error preservation PASS.
- [ ] Run: `npm test` — Expected: Worker/app suites PASS.
- [ ] Commit: `feat: schedule bounded uptime checks`

### AI-08: Admin dashboard

**크기:** 1~1.5일

**의존성:** AI-04, AI-05

**Files:**
- Create: `src/api.ts`, `src/components/MonitorList.tsx`, `src/components/CreateMonitorForm.tsx`
- Create: `test/dashboard.test.tsx`
- Modify: `src/App.tsx`, `src/styles.css`

- [ ] browser `fetch` wrapper로 list/create/delete API를 호출하고 non-2xx 공통 오류를 화면 메시지로 바꾼다.
- [ ] monitor name, URL, status, last checked, status code, latency를 하나의 목록에 표시한다.
- [ ] 생성 form은 name/url만 받고 제출 중 중복 요청을 막는다. 성공 후 목록을 다시 읽는다.
- [ ] 삭제 전 확인을 받고 성공 후 목록을 다시 읽는다. optimistic mutation은 사용하지 않는다.
- [ ] 최초 load와 30초 polling, unmount cleanup, loading/empty/error/retry를 구현한다.
- [ ] Router, query library, chart, public demo, event details를 추가하지 않는다.
- [ ] Run: `npm run test:app -- dashboard.test.tsx` — Expected: list/create/delete/polling/loading/empty/error PASS.
- [ ] Run: `npm run build` — Expected: Worker and client build PASS.
- [ ] Commit: `feat: add uptime admin dashboard`

### AI-09: 배포 문서와 라이선스

**크기:** 0.5일

**의존성:** AI-03, AI-04, AI-07, AI-08

**Files:**
- Create: `README.md`, `LICENSE`
- Modify: `wrangler.jsonc`, `package.json`

- [ ] README에 `npm install`, `wrangler login`, D1 생성/migration, `wrangler secret put ADMIN_SECRET`, build/deploy, Basic Auth와 monitor smoke 순서를 하나의 canonical flow로 기록한다.
- [ ] `wrangler.jsonc`에 Worker, `DB` binding, Static Assets, `* * * * *` Cron Trigger, pinned compatibility date를 둔다.
- [ ] `/demo`, `WEBHOOK_URL`, heartbeat token, events retention, public status page를 문서화하지 않는다.
- [ ] `LICENSE`에 AGPL-3.0-only 전문을 넣고 package metadata를 맞춘다.
- [ ] Run: `npm run build` — Expected: documentation/config 상태에서 build PASS.
- [ ] Commit: `docs: document uptime MVP deployment`

### AI-10: MVP release verification

**크기:** 0.5~1일 + 배포 확인

**의존성:** AI-01~AI-09

**Files:**
- Create: `docs/release/uptime-mvp-smoke-checklist.md`

- [ ] `npm ci`, `npm test`, `npm run build`를 깨끗한 checkout에서 실행한다.
- [ ] local scheduled smoke에서 한 tick이 최대 20개 monitor만 확인하고 과거 tick을 replay하지 않는지 확인한다.
- [ ] protected `/`와 `/api/*`의 401 challenge, monitor create/list/delete, healthy/down 결과를 확인한다.
- [ ] clean Cloudflare account에서 README의 단일 흐름대로 D1 migration, `ADMIN_SECRET`, deploy를 수행한다.
- [ ] deployed Worker에서 공개 uptime URL의 healthy/down 전이를 확인한다. secret과 실제 URL은 checklist에 기록하지 않는다.
- [ ] roadmap 기능이 코드/API/UI에 섞이지 않았는지 `rg`와 scope checklist로 확인한다.
- [ ] Commit: `test: verify uptime MVP release`

## MVP completion checklist

- [ ] 단일 관리자가 Basic Auth 후 URL을 생성·조회·삭제한다.
- [ ] 1분 Cron Trigger가 최대 20개 URL을 GET 한 번씩 확인한다.
- [ ] 성공은 healthy, 기타 결과는 down으로 현재 row에 저장된다.
- [ ] 대시보드가 현재 상태와 마지막 결과를 보여준다.
- [ ] job, heartbeat, events, retention, webhook, demo, users/teams가 구현·문서 약속에 없다.
- [ ] `npm ci`, `npm test`, `npm run build`, local scheduled smoke, clean-account deploy smoke가 통과한다.
