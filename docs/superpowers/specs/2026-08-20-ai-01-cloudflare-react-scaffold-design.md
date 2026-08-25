# Historical: AI-01 Cloudflare Worker and React Scaffold Design

> **Superseded:** This document describes the initial scaffold only. The current product contract is [the BYOC cron dead-man switch MVP](../../specs/cronup-alpha.md). It is retained as an implementation history record.

## Goal

Create the smallest runnable foundation for CronUp's alpha: one Cloudflare Worker deployment containing a Hono API entrypoint and React/Vite static assets. A fresh checkout must pass `npm ci`, `npm test`, and `npm run build`.

## Structure

The repository uses one root npm project and one dependency graph. React source lives under `src/`, Worker source under `worker/`, and both are built through Vite with Cloudflare's official Vite plugin. This keeps local development and production execution aligned without introducing separate frontend and backend packages.

The Worker exposes a minimal health response and a placeholder `scheduled()` handler. The React application renders a minimal CronUp shell. Product behavior beyond this scaffold belongs to later action items.

## Configuration

- Runtime dependencies are limited to `hono`, `react`, and `react-dom`.
- Development dependencies provide TypeScript, Vite, React compilation, Wrangler, the Cloudflare Vite plugin, Vitest 4.1 or newer, Workers Vitest integration, jsdom, and React test utilities.
- `vite.config.ts` combines the React and Cloudflare plugins.
- `wrangler.jsonc` points to the Worker entrypoint, declares draft `DB` and `ASSETS` bindings, schedules one `* * * * *` Cron Trigger, enables SPA fallback, and routes `/`, `/api/*`, and `/ping/*` through the Worker first.
- The compatibility date is pinned to `2026-08-20`.

## Test Design

Tests are separated by runtime:

- The Worker suite runs in the Cloudflare Workers test environment and verifies the minimal fetch and scheduled entrypoints can load and execute.
- The application suite runs in jsdom and verifies the React shell renders.
- The root `npm test` script runs both suites in sequence so a failure in either suite fails the command.

Tests are written and observed failing before the minimum scaffold implementation is added. No monitor domain behavior, persistence queries, authentication, or dashboard functionality is introduced in AI-01.

## Commands and Completion

The root scripts provide `dev`, `test`, `test:worker`, `test:app`, `build`, `preview`, `deploy`, and `cf-typegen`.

AI-01 is complete when dependency installation is reproducible through the committed lockfile, both test suites pass, the Worker and browser assets build together, and only the three approved runtime dependencies appear in `dependencies`.
