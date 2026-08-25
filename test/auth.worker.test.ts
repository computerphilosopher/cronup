import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  isAuthorized,
  isJsonMutation,
  unauthorizedResponse,
} from "../worker/auth";
import { jsonError } from "../worker/errors";
import worker from "../worker/index";
import type { Env } from "../worker/env";

function basic(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

describe("Basic Auth", () => {
  it("accepts the fixed admin username and configured secret", () => {
    const request = new Request("https://cronup.test/api/health", {
      headers: { Authorization: basic("admin", "correct-secret") },
    });

    expect(isAuthorized(request, "correct-secret")).toBe(true);
  });

  it.each([
    ["wrong username", basic("operator", "correct-secret"), "correct-secret"],
    ["wrong password", basic("admin", "wrong-secret"), "correct-secret"],
    ["malformed header", "Bearer token", "correct-secret"],
    ["missing secret", basic("admin", "correct-secret"), undefined],
    ["empty secret", basic("admin", "correct-secret"), ""],
  ])("rejects %s", (_case, authorization, secret) => {
    const request = new Request("https://cronup.test/api/health", {
      headers: { Authorization: authorization },
    });

    expect(isAuthorized(request, secret)).toBe(false);
  });

  it("returns a Basic Auth challenge for unauthorized requests", async () => {
    const response = unauthorizedResponse();

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      'Basic realm="CronUp"',
    );
    await expect(response.json()).resolves.toEqual({
      error: { code: "unauthorized", message: "Authentication required" },
    });
  });
});

describe("mutation request guards", () => {
  it("requires JSON and a same-origin Origin for mutations", () => {
    const request = new Request("https://cronup.test/api/monitors", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Origin: "https://cronup.test",
      },
    });

    expect(isJsonMutation(request)).toBe(true);
  });

  it.each([
    ["non-JSON content type", { Origin: "https://cronup.test" }],
    [
      "foreign origin",
      {
        "Content-Type": "application/json",
        Origin: "https://evil.test",
      },
    ],
    [
      "missing origin",
      { "Content-Type": "application/json" },
    ],
  ])("rejects %s", (_case, headers) => {
    const request = new Request("https://cronup.test/api/monitors", {
      method: "POST",
      headers,
    });

    expect(isJsonMutation(request)).toBe(false);
  });

  it("does not apply mutation checks to GET requests", () => {
    const request = new Request("https://cronup.test/api/monitors");

    expect(isJsonMutation(request)).toBe(true);
  });
});

describe("common JSON errors", () => {
  it("returns the shared API error shape", async () => {
    const response = jsonError("invalid_request", "Bad request", 400);

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_request", message: "Bad request" },
    });
  });
});

describe("protected Worker routes", () => {
  it("requires authentication for the admin page and API", async () => {
    const page = await exports.default.fetch("https://cronup.test/");
    const api = await exports.default.fetch("https://cronup.test/api/health");

    expect(page.status).toBe(401);
    expect(api.status).toBe(401);
    expect(page.headers.get("WWW-Authenticate")).toBe(
      'Basic realm="CronUp"',
    );
    await expect(api.json()).resolves.toEqual({
      error: { code: "unauthorized", message: "Authentication required" },
    });
  });

  it("serves the admin asset only after authentication", async () => {
    const response = await worker.fetch!(
      new Request("https://cronup.test/", {
        headers: { Authorization: basic("admin", "correct-secret") },
      }),
      {
        ADMIN_SECRET: "correct-secret",
        ASSETS: { fetch: async () => new Response("dashboard") },
      } as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("dashboard");
  });

  it("allows an authenticated API request and protects mutations", async () => {
    const env = { ADMIN_SECRET: "correct-secret" } as Env;
    const auth = { Authorization: basic("admin", "correct-secret") };
    const api = await worker.fetch!(
      new Request("https://cronup.test/api/health", { headers: auth }),
      env,
      {} as ExecutionContext,
    );
    const mutation = await worker.fetch!(
      new Request("https://cronup.test/api/health", {
        method: "POST",
        headers: auth,
      }),
      env,
      {} as ExecutionContext,
    );

    expect(api.status).toBe(200);
    await expect(api.json()).resolves.toEqual({ status: "ok" });
    expect(mutation.status).toBe(400);
    await expect(mutation.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "JSON content type and same-origin Origin are required",
      },
    });
  });

  it("uses the common JSON error shape for unknown API routes", async () => {
    const response = await worker.fetch!(
      new Request("https://cronup.test/api/missing", {
        headers: { Authorization: basic("admin", "correct-secret") },
      }),
      { ADMIN_SECRET: "correct-secret" } as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "not_found", message: "Not found" },
    });
  });
});
