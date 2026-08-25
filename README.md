# CronUp

CronUp is a private cron dead-man switch deployed to your own Cloudflare account. It is a focused heartbeat monitor: create a check, call its ping URL after a successful job, and receive an alert when the expected ping is late.

## Deploy

Deploy this repository to your own Cloudflare account with Wrangler or a Deploy to Cloudflare flow. Provision the D1 database, bind it as `DB`, apply the migration, and set:

- `ADMIN_SECRET`: password for the `admin` Basic Auth user
- `SLACK_WEBHOOK_URL`: optional Slack Incoming Webhook

The Worker, D1 state, and scheduled evaluator live in your Cloudflare account. No monitoring VPS, host agent, Prometheus server, or external database is required.

The dashboard and admin API use HTTP Basic Auth with the fixed username `admin` and the `ADMIN_SECRET` value. The ping endpoint is intentionally public and is authenticated by its high-entropy check token.

For a manual Wrangler deployment:

```bash
npx wrangler d1 create cronup-db
# Add the returned database_id to wrangler.jsonc under the DB binding.
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put ADMIN_SECRET
npx wrangler secret put SLACK_WEBHOOK_URL # optional
npm run deploy
```

## Add a cron check

Open the dashboard with Basic Auth, create a period or cron check, and copy its generated ping URL into the job. Send the ping only after the job succeeds:

```cron
0 2 * * * /usr/local/bin/backup.sh && curl -fsS https://your-worker.example.com/ping/<token>
```

If the command fails or the machine does not run the job, CronUp receives no success ping and evaluates the check as late/down after its grace period.

The check can use a period or a five-field cron expression. CronUp stores current state only; it does not store a long-term event history in the MVP.

## API surface

Authenticated admin routes:

```text
GET    /api/checks
POST   /api/checks
DELETE /api/checks/:id
POST   /api/checks/:id/pause
POST   /api/checks/:id/resume
POST   /api/notifications/slack/test
```

Public job route:

```text
GET|POST /ping/:token
```

The MVP supports one administrator, one optional Slack webhook, no teams, no public status page, and no long-term event log.

The first release intentionally keeps the protocol small. Start/fail signals, exit-code wrappers, execution timing, log attachment, history, and additional notification channels are roadmap items.

## Local development

```bash
npm ci
npm test
npm run build
npm run dev
```
