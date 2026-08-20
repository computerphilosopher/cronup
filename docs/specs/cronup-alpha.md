# CronUp Alpha Design

## 1. Product summary

CronUp is an AGPL-licensed, bring-your-own-Cloudflare monitoring application for broke developers. It combines two core capabilities:

- HTTP(S) uptime monitoring
- Dead-man monitoring for cron and background jobs

The alpha validates only two questions: whether a website is currently responding successfully, and whether a scheduled job sent its heartbeat before its deadline. It is not a public multi-tenant SaaS and does not promise retry, delivery, capacity, or scheduling guarantees.

The positioning is:

> Uptime Kuma + Cronitor, but serverless and almost free.

## 2. Alpha stack

The product stack is intentionally limited to five technologies:

1. **TypeScript** for both the browser and Worker code
2. **Cloudflare Workers** for the API, heartbeat ingestion, and scheduled checks
3. **Hono** for HTTP routing
4. **Cloudflare D1 with raw SQL** for persistence
5. **React with Vite** for a single-screen administration dashboard

Cloudflare Cron Triggers and Static Assets are platform features rather than separate services. Wrangler is the required development and deployment CLI, and npm is the package manager.

Runtime dependencies are limited to `hono`, `react`, and `react-dom`. The alpha does not use an ORM, Zod, React Router, TanStack Query, Tailwind, Queue, Durable Objects, KV, R2, Redis, or an external database.

The application is deployed as one Worker. Its entrypoint exposes `fetch()` and `scheduled()`, while schedule calculation and status transitions remain small, pure TypeScript functions. This retains a thin foundation for later versions without introducing repository, queue, or notification abstractions prematurely.

Cloudflare's official Vite plugin provides the local Workers runtime and builds the React assets for deployment. See the [React and Vite guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/) and [Vite plugin documentation](https://developers.cloudflare.com/workers/vite-plugin/).

## 3. Runtime behavior

### 3.1 Shared monitor model

```ts
type MonitorType = "uptime" | "job";

type MonitorStatus =
  | "pending"
  | "healthy"
  | "down"
  | "missed";

type UptimeConfig = {
  url: string;
};

type JobConfig = {
  periodMinutes: number;
  graceMinutes: number;
};
```

All times are stored as UTC epoch milliseconds. External input is checked with small manual validation functions rather than a validation library.

### 3.2 Uptime monitors

- Accept only public HTTP(S) URLs.
- Send one `GET` request on each one-minute Cron tick. The HTTP method and interval are not configurable.
- Use a fixed 10-second timeout and follow redirects.
- Treat a final status code from 200 through 399 as healthy.
- Treat a status outside that range, timeout, DNS error, or network error as down.
- Perform exactly one request per scheduled check. The alpha does not retry or confirm failures.
- Process at most 20 uptime monitors per minute with outbound concurrency limited to five, selecting the least recently checked monitors first.
- Defer overflow to a later tick without changing its status.
- Leave monitor status unchanged when CronUp itself encounters an internal error.

The scheduler records the latest check time and does not replay missed historical ticks after a delayed Cron Trigger.

### 3.3 Job monitors

Each job monitor exposes one heartbeat URL:

```text
GET /ping/:token
```

- A valid ping records a heartbeat, sets the monitor to healthy, and sets the next deadline to `received_at + period + grace`.
- Passing the deadline changes the monitor to missed.
- A monitor that remains missed does not create duplicate missed events on every tick.
- Unknown tokens return no monitor information and do not update state.
- The alpha has no `start`, `success`, `fail`, exit-code, duration, or maximum-runtime signals.

The raw token is 256 random bits encoded for URLs. D1 stores only its SHA-256 hash. Job-monitor creation returns the complete heartbeat URL once. Losing the token requires deleting and recreating the monitor.

### 3.4 State changes and notifications

There is no incident entity in the alpha. The monitor row holds the current state, while the event table keeps seven days of raw observations.

Notification rules are:

- `pending -> healthy`: no notification
- `pending|healthy -> down|missed`: failure notification
- `down|missed -> healthy`: recovery notification
- unchanged state: no notification
- delete: no notification

An optional `WEBHOOK_URL` Worker secret configures one global Generic Webhook destination. When the secret is absent, notifications are disabled. A state change sends the JSON payload below with a five-second timeout. A failed webhook is logged and does not roll back the monitor state. There is no provider-specific formatting, delivery log, or retry.

The generic payload is:

```ts
type WebhookPayload = {
  event: "monitor.down" | "monitor.missed" | "monitor.recovered";
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
```

## 4. Persistence

Raw SQL migrations create only two tables.

### `monitors`

Stores the monitor ID, type, name, status, JSON configuration, optional ping-token hash, optional job deadline, last check or heartbeat time, and created/updated times.

### `events`

Stores the monitor ID, event kind, outcome, observation time, and optional HTTP status code and latency. Event kinds are limited to uptime checks, received heartbeats, and first missed-heartbeat transitions.

Required indexes cover uptime last-check ordering, job-deadline lookup, ping-token lookup, monitor history ordered by time, and retention cleanup. The scheduled handler removes events older than seven days in bounded batches. No hourly or daily rollups are produced.

D1 access uses prepared raw SQL and small query functions. A status update and its event insert are submitted together using D1 batch semantics.

