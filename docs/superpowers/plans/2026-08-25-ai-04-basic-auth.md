# AI-04 Basic Auth and Common Errors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect the CronUp admin page and API with fail-closed Basic Auth, enforce same-origin JSON mutations, and standardize API errors.

**Architecture:** `worker/auth.ts` owns credential parsing and request authorization. `worker/errors.ts` owns the shared JSON error response shape. `worker/index.ts` applies the boundary to `/` and `/api/*`, while leaving `/api/health` available only after authentication and routing no public demo or heartbeat exceptions.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, Vitest, `@cloudflare/vitest-pool-workers`

---

### Task 1: Add failing auth and error-contract tests

**Files:**
- Create: `test/auth.worker.test.ts`

- [x] **Step 1: Test the auth helper contract.** Cover valid `admin` credentials, wrong username/password, malformed headers, missing secret, and empty secret. Assert unauthorized results include the Basic Auth challenge.
- [x] **Step 2: Test mutation request guards.** Cover JSON content type acceptance, non-JSON rejection, same-origin acceptance, missing or foreign origin rejection, and non-mutation methods bypassing the mutation-only checks.
- [x] **Step 3: Test the Worker boundary and error shape.** Assert unauthenticated `/` and `/api/*` requests return `401`, authenticated `/api/health` returns `200`, authenticated `/` delegates to assets, and `jsonError` produces `{ error: { code, message } }`.
- [x] **Step 4: Run the focused test before implementation.** Run `npm run test:worker -- auth.worker.test.ts`. It failed because `worker/auth.ts` and `worker/errors.ts` did not exist.

### Task 2: Implement auth, request guards, and common errors

**Files:**
- Create: `worker/auth.ts`
- Create: `worker/errors.ts`
- Modify: `worker/env.ts`

- [x] **Step 1: Add the minimal auth API.** Export `isAuthorized(request, secret)` and `unauthorizedResponse()`. Decode the Basic header with `atob`, require username `admin`, compare the supplied password with a non-empty configured secret, and fail closed when the secret is absent or empty.
- [x] **Step 2: Add mutation validation helpers.** Export `isJsonMutation(request)` and require `POST`, `PUT`, `PATCH`, or `DELETE` requests to use `application/json` and have an `Origin` equal to the request origin. Permit non-mutation methods without those checks.
- [x] **Step 3: Add `jsonError`.** Export `jsonError(code, message, status)` returning a JSON `Response` with the exact `{ error: { code, message } }` body and `application/json` content type.
- [x] **Step 4: Extend `Env`.** Add `ADMIN_SECRET?: string` while preserving the existing D1 and asset bindings.

### Task 3: Apply auth to Worker routes

**Files:**
- Modify: `worker/index.ts`

- [x] **Step 1: Add the auth gate.** For `/` and `/api/*`, return `unauthorizedResponse()` unless `isAuthorized` succeeds. Keep the existing Hono route behavior after authorization.
- [x] **Step 2: Apply mutation guards.** For authenticated mutation requests under `/api/*`, return `jsonError("invalid_request", "JSON content type and same-origin Origin are required", 400)` when `isJsonMutation` fails.
- [x] **Step 3: Keep the public surface narrow.** Do not add `/demo`, `/ping/:token`, heartbeat, token, or other auth exceptions. Continue delegating `/` to `ASSETS.fetch` only after authorization.

### Task 4: Verify and commit

**Files:**
- Modify: `test/auth.worker.test.ts` if assertions need fixture-only corrections

- [x] **Step 1: Run focused tests.** Run `npm run test:worker -- auth.worker.test.ts` and confirm all auth, mutation, route, and error-shape cases pass (17 tests).
- [x] **Step 2: Run the complete verification suite.** Run `npm test`, `npm run build`, and `git diff --check`.
- [x] **Step 3: Review the requirement checklist.** Confirm missing/empty secrets fail closed, `WWW-Authenticate` is present on every `401`, `/` and `/api/*` are protected, mutations require JSON and same-origin, and no public exceptions were added.
- [ ] **Step 4: Commit the implementation.**

```bash
git add worker/auth.ts worker/errors.ts worker/env.ts worker/index.ts test/auth.worker.test.ts docs/superpowers/plans/2026-08-25-ai-04-basic-auth.md
git commit -m "feat: protect uptime admin routes"
```
