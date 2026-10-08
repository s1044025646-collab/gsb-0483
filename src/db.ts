import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { RULE_VERSION } from "./cards.js";
import type { ScoreEvidence, ScoreInput, ScoreResult } from "./types.js";

export interface StoredReport extends ScoreResult {
  id: string;
  version: number;
  createdAt: string;
}

let dbInstance: DatabaseSync | null = null;

export function openDb(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);
  dbInstance = db;
  return db;
}

export function getDb(): DatabaseSync {
  if (!dbInstance) throw new Error("数据库尚未初始化");
  return dbInstance;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      hand TEXT NOT NULL,
      start TEXT NOT NULL,
      mode TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      rule_version TEXT NOT NULL,
      current_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS versions (
      case_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      input_hash TEXT NOT NULL,
      rule_version TEXT NOT NULL,
      total INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (case_id, version)
    );
    CREATE TABLE IF NOT EXISTS evidence (
      case_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      category TEXT NOT NULL,
      points INTEGER NOT NULL,
      ranks TEXT,
      cards TEXT NOT NULL,
      roles TEXT NOT NULL,
      detail TEXT NOT NULL,
      PRIMARY KEY (case_id, version, seq)
    );
  `);
}

export function inputHash(input: ScoreInput): string {
  const canonical = JSON.stringify({
    hand: [...input.hand].map((c) => c.toUpperCase()).sort(),
    start: input.start.toUpperCase(),
    mode: input.mode,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

interface CaseRow {
  hand: string;
  start: string;
  mode: "hand" | "crib";
  input_hash: string;
  current_version: number;
}

/**
 * 幂等保存：同 id 且输入内容一致（与排列无关）返回冻结的既有版本；
 * 同 id 但牌例被修改则新建版本；新 id 创建第 1 版。
 */
export function saveResult(id: string, input: ScoreInput, result: ScoreResult): StoredReport {
  const db = getDb();
  const hash = inputHash(input);
  const now = new Date().toISOString();

  const existing = db
    .prepare("SELECT * FROM cases WHERE id = ?")
    .get(id) as CaseRow | undefined;

  let version: number;
  if (existing) {
    if (existing.input_hash === hash) {
      version = existing.current_version;
    } else {
      version = existing.current_version + 1;
      db.prepare(
        `INSERT INTO versions (case_id, version, input_hash, rule_version, total, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, version, hash, RULE_VERSION, result.total, now);
      insertEvidence(db, id, version, result.evidence);
      db.prepare("UPDATE cases SET hand=?, start=?, mode=?, input_hash=?, current_version=?, updated_at=? WHERE id=?")
        .run(JSON.stringify(result.hand), result.start, result.mode, hash, version, now, id);
    }
  } else {
    version = 1;
    db.prepare(
      `INSERT INTO cases (id, hand, start, mode, input_hash, rule_version, current_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, JSON.stringify(result.hand), result.start, result.mode, hash, RULE_VERSION, version, now, now);
    db.prepare(
      `INSERT INTO versions (case_id, version, input_hash, rule_version, total, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, version, hash, RULE_VERSION, result.total, now);
    insertEvidence(db, id, version, result.evidence);
  }

  const report = loadReport(id, version);
  if (!report) throw new Error("保存后读取失败");
  return report;
}

function insertEvidence(
  db: DatabaseSync,
  caseId: string,
  version: number,
  evidence: ScoreEvidence[],
): void {
  const stmt = db.prepare(
    `INSERT INTO evidence (case_id, version, seq, category, points, ranks, cards, roles, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  evidence.forEach((e, seq) => {
    stmt.run(
      caseId,
      version,
      seq,
      e.category,
      e.points,
      e.ranks ? JSON.stringify(e.ranks) : null,
      JSON.stringify(e.cards),
      JSON.stringify(e.roles),
      e.detail,
    );
  });
}

interface EvidenceRow {
  seq: number;
  category: ScoreEvidence["category"];
  points: number;
  ranks: string | null;
  cards: string;
  roles: string;
  detail: string;
}

export function loadReport(id: string, version?: number): StoredReport | null {
  const db = getDb();
  const caseRow = db.prepare("SELECT * FROM cases WHERE id = ?").get(id) as
    | (CaseRow & { rule_version: string; created_at: string })
    | undefined;
  if (!caseRow) return null;
  const ver = version ?? caseRow.current_version;
  const verRow = db
    .prepare("SELECT * FROM versions WHERE case_id = ? AND version = ?")
    .get(id, ver) as { total: number; created_at: string } | undefined;
  if (!verRow) return null;

  const rows = db
    .prepare("SELECT * FROM evidence WHERE case_id = ? AND version = ? ORDER BY seq")
    .all(id, ver) as EvidenceRow[];

  const evidence: ScoreEvidence[] = rows.map((r) => ({
    category: r.category,
    points: r.points,
    ranks: r.ranks ? (JSON.parse(r.ranks) as number[]) : undefined,
    cards: JSON.parse(r.cards) as string[],
    roles: JSON.parse(r.roles) as ScoreEvidence["roles"],
    detail: r.detail,
  }));

  const labels: Record<string, string> = {
    fifteens: "十五",
    pairs: "对子",
    runs: "顺子",
    flush: "同花",
    nobs: "nobs（与起始牌同花的 J）",
  };
  const order = ["fifteens", "pairs", "runs", "flush", "nobs"];
  const categoryTotals = order.map((category) => {
    const items = evidence.filter((e) => e.category === category);
    return {
      category: category as ScoreEvidence["category"],
      label: labels[category],
      count: items.length,
      points: items.reduce((s, e) => s + e.points, 0),
    };
  });

  return {
    id,
    version: ver,
    createdAt: verRow.created_at,
    hand: JSON.parse(caseRow.hand) as string[],
    start: caseRow.start,
    mode: caseRow.mode,
    ruleVersion: caseRow.rule_version,
    total: verRow.total,
    categoryTotals,
    evidence,
  };
}

export function listCases(): Array<{ id: string; version: number; total: number; mode: string }> {
  const db = getDb();
  return db
    .prepare(
      `SELECT c.id AS id, c.current_version AS version, v.total AS total, c.mode AS mode
       FROM cases c JOIN versions v ON v.case_id = c.id AND v.version = c.current_version
       ORDER BY c.created_at`,
    )
    .all() as Array<{ id: string; version: number; total: number; mode: string }>;
}
