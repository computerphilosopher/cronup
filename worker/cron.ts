import type { CheckDto, CheckStatus } from "../shared/domain";
import { getMonitorByToken, selectMonitors, updatePing, updateStatus } from "./db/monitors";

export type CheckTransition = { check: CheckDto; from: CheckStatus; to: CheckStatus };

function fieldMatches(field: string, value: number): boolean {
  return field.split(",").some((part) => {
    const [base, stepText] = part.split("/");
    const step = stepText ? Number(stepText) : 1;
    if (base === "*") return value % step === 0;
    return Number(base) === value || (stepText !== undefined && value % step === 0 && base === "*");
  });
}

function cronMatches(expression: string, date: Date, timezone: string): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    minute: "numeric",
    hour: "numeric",
    day: "numeric",
    month: "numeric",
    weekday: "short",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const [minute, hour, day, month, weekday] = expression.split(/\s+/);
  const weekdayNumber = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(values.weekday);
  return fieldMatches(minute, Number(values.minute)) && fieldMatches(hour, Number(values.hour) % 24) && fieldMatches(day, Number(values.day)) && fieldMatches(month, Number(values.month)) && fieldMatches(weekday, weekdayNumber);
}

function expectedAt(check: CheckDto, now: number): number {
  if (check.schedule.kind === "period") return (check.lastPingAt ?? check.createdAt) + check.schedule.periodSeconds * 1000;
  const start = Math.max(check.createdAt, now - 8 * 24 * 60 * 60 * 1000);
  for (let time = now - 60_000; time >= start; time -= 60_000) {
    if (cronMatches(check.schedule.expression, new Date(time), check.schedule.timezone) && (check.lastPingAt === null || time > check.lastPingAt)) return time;
  }
  return now + 60_000;
}

export function evaluateCheck(check: CheckDto, now: number): CheckStatus {
  if (check.status === "paused") return "paused";
  const dueAt = expectedAt(check, now);
  if (now < dueAt) return check.lastPingAt === null ? "new" : "up";
  if (now < dueAt + check.graceSeconds * 1000) return "late";
  return "down";
}

export async function receivePing(db: D1Database, token: string, at: number): Promise<CheckTransition | null> {
  const check = await getMonitorByToken(db, token);
  if (!check) return null;
  const from = check.status;
  const updated = await updatePing(db, check.id, at);
  return updated && from !== updated.status ? { check: updated, from, to: updated.status } : null;
}

export async function evaluateChecks(db: D1Database, now: number, limit = 100): Promise<CheckTransition[]> {
  const transitions: CheckTransition[] = [];
  for (const check of await selectMonitors(db, limit)) {
    const next = evaluateCheck(check, now);
    if (next !== check.status) {
      await updateStatus(db, check.id, next, now);
      transitions.push({ check: { ...check, status: next, updatedAt: now }, from: check.status, to: next });
    }
  }
  return transitions;
}
