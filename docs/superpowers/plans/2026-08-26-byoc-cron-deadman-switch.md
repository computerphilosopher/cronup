# BYOC Cron Dead-Man Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the uptime scaffold with a Healthchecks-style cron heartbeat subset deployed to the customer's Cloudflare account.

**Architecture:** The Worker accepts authenticated admin requests, public tokenized ping requests, and a one-minute scheduled evaluator. D1 stores check configuration and current state; the React dashboard manages checks and displays copyable ping URLs. The evaluator computes period/cron deadlines and sends state-transition Slack alerts.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers/D1, React, Vite, Vitest.

---

### Task 1: Replace domain types and validation

**Files:**
- Modify: `shared/domain.ts`
- Modify: `worker/validation.ts`
- Test: `test/domain.worker.test.ts`
- Test: `test/validation.worker.test.ts`

- [ ] Write failing tests for check statuses, period/cron schedules, timezone, and grace validation.
- [ ] Run `npm run test:worker -- domain.worker.test.ts validation.worker.test.ts` and verify the new assertions fail.
- [ ] Implement `CheckDto`, `Schedule`, create request parsing, and strict validation.
- [ ] Re-run the focused tests and then the worker suite.

### Task 2: Replace D1 schema and repository

**Files:**
- Modify: `migrations/0001_initial.sql`
- Modify: `worker/db/monitors.ts` (rename exports/types in place to minimize churn)
- Test: `test/monitors-db.worker.test.ts`

- [ ] Write failing tests for create/list/delete, token lookup, ping timestamp updates, pause/resume, and current-state persistence.
- [ ] Run the focused DB test and verify failure.
- [ ] Replace the uptime columns with schedule JSON, ping token, grace seconds, status, and last-ping fields using bound parameters.
- [ ] Implement repository methods for checks and state transitions.
- [ ] Run the DB tests against the migration.

### Task 3: Add ping endpoint and schedule evaluator

**Files:**
- Create: `worker/cron.ts`
- Modify: `worker/index.ts`
- Test: `test/cron.worker.test.ts`
- Test: `test/scaffold.worker.test.ts`

- [ ] Write failing tests for valid/invalid token pings and new/up state changes.
- [ ] Write failing tests for period and cron due detection, grace transitions, pause exclusion, recovery, and bounded evaluation.
- [ ] Run the focused tests and verify failure.
- [ ] Implement token ping handling, deadline calculation, state transitions, and scheduled evaluation.
- [ ] Wire `GET/POST /ping/:token` and `scheduled(controller, env)` into the Worker.
- [ ] Run all worker tests.

### Task 4: Add admin check API and Slack notifications

**Files:**
- Create: `worker/routes/checks.ts`
- Create: `worker/notifications/slack.ts`
- Modify: `worker/index.ts`
- Test: `test/checks-api.worker.test.ts`
- Test: `test/slack.worker.test.ts`

- [ ] Write failing tests for authenticated list/create/delete/pause/resume and Slack test endpoints.
- [ ] Write failing tests for down/recovery transition messages and retry behavior.
- [ ] Run focused tests and verify failure.
- [ ] Implement routes, token generation, and Slack transition aggregation.
- [ ] Preserve existing Basic Auth and same-origin mutation protections.
- [ ] Run the full worker suite.

### Task 5: Replace the React dashboard

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Create or modify: `src/api.ts`
- Test: `test/scaffold.app.test.tsx`

- [ ] Write failing UI tests for create form, status list, copyable ping URL, pause/resume, delete, Slack test, loading, empty, and error states.
- [ ] Run the app test and verify failure.
- [ ] Implement the single-screen check dashboard without adding a router or component framework.
- [ ] Add 30-second polling with timer cleanup.
- [ ] Run app tests and build.

### Task 6: Update deployment docs and verify

**Files:**
- Modify: `README.md` if present or create it
- Modify: `docs/specs/cronup-alpha.md` only if implementation details expose a contradiction
- Modify: `wrangler.jsonc` and migration scripts as needed

- [ ] Document Deploy to Cloudflare, secret setup, check creation, and ping examples.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check` and inspect the final diff for leftover uptime terminology.
- [ ] Commit the implementation in focused commits.
