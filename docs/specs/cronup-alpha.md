# CronUp BYOC Cron Dead-Man Switch MVP

## 1. Product purpose

CronUp monitors scheduled jobs from outside the machine where they run. A job sends a success ping to a Worker-owned URL after it completes. If the expected ping does not arrive within the configured grace period, CronUp marks the check late/down and sends an alert.

CronUp is deployed to the customer's own Cloudflare account. The MVP does not require a monitoring VPS, host agent, Prometheus server, time-series database, or central SaaS control plane. Cloudflare usage is best-effort and subject to the customer's plan limits; no zero-cost or availability guarantee is made.

The MVP validates one question:

> Can a small VPS operator deploy a private external watchdog and detect a missed cron job without operating additional monitoring infrastructure?

Every monitored job must explicitly call its generated ping URL.

## 2. Deployment boundary

- TypeScript, Cloudflare Workers, Hono, Cloudflare D1, React, and Vite
- One Worker serving API, dashboard, ping endpoint, and scheduled evaluator
- D1 stores check configuration and current state only
- Cloudflare Cron Trigger evaluates overdue checks once per minute
- No Queue, Durable Objects, KV, R2, Redis, external database, or central control plane
- BYO Cloudflare deployment with one administrator

Required secrets:

- `ADMIN_SECRET`: Basic Auth password for the dashboard and admin API
- `SLACK_WEBHOOK_URL`: optional alert destination

## 3. Check model

```ts
type CheckStatus = "new" | "up" | "late" | "down" | "paused";

type Schedule =
  | { kind: "period"; periodSeconds: number }
  | { kind: "cron"; expression: string; timezone: string };

type Check = {
  id: string;
  name: string;
  pingToken: string;
  schedule: Schedule;
  graceSeconds: number;
  status: CheckStatus;
  lastPingAt: number | null;
  createdAt: number;
  updatedAt: number;
};
```

Ping tokens are secrets and are shown only when a check is created or explicitly revealed by an authenticated administrator. The token is not logged.

## 4. Ping API

Each check has a unique endpoint:

```text
GET  /ping/:token
POST /ping/:token
```

A successful request records the current timestamp and returns `200 OK`. The request body is ignored in the MVP. A ping is the only job instrumentation required.

The MVP does not support `/start`, `/fail`, exit-code reporting, execution-time measurement, log attachment, response assertions, or automatic wrapper commands.

Example:

```cron
0 2 * * * /path/to/backup.sh && curl -fsS https://<worker>/ping/<token>
```

If the command fails before the ping, no success signal arrives and the evaluator detects the missed run.

## 5. Schedule evaluation

- Support a simple period and a standard cron expression with an explicit timezone.
- `graceSeconds` is the additional time allowed after the expected run.
- Period checks are late when the elapsed time since the last successful ping exceeds `period + grace`.
- Cron checks are late when the next scheduled wall-clock time plus grace has passed without a ping.
- A check with no ping is `new`; after its first timely ping it becomes `up`.
- A missed deadline transitions `up` or `new` to `late`, then to `down` when grace expires.
- A subsequent valid ping transitions `late` or `down` to `up` and emits a recovery event.
- `paused` checks are excluded from evaluation and notifications.
- The evaluator is best-effort. It does not replay missed Worker ticks or fabricate historical runs.

The Worker evaluates all overdue checks in bounded batches. Existing check state is preserved when an internal D1 or evaluator error occurs.

## 6. Notifications

Slack Incoming Webhook is the only configured channel in the MVP.

- Notify on transition to `down`.
- Notify on recovery to `up`.
- Do not repeat notifications while the state is unchanged.
- Include check name, state, expected schedule, last ping time, and dashboard link.
- Missing Slack configuration does not stop ping ingestion or state evaluation.
- Retry `429` and `5xx` responses up to three attempts; do not retry other `4xx` responses.

Generic Webhook, email, Discord, Telegram, PagerDuty, notification outbox, and delivery guarantees are out of scope.

## 7. Admin API and UI

Basic Auth protects the dashboard and admin API. The fixed username is `admin`; `ADMIN_SECRET` is required and missing credentials fail closed.

```text
GET    /api/checks
POST   /api/checks
DELETE /api/checks/:id
POST   /api/checks/:id/pause
POST   /api/checks/:id/resume
POST   /api/notifications/slack/test
```

The create form accepts name, schedule, timezone when applicable, and grace period. The dashboard shows the ping URL, copy action, current status, last ping, next expected run, and pause/resume controls. It must provide loading, empty, error, and retry states.

There is no uptime URL probing, public status page, chart, long-term event history, team management, billing, or multi-user role model.

## 8. Persistence

D1 stores checks and current state. The MVP has no event-history or notification-outbox table. Timestamps are UTC epoch milliseconds. All external values use prepared statement parameters.

## 9. Deployment

The canonical flow is a Deploy to Cloudflare button that provisions/binds D1, applies migrations, configures the Worker, Static Assets, and one-minute Cron Trigger, and prompts for secrets. A manual Wrangler flow is documented only for contributors and troubleshooting.

## 10. Verification

Tests cover:

- period and cron schedule validation, timezone, and grace period
- ping token success, invalid token, and token secrecy
- new/up/late/down/paused transitions and recovery
- one-minute evaluator, bounded batches, and no catch-up replay
- Basic Auth and mutation origin checks
- Slack transition notifications and retry behavior
- dashboard creation, ping URL copy, pause/resume, polling, and errors
- clean-account deployment, D1 migration, secret binding, and Cron Trigger

Required commands:

```bash
npm ci
npm test
npm run build
```

## 11. Roadmap

1. `/start` and `/fail` signals
2. Exit-code-aware wrapper and execution-time measurement
3. Optional stdout/stderr attachment
4. Event history and retention
5. Generic Webhook and additional notification channels

The MVP and current roadmap require each monitored job to be configured explicitly with its generated ping URL.
