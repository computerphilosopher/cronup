import type { CheckDto, CheckStatus, Schedule } from "../../shared/domain";

type CheckRow = {
  id: string;
  name: string;
  ping_token: string;
  schedule_json: string;
  grace_seconds: number;
  status: CheckStatus;
  last_ping_at: number | null;
  created_at: number;
  updated_at: number;
};

const columns = "id, name, ping_token, schedule_json, grace_seconds, status, last_ping_at, created_at, updated_at";

function dto(row: CheckRow): CheckDto {
  return {
    id: row.id,
    name: row.name,
    pingToken: row.ping_token,
    schedule: JSON.parse(row.schedule_json) as Schedule,
    graceSeconds: row.grace_seconds,
    status: row.status,
    lastPingAt: row.last_ping_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createMonitor(db: D1Database, check: CheckDto): Promise<void> {
  await db.prepare(`INSERT INTO checks (id, name, ping_token, schedule_json, grace_seconds, status, last_ping_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(check.id, check.name, check.pingToken, JSON.stringify(check.schedule), check.graceSeconds, check.status, check.lastPingAt, check.createdAt, check.updatedAt).run();
}

export async function listMonitors(db: D1Database): Promise<CheckDto[]> {
  const result = await db.prepare(`SELECT ${columns} FROM checks ORDER BY created_at ASC, id ASC`).all<CheckRow>();
  return result.results.map(dto);
}

export async function getMonitorByToken(db: D1Database, token: string): Promise<CheckDto | null> {
  const row = await db.prepare(`SELECT ${columns} FROM checks WHERE ping_token = ?`).bind(token).first<CheckRow>();
  return row ? dto(row) : null;
}

export async function deleteMonitor(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM checks WHERE id = ?").bind(id).run();
  return result.meta.changes > 0;
}

export async function updatePing(db: D1Database, id: string, at: number): Promise<CheckDto | null> {
  await db.prepare("UPDATE checks SET status = CASE WHEN status IN ('late', 'down') THEN 'up' ELSE 'up' END, last_ping_at = ?, updated_at = ? WHERE id = ?")
    .bind(at, at, id).run();
  const row = await db.prepare(`SELECT ${columns} FROM checks WHERE id = ?`).bind(id).first<CheckRow>();
  return row ? dto(row) : null;
}

export async function updateStatus(db: D1Database, id: string, status: CheckStatus, at: number): Promise<boolean> {
  const result = await db.prepare("UPDATE checks SET status = ?, updated_at = ? WHERE id = ?").bind(status, at, id).run();
  return result.meta.changes > 0;
}

export async function setPaused(db: D1Database, id: string, paused: boolean, at: number): Promise<boolean> {
  return updateStatus(db, id, paused ? "paused" : "new", at);
}

export async function selectMonitors(db: D1Database, limit = 100): Promise<CheckDto[]> {
  const result = await db.prepare(`SELECT ${columns} FROM checks WHERE status != 'paused' ORDER BY created_at ASC, id ASC LIMIT ?`).bind(limit).all<CheckRow>();
  return result.results.map(dto);
}
