import { Hono } from "hono";
import type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (context) => context.json({ status: "ok" }));
app.get("/", (context) => context.env.ASSETS.fetch(context.req.raw));

export default {
  fetch: app.fetch,
  scheduled() {},
} satisfies ExportedHandler<Env>;
