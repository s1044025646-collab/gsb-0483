import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ScoreResult } from './scoring.js';

export interface StoredReport {
  id: number;
  requestHash: string;
  mode: string;
  ruleVersion: string;
  hand: string[];
  starter: string;
  total: number;
  createdAt: string;
  result: ScoreResult;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath?: string) {
    const file = dbPath ?? path.join(process.cwd(), 'data', 'cribbage.db');
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_hash TEXT NOT NULL,
        mode TEXT NOT NULL,
        rule_version TEXT NOT NULL,
        hand_json TEXT NOT NULL,
        starter TEXT NOT NULL,
        total INTEGER NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (request_hash, rule_version)
      );
      CREATE TABLE IF NOT EXISTS evidence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id INTEGER NOT NULL REFERENCES reports(id),
        category TEXT NOT NULL,
        points INTEGER NOT NULL,
        cards_json TEXT NOT NULL,
        detail TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_evidence_report ON evidence(report_id);
    `);
  }

  static hashOf(hand: string[], starter: string, mode: string): string {
    const key = JSON.stringify({ hand: [...hand].sort(), starter, mode });
    return createHash('sha256').update(key).digest('hex');
  }

  /** 幂等保存：相同请求+规则版本直接返回已有报告 */
  save(result: ScoreResult): { report: StoredReport; created: boolean } {
    const hash = Store.hashOf(result.hand, result.starter, result.mode);
    const existing = this.db
      .prepare('SELECT * FROM reports WHERE request_hash = ? AND rule_version = ?')
      .get(hash, result.ruleVersion) as any;
    if (existing) return { report: this.rowToReport(existing), created: false };

    const insert = this.db.prepare(
      'INSERT INTO reports (request_hash, mode, rule_version, hand_json, starter, total, result_json) VALUES (?,?,?,?,?,?,?)',
    );
    const info = insert.run(
      hash, result.mode, result.ruleVersion,
      JSON.stringify(result.hand), result.starter, result.total, JSON.stringify(result),
    );
    const reportId = Number(info.lastInsertRowid);
    const evStmt = this.db.prepare(
      'INSERT INTO evidence (report_id, category, points, cards_json, detail) VALUES (?,?,?,?,?)',
    );
    for (const e of result.evidence) {
      evStmt.run(reportId, e.category, e.points, JSON.stringify(e.cards), e.detail);
    }
    return { report: this.get(reportId)!, created: true };
  }

  get(id: number): StoredReport | null {
    const row = this.db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as any;
    return row ? this.rowToReport(row) : null;
  }

  list(limit = 50): StoredReport[] {
    const rows = this.db.prepare('SELECT * FROM reports ORDER BY id DESC LIMIT ?').all(limit) as any[];
    return rows.map((r) => this.rowToReport(r));
  }

  evidenceOf(reportId: number, category?: string) {
    const rows = (category
      ? this.db.prepare('SELECT * FROM evidence WHERE report_id = ? AND category = ? ORDER BY id').all(reportId, category)
      : this.db.prepare('SELECT * FROM evidence WHERE report_id = ? ORDER BY id').all(reportId)) as any[];
    return rows.map((r) => ({
      category: r.category as string,
      points: r.points as number,
      cards: JSON.parse(r.cards_json) as string[],
      detail: r.detail as string,
    }));
  }

  private rowToReport(row: any): StoredReport {
    return {
      id: row.id,
      requestHash: row.request_hash,
      mode: row.mode,
      ruleVersion: row.rule_version,
      hand: JSON.parse(row.hand_json),
      starter: row.starter,
      total: row.total,
      createdAt: row.created_at,
      result: JSON.parse(row.result_json),
    };
  }

  close(): void {
    this.db.close();
  }
}
