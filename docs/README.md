# CronUp Documentation

## Current product

- [README](../README.md): deployment, setup, and cron usage
- [MVP specification](specs/cronup-alpha.md): canonical product and API contract
- [Local secret locations](ops/local-secrets.md): development credential locations (values excluded)
- [BYOC cron implementation plan](superpowers/plans/2026-08-26-byoc-cron-deadman-switch.md): implementation record

CronUp is a Cloudflare-native cron heartbeat monitor. It is a focused subset of the Healthchecks-style dead-man switch model, deployed into the customer's own Cloudflare account. The current product does not probe public URLs or inspect server cron configuration.

## Historical records

Documents dated before 2026-08-26 describe earlier scaffold, uptime-only, authentication, or Slack/deployment decisions. They are retained for repository history and are not current requirements. When they conflict with the MVP specification, the MVP specification wins.
