import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Lang } from './language.js';
import type { Decision, Lead } from './types.js';

export type ScanOutcome =
  | 'ok'
  | 'partial' // some requests failed, others succeeded
  | 'auth_error'
  | 'permission_denied'
  | 'rate_limited'
  | 'provider_error'
  | 'cooldown'; // search skipped because of an earlier rate limit

export interface ScanRun {
  id: number;
  startedAt: number;
  finishedAt: number | null;
  outcome: ScanOutcome | null;
  requests: number;
  fetched: number;
  newLeads: number;
  delivered: number;
  deliveryFailed: number;
  providerError: string | null;
  deliveryError: string | null;
}

export interface NewLead {
  postId: string;
  username: string;
  text: string;
  permalink: string;
  publishedAt: number;
  language: Lang;
  reason: string;
  reply: string;
  searchTerm: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  post_id             TEXT PRIMARY KEY,
  username            TEXT NOT NULL,
  text                TEXT NOT NULL,
  permalink           TEXT NOT NULL,
  published_at        INTEGER NOT NULL,
  language            TEXT NOT NULL,
  reason              TEXT NOT NULL,
  reply               TEXT NOT NULL,
  search_term         TEXT NOT NULL,
  found_at            INTEGER NOT NULL,
  delivery_status     TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending','sent')),
  delivery_attempts   INTEGER NOT NULL DEFAULT 0,
  last_delivery_error TEXT,
  telegram_message_id INTEGER,
  delivered_at        INTEGER,
  decision            TEXT CHECK (decision IN ('replied','skipped')),
  decided_at          INTEGER
);
CREATE INDEX IF NOT EXISTS leads_pending ON leads (delivery_status, published_at);

CREATE TABLE IF NOT EXISTS scan_runs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at       INTEGER NOT NULL,
  finished_at      INTEGER,
  outcome          TEXT,
  requests         INTEGER NOT NULL DEFAULT 0,
  fetched          INTEGER NOT NULL DEFAULT 0,
  new_leads        INTEGER NOT NULL DEFAULT 0,
  delivered        INTEGER NOT NULL DEFAULT 0,
  delivery_failed  INTEGER NOT NULL DEFAULT 0,
  provider_error   TEXT,
  delivery_error   TEXT
);

CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

interface LeadRow {
  post_id: string; username: string; text: string; permalink: string; published_at: number;
  language: string; reason: string; reply: string; search_term: string; found_at: number;
  delivery_status: string; delivery_attempts: number; last_delivery_error: string | null;
  telegram_message_id: number | null; delivered_at: number | null; decision: string | null; decided_at: number | null;
}

interface ScanRow {
  id: number; started_at: number; finished_at: number | null; outcome: string | null; requests: number;
  fetched: number; new_leads: number; delivered: number; delivery_failed: number;
  provider_error: string | null; delivery_error: string | null;
}

const toLead = (r: LeadRow): Lead => ({
  postId: r.post_id,
  username: r.username,
  text: r.text,
  permalink: r.permalink,
  publishedAt: r.published_at,
  language: r.language as Lang,
  reason: r.reason,
  reply: r.reply,
  searchTerm: r.search_term,
  foundAt: r.found_at,
  deliveryStatus: r.delivery_status as Lead['deliveryStatus'],
  deliveryAttempts: r.delivery_attempts,
  lastDeliveryError: r.last_delivery_error,
  telegramMessageId: r.telegram_message_id,
  deliveredAt: r.delivered_at,
  decision: r.decision as Decision | null,
  decidedAt: r.decided_at,
});

const toScan = (r: ScanRow): ScanRun => ({
  id: r.id,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  outcome: r.outcome as ScanOutcome | null,
  requests: r.requests,
  fetched: r.fetched,
  newLeads: r.new_leads,
  delivered: r.delivered,
  deliveryFailed: r.delivery_failed,
  providerError: r.provider_error,
  deliveryError: r.delivery_error,
});

export class Store {
  private readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  hasLead(postId: string): boolean {
    return this.db.prepare('SELECT 1 FROM leads WHERE post_id = ?').get(postId) !== undefined;
  }

