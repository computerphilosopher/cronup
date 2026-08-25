import type { CreateCheckRequest, Schedule } from "../shared/domain";

export class InvalidCheckRequest extends Error {
  readonly code = "invalid_request" as const;

  constructor(message: string) {
    super(message);
    this.name = "InvalidCheckRequest";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validCron(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((field) => /^(\*|\d+)(\/\d+)?(,((\*|\d+)(\/\d+)?))*$/.test(field));
}

function parseSchedule(value: unknown): Schedule {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new InvalidCheckRequest("Schedule must be an object");
  }
  if (value.kind === "period") {
    if (typeof value.periodSeconds !== "number" || !Number.isInteger(value.periodSeconds) || value.periodSeconds < 60) {
      throw new InvalidCheckRequest("Period must be an integer of at least 60 seconds");
    }
    return { kind: "period", periodSeconds: value.periodSeconds };
  }
  if (value.kind === "cron") {
    if (typeof value.expression !== "string" || !validCron(value.expression)) {
      throw new InvalidCheckRequest("Cron expression must contain five valid fields");
    }
    if (typeof value.timezone !== "string" || !value.timezone || !value.timezone.includes("/")) {
      throw new InvalidCheckRequest("A timezone is required for cron schedules");
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value.timezone }).format();
    } catch {
      throw new InvalidCheckRequest("Timezone is invalid");
    }
    return { kind: "cron", expression: value.expression.trim(), timezone: value.timezone };
  }
  throw new InvalidCheckRequest("Schedule kind must be period or cron");
}

export function parseCreateCheckRequest(input: unknown): CreateCheckRequest {
  if (!isRecord(input)) throw new InvalidCheckRequest("Request body must be an object");
  const keys = Object.keys(input).sort();
  if (keys.join(",") !== "graceSeconds,name,schedule") {
    throw new InvalidCheckRequest("Request must contain only name, schedule, and graceSeconds");
  }
  if (typeof input.name !== "string") throw new InvalidCheckRequest("Name must be a string");
  const name = input.name.trim();
  if (name.length < 1 || name.length > 100) throw new InvalidCheckRequest("Name must be between 1 and 100 characters");
  if (typeof input.graceSeconds !== "number" || !Number.isInteger(input.graceSeconds) || input.graceSeconds < 0 || input.graceSeconds > 31536000) {
    throw new InvalidCheckRequest("Grace period must be an integer between 0 and 31536000 seconds");
  }
  return { name, schedule: parseSchedule(input.schedule), graceSeconds: input.graceSeconds };
}
