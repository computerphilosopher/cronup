import { Hono } from "hono";
import { isAuthorized, isJsonMutation, unauthorizedResponse } from "./auth";
import type { Env } from "./env";
import { jsonError } from "./errors";
import { checks } from "./routes/checks";
import { evaluateChecks, receivePing } from "./cron";
import { notifyTransitions, sendSlack } from "./notifications/slack";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (context, next) => {
  const pathname = new URL(context.req.raw.url).pathname;
  const isAdminRoute =
    pathname === "/" || pathname === "/api" || pathname.startsWith("/api/");

  if (!isAdminRoute) {
    await next();
    return;
  }

  if (!isAuthorized(context.req.raw, context.env.ADMIN_SECRET)) {
    return unauthorizedResponse();
  }

  if (pathname.startsWith("/api") && !isJsonMutation(context.req.raw)) {
    return jsonError(
      "invalid_request",
      "JSON content type and same-origin Origin are required",
      400,
    );
  }

  await next();
});

app.get("/api/health", (context) => context.json({ status: "ok" }));
app.route("/api/checks", checks);
app.post("/api/notifications/slack/test", async (context) => {
  const ok = await sendSlack(context.env.SLACK_WEBHOOK_URL, "CronUp test notification");
  return ok ? context.json({ ok: true }) : jsonError("notification_failed", "Slack notification failed", 502);
});
app.all("/ping/:token", async (context) => {
  const transition = await receivePing(context.env.DB, context.req.param("token"), Date.now());
  if (!transition && !(await context.env.DB.prepare("SELECT 1 FROM checks WHERE ping_token = ?").bind(context.req.param("token")).first())) {
    return jsonError("not_found", "Ping token not found", 404);
  }
  return context.text("OK");
});
app.get("/", (context) => context.env.ASSETS.fetch(context.req.raw));
app.notFound((context) => {
  const pathname = new URL(context.req.raw.url).pathname;
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return jsonError("not_found", "Not found", 404);
  }

  return context.text("Not found", 404);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller, env) {
    const transitions = await evaluateChecks(env.DB, Date.now());
    await notifyTransitions(env.SLACK_WEBHOOK_URL, transitions);
  },
} satisfies ExportedHandler<Env>;