  /** Inserts a lead once; returns false if this post ID is already known. */
  insertLead(lead: NewLead, now: number): boolean {
    const res = this.db.prepare(`
      INSERT OR IGNORE INTO leads (post_id, username, text, permalink, published_at, language, reason, reply, search_term, found_at)
      VALUES (@postId, @username, @text, @permalink, @publishedAt, @language, @reason, @reply, @searchTerm, @foundAt)
    `).run({ ...lead, foundAt: now });
    return res.changes === 1;
  }

  getLead(postId: string): Lead | null {
    const row = this.db.prepare('SELECT * FROM leads WHERE post_id = ?').get(postId) as LeadRow | undefined;
    return row ? toLead(row) : null;
  }

  pendingDeliveries(limit: number): Lead[] {
    const rows = this.db.prepare(
      "SELECT * FROM leads WHERE delivery_status = 'pending' ORDER BY published_at ASC LIMIT ?",
    ).all(limit) as LeadRow[];
    return rows.map(toLead);
  }

  /** Call only after Telegram acknowledged the message. */
  markDelivered(postId: string, messageId: number, now: number): void {
    this.db.prepare(`
      UPDATE leads SET delivery_status = 'sent', telegram_message_id = ?, delivered_at = ?,
        delivery_attempts = delivery_attempts + 1, last_delivery_error = NULL
      WHERE post_id = ?
    `).run(messageId, now, postId);
  }

  /** The lead stays 'pending' and will be retried on the next scan. */
  markDeliveryFailed(postId: string, error: string): void {
    this.db.prepare(`
      UPDATE leads SET delivery_attempts = delivery_attempts + 1, last_delivery_error = ?
      WHERE post_id = ? AND delivery_status = 'pending'
    `).run(error.slice(0, 300), postId);
  }

  /**
   * Records the owner's decision. Returns 'unchanged' when the same decision
   * is already stored, so repeated taps are harmless.
   */
  setDecision(postId: string, decision: Decision, now: number): 'updated' | 'unchanged' | 'not_found' {
    const lead = this.getLead(postId);
    if (!lead) return 'not_found';
    if (lead.decision === decision) return 'unchanged';
    this.db.prepare('UPDATE leads SET decision = ?, decided_at = ? WHERE post_id = ?').run(decision, now, postId);
    return 'updated';
  }

  startScan(now: number): number {
    return Number(this.db.prepare('INSERT INTO scan_runs (started_at) VALUES (?)').run(now).lastInsertRowid);
  }

  finishScan(id: number, now: number, r: Omit<ScanRun, 'id' | 'startedAt' | 'finishedAt'>): void {
    this.db.prepare(`
      UPDATE scan_runs SET finished_at = @now, outcome = @outcome, requests = @requests, fetched = @fetched,
        new_leads = @newLeads, delivered = @delivered, delivery_failed = @deliveryFailed,
        provider_error = @providerError, delivery_error = @deliveryError
      WHERE id = @id
    `).run({ ...r, id, now });
  }

  lastScan(): ScanRun | null {
    const row = this.db.prepare('SELECT * FROM scan_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1').get() as ScanRow | undefined;
    return row ? toScan(row) : null;
  }

  lastSuccessfulScan(): ScanRun | null {
    const row = this.db.prepare(
      "SELECT * FROM scan_runs WHERE outcome IN ('ok','partial') ORDER BY id DESC LIMIT 1",
    ).get() as ScanRow | undefined;
    return row ? toScan(row) : null;
  }

  stats(since: number): { total: number; recent: number; pending: number; replied: number; skipped: number } {
    return this.db.prepare(`
      SELECT COUNT(*) AS total,
        COALESCE(SUM(found_at >= @since), 0) AS recent,
        COALESCE(SUM(delivery_status = 'pending'), 0) AS pending,
        COALESCE(SUM(decision = 'replied'), 0) AS replied,
        COALESCE(SUM(decision = 'skipped'), 0) AS skipped
      FROM leads
    `).get({ since }) as { total: number; recent: number; pending: number; replied: number; skipped: number };
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string | null): void {
    if (value === null) this.db.prepare('DELETE FROM kv WHERE key = ?').run(key);
    else this.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  /** Data minimisation: drop delivered leads older than the retention window and old scan logs. */
  prune(olderThan: number): void {
    this.db.prepare("DELETE FROM leads WHERE found_at < ? AND delivery_status = 'sent'").run(olderThan);
    this.db.prepare('DELETE FROM scan_runs WHERE id <= (SELECT MAX(id) - 500 FROM scan_runs)').run();
  }
}
