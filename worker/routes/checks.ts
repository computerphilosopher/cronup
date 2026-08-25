import { Hono } from "hono";
import type { Env } from "../env";
import { jsonError } from "../errors";
import { createMonitor, deleteMonitor, listMonitors, setPaused } from "../db/monitors";
import { InvalidCheckRequest, parseCreateCheckRequest } from "../validation";

export const checks = new Hono<{ Bindings: Env }>();

checks.get("/", async (c) => c.json(await listMonitors(c.env.DB)));

checks.post("/", async (c) => {
  try {
    const input = parseCreateCheckRequest(await c.req.json());
    const now = Date.now();
    const check = {
      id: crypto.randomUUID(),
      name: input.name,
      pingToken: crypto.randomUUID().replaceAll("-", ""),
      schedule: input.schedule,
      graceSeconds: input.graceSeconds,
      status: "new" as const,
      lastPingAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await createMonitor(c.env.DB, check);
    return c.json(check, 201);
  } catch (error) {
    if (error instanceof InvalidCheckRequest) return jsonError(error.code, error.message, 400);
    return jsonError("internal_error", "Unable to create check", 500);
  }
});

checks.delete("/:id", async (c) => {
  const deleted = await deleteMonitor(c.env.DB, c.req.param("id"));
  return deleted ? c.body(null, 204) : jsonError("not_found", "Check not found", 404);
});

checks.post("/:id/pause", async (c) => {
  const changed = await setPaused(c.env.DB, c.req.param("id"), true, Date.now());
  return changed ? c.json({ ok: true }) : jsonError("not_found", "Check not found", 404);
});

checks.post("/:id/resume", async (c) => {
  const changed = await setPaused(c.env.DB, c.req.param("id"), false, Date.now());
  return changed ? c.json({ ok: true }) : jsonError("not_found", "Check not found", 404);
});
