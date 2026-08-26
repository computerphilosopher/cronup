# Local secret locations

This file records where local development credentials are stored. It must never
contain the secret values themselves.

## CronUp development admin secret

- Secret name in Cloudflare: `ADMIN_SECRET`
- macOS Keychain: login keychain
- Keychain service: `cronup-dev-admin-secret`
- Keychain account: `cronup-dev`
- Cloudflare Worker: `cronup`

The Keychain item contains the same random value currently configured as the
Cloudflare Worker `ADMIN_SECRET`. Retrieve it from Keychain when needed; do not
copy the value into this repository, shell history, or chat.
