import { Hono } from "hono";
import { isAuthorized, isJsonMutation, unauthorizedResponse } from "./auth";
import type { Env } from "./env";
import { jsonError } from "./errors";

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
  scheduled() {},
} satisfies ExportedHandler<Env>;
