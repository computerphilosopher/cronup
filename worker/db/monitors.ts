import type { MonitorDto, MonitorStatus } from "../../shared/domain";

type MonitorRow = {
  id: string;
  name: string;
  url: string;
  status: MonitorStatus;
  last_checked_at: number | null;
  last_status_code: number | null;
  last_latency_ms: number | null;
  created_at: number;
  updated_at: number;
};

export type MonitorResultUpdate = {
  status: Exclude<MonitorStatus, "pending">;
  checkedAt: number;
  statusCode: number | null;
  latencyMs: number | null;
};

const SELECT_MONITOR_COLUMNS = `
  id,
  name,
  url,
  status,
  last_checked_at,
  last_status_code,
  last_latency_ms,
  created_at,
  updated_at
`;

function toMonitorDto(row: MonitorRow): MonitorDto {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    status: row.status,
    lastCheckedAt: row.last_checked_at,
    statusCode: row.last_status_code,
    latencyMs: row.last_latency_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createMonitor(
  db: D1Database,
  monitor: MonitorDto,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO monitors (
        id,
        name,
        url,
        status,
        last_checked_at,
        last_status_code,
        last_latency_ms,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      monitor.id,
      monitor.name,
      monitor.url,
      monitor.status,
      monitor.lastCheckedAt,
      monitor.statusCode,
      monitor.latencyMs,
      monitor.createdAt,
      monitor.updatedAt,
    )
    .run();
}

export async function listMonitors(db: D1Database): Promise<MonitorDto[]> {
  const result = await db
    .prepare(
      `SELECT ${SELECT_MONITOR_COLUMNS}
       FROM monitors
       ORDER BY created_at ASC, id ASC`,
    )
    .all<MonitorRow>();

  return result.results.map(toMonitorDto);
}

export async function deleteMonitor(
  db: D1Database,
  id: string,
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM monitors WHERE id = ?")
    .bind(id)
    .run();

  return result.meta.changes > 0;
}

export async function selectDueMonitors(
  db: D1Database,
  limit = 20,
): Promise<MonitorDto[]> {
  const result = await db
    .prepare(
      `SELECT ${SELECT_MONITOR_COLUMNS}
       FROM monitors
       ORDER BY
         last_checked_at IS NOT NULL ASC,
         last_checked_at ASC,
         created_at ASC,
         id ASC
       LIMIT ?`,
    )
    .bind(limit)
    .all<MonitorRow>();

  return result.results.map(toMonitorDto);
}

export async function updateMonitorResult(
  db: D1Database,
  id: string,
  update: MonitorResultUpdate,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE monitors
       SET
         status = ?,
         last_checked_at = ?,
         last_status_code = ?,
         last_latency_ms = ?,
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      update.status,
      update.checkedAt,
      update.statusCode,
      update.latencyMs,
      update.checkedAt,
      id,
    )
    .run();

  return result.meta.changes > 0;
}
