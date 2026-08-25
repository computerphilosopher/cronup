# CronUp

CronUp is a private cron dead-man switch deployed to your own Cloudflare account. It is a focused heartbeat monitor: create a check, call its ping URL after a successful job, and receive an alert when the expected ping is late.

## Deploy

Use the Deploy to Cloudflare flow for the repository. Provision the D1 database, apply the migration, and set:

- `ADMIN_SECRET`: password for the `admin` Basic Auth user
- `SLACK_WEBHOOK_URL`: optional Slack Incoming Webhook

The Worker, D1 state, and scheduled evaluator live in your Cloudflare account. No monitoring VPS, host agent, Prometheus server, or external database is required.

## Add a cron check

Open the dashboard with Basic Auth, create a period or cron check, and copy its generated ping URL into the job. Send the ping only after the job succeeds:

```cron
0 2 * * * /usr/local/bin/backup.sh && curl -fsS https://your-worker.example.com/ping/<token>
```

If the command fails or the machine does not run the job, CronUp receives no success ping and evaluates the check as late/down after its grace period.

The first release intentionally keeps the protocol small. Start/fail signals, exit-code wrappers, execution timing, log attachment, history, and additional notification channels are roadmap items.

## Local development

```bash
npm ci
npm test
npm run build
npm run dev
```