## 5. Authentication and API

### 5.1 Administrator authentication

The deployment owner supplies a high-entropy `ADMIN_SECRET` as a Worker secret. There is no user table, login API, or application session.

- The administration dashboard and all `/api/*` routes require HTTP Basic Authentication.
- `/demo` and static front-end assets are public. The demo never calls the protected API or reads D1.
- The fixed username is `admin`; the password is `ADMIN_SECRET`.
- Failed authentication returns `401` with `WWW-Authenticate: Basic realm="CronUp"`.
- Mutating API requests require JSON where applicable and a same-origin `Origin` header.
- Rotating `ADMIN_SECRET` changes the Basic Auth password immediately.
- `/ping/:token` remains public and is authenticated by the monitor token.

### 5.2 API surface

```text
GET    /api/monitors
POST   /api/monitors
DELETE /api/monitors/:id
GET    /api/monitors/:id/events

GET    /ping/:token
```

Monitor creation uses a discriminated JSON body containing `type`, `name`, and the matching uptime or job configuration. Status is server-controlled and cannot be written through the API. Monitor configuration is immutable in the alpha; changing it requires deleting and recreating the monitor. Deleting a monitor cascades to its events.

Errors use a consistent shape:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Human-readable explanation"
  }
}
```

## 6. User interface

The React application has no client-side router and uses the browser `fetch` API with `useState` and `useEffect`.

The authenticated administration screen contains:

- Healthy, down, missed, and pending counts
- Uptime and job monitor lists
- Monitor creation forms
- Monitor deletion
- Recent event details for the selected monitor

The administration dashboard polls every 30 seconds. It uses one plain CSS file, no component framework, no chart library, and no public status page.

The public `/demo` route renders the same React components with static fixture monitors and events compiled into the front-end bundle. It does not call `/api/*`, read D1, or contain real target URLs, heartbeat tokens, or webhook values. Mutation controls are hidden. The demo is a product preview, not a live public status page.

## 7. Deployment

The root `wrangler.jsonc` defines:

- One Worker entrypoint
- One D1 binding named `DB`
- One `* * * * *` Cron Trigger
- Static Assets configured for SPA fallback, with the Worker running first so it can protect the administration entry route
- A current, pinned Workers compatibility date

The documented first deployment flow is:

1. Install packages and authenticate Wrangler.
2. Provision the D1 binding through Wrangler automatic provisioning.
3. Apply remote SQL migrations.
4. Add the required `ADMIN_SECRET` and optional `WEBHOOK_URL` with `wrangler secret put`.
5. Build and deploy the Worker.

Because automatic resource provisioning is currently Beta, the README includes `wrangler d1 create` as a fallback. See [Wrangler automatic provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/).

The standard commands are `npm run dev`, `npm test`, `npm run build`, `npm run preview`, and `npm run deploy`. A Deploy to Cloudflare button is deferred until the alpha deployment flow is stable.

## 8. Verification

Automated tests cover only the product-critical paths:

- Uptime least-recently-checked selection, 20-monitor cap, and no replay of old ticks
- Job deadline and grace calculation
- Every allowed status transition and notification decision
- Basic Auth acceptance and protected dashboard/API rejection
- Public `/demo` access without credentials and fixture-only rendering
- Monitor creation, listing, deletion, and token-hash lookup
- Heartbeat persistence before returning success
- Uptime success, HTTP failure, timeout, and the absence of retry
- First missed-job transition without duplicate events
- Missing `WEBHOOK_URL` disabling notifications, and webhook failure not rolling back monitor state
- Seven-day event cleanup

Completion requires:

```text
npm test
npm run build
```

It also requires a local scheduled-handler smoke test and a clean-account deployment smoke test covering D1 provisioning, migration, secret configuration, and deployment.

## 9. Explicit alpha boundaries

- BYO Cloudflare only; no central hosted SaaS
- One administrator and at most one Generic Webhook destination configured through `WEBHOOK_URL`
- Cloudflare Free is supported on a best-effort basis with no capacity or timing SLA
- No guaranteed retry, delivery ordering, catch-up, or multi-region execution
- No incident history, long-term rollups, or live public status pages; `/demo` uses static fixtures only
- No authenticated targets, custom request bodies, response assertions, TCP, ICMP, or browser checks
- No Docker, VPS, Postgres, or non-Cloudflare deployment

Cloudflare Cron Triggers run at a minimum one-minute cadence but do not provide a fixed probe region. Platform limits and pricing must be rechecked before a later release. See [Cron Trigger documentation](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), and [D1 pricing and limits](https://developers.cloudflare.com/d1/platform/pricing/).

## 10. Roadmap after alpha

1. Cloudflare Queues, DLQ, persistent notification outbox, and guaranteed retries
2. Incident lifecycle and long-term uptime rollups
3. Job `start`, `success`, `fail`, duration, and maximum-runtime signals
4. Multiple users, teams, roles, and formal authentication
5. Public status pages, multiple notification destinations, provider-specific adapters, and email
6. Multi-region probes and richer HTTP assertions
7. Portable Docker/Postgres deployment if demand justifies the additional adapter layer

## 11. License

The repository will use `AGPL-3.0-only` unless the license policy is revised before the first public release.
