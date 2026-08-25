export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_SECRET?: string;
  SLACK_WEBHOOK_URL?: string;
}
