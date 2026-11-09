import { detectLanguage } from './language.js';
import { matchPost } from './matcher.js';
import { suggestReply } from './replies.js';
import type { ScanOutcome, Store } from './store.js';
import { parseThreadsTime, type SearchOutcome, type SearchProvider } from './threads.js';
import type { Lead, ThreadsPost } from './types.js';

export interface Notifier {
  /** Sends a lead card; resolves with the Telegram message ID once Telegram accepted it. */
  sendLead(lead: Lead): Promise<number>;
  /** Short service message to the owner (e.g. token expired). */
  sendNotice(text: string): Promise<void>;
}

export interface ScannerOptions {
  store: Store;
  provider: SearchProvider;
  notifier: Notifier;
  terms: readonly string[];
  lookbackHours: number;
  maxRequestsPerScan: number;
  resultsPerQuery: number;
  now?: () => number;
  log?: (msg: string) => void;
}

export interface Evaluation {
  post: ThreadsPost;
  term: string;
  verdict: 'alert' | 'skip' | 'stale' | 'known';
  reason: string;
}

export interface ScanReport {
  outcome: ScanOutcome;
  requests: number;
  fetched: number;
  newLeads: number;
  delivered: number;
  deliveryFailed: number;
  providerError: string | null;
  deliveryError: string | null;
  evaluations: Evaluation[];
}

const DEFAULT_RATE_LIMIT_COOLDOWN_S = 60 * 60;
const MAX_DELIVERIES_PER_SCAN = 20;
const RETENTION_MS = 90 * 24 * 3600_000;
const COOLDOWN_KEY = 'threads_cooldown_until';
const NOTICE_KEY = 'last_provider_notice';

const NOTICES: Partial<Record<SearchOutcome['kind'], string>> = {
  auth_error: '⚠️ Threads отклонил токен (истёк или недействителен). Обновите THREADS_ACCESS_TOKEN — см. README, раздел «Продление токена».',
  permission_denied: '⚠️ Threads: нет разрешения на поиск (threads_keyword_search). Проверьте одобрение приложения в Meta — см. README.',
};

export class Scanner {
  private running = false;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;

  constructor(private readonly o: ScannerOptions) {
    this.now = o.now ?? Date.now;
    this.log = o.log ?? ((m) => console.log(`[scan] ${m}`));
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Runs one scan. Returns null if a scan is already in progress (no overlap). */
  async runOnce(): Promise<ScanReport | null> {
    if (this.running) {
      this.log('previous scan still running — skipped');
      return null;
    }
    this.running = true;
    try {
      return await this.scan();
    } finally {
      this.running = false;
    }
  }

  private async scan(): Promise<ScanReport> {
    const { store } = this.o;
    const started = this.now();
    const runId = store.startScan(started);
    const sinceMs = started - this.o.lookbackHours * 3600_000;

    const report: ScanReport = {
      outcome: 'ok', requests: 0, fetched: 0, newLeads: 0, delivered: 0, deliveryFailed: 0,
      providerError: null, deliveryError: null, evaluations: [],
    };

    // 1. Search (unless cooling down after a rate limit)
    const cooldownUntil = Number(store.getMeta(COOLDOWN_KEY) ?? 0);
    if (cooldownUntil > started) {
      report.outcome = 'cooldown';
      report.providerError = `пауза после лимита Threads до ${new Date(cooldownUntil).toISOString()}`;
    } else {
      await this.search(sinceMs, report);
    }

    // 2. Deliver everything still pending (new leads and earlier failures)
    await this.deliver(report);

    store.finishScan(runId, this.now(), {
      outcome: report.outcome, requests: report.requests, fetched: report.fetched, newLeads: report.newLeads,
      delivered: report.delivered, deliveryFailed: report.deliveryFailed,
      providerError: report.providerError, deliveryError: report.deliveryError,
    });
    store.prune(this.now() - RETENTION_MS);
    this.log(
      `${report.outcome}: requests=${report.requests} fetched=${report.fetched} new=${report.newLeads} ` +
      `delivered=${report.delivered} deliveryFailed=${report.deliveryFailed}` +
      (report.providerError ? ` providerError="${report.providerError}"` : '') +
      (report.deliveryError ? ` deliveryError="${report.deliveryError}"` : ''),
    );
    return report;
  }

  private async search(sinceMs: number, report: ScanReport): Promise<void> {
    const { store, provider, terms } = this.o;
    const unique = new Map<string, { post: ThreadsPost; term: string }>();
    const terms_ = terms.slice(0, this.o.maxRequestsPerScan);
    let ok = 0;
    let failed = 0;

    for (const term of terms_) {
      report.requests++;
      const res = await provider.search(term, sinceMs / 1000, this.o.resultsPerQuery);
      if (res.kind === 'ok') {
        ok++;
        for (const post of res.posts) if (!unique.has(post.id)) unique.set(post.id, { post, term });
        continue;
      }
      failed++;
      report.providerError = `${res.kind}: ${res.message}`;
      if (res.kind === 'auth_error' || res.kind === 'permission_denied') {
        report.outcome = res.kind;
        await this.noticeOnce(res.kind);
        break;
      }
      if (res.kind === 'rate_limited') {
        report.outcome = 'rate_limited';
        const wait = (res.retryAfterSeconds ?? DEFAULT_RATE_LIMIT_COOLDOWN_S) * 1000;
        store.setMeta(COOLDOWN_KEY, String(this.now() + wait));
        break;
      }
      // transient / request_error: try the next term
    }

    if (report.outcome === 'ok') {
      if (failed > 0) report.outcome = ok > 0 ? 'partial' : 'provider_error';
      if (ok > 0) store.setMeta(NOTICE_KEY, null); // provider healthy again
    }
    report.fetched = unique.size;

    for (const { post, term } of unique.values()) {
      const published = parseThreadsTime(post.timestamp);
      if (!Number.isFinite(published) || published < sinceMs) {
        report.evaluations.push({ post, term, verdict: 'stale', reason: 'старше окна поиска' });
        continue;
      }
      if (store.hasLead(post.id)) {
        report.evaluations.push({ post, term, verdict: 'known', reason: 'уже найден ранее' });
        continue;
      }
      const m = matchPost(post.text);
      if (!m.match) {
        report.evaluations.push({ post, term, verdict: 'skip', reason: m.reason });
        continue;
      }
      const language = detectLanguage(post.text);
      const inserted = store.insertLead({
        postId: post.id, username: post.username, text: post.text, permalink: post.permalink,
        publishedAt: published, language, reason: m.reason, reply: suggestReply(language, m.wants), searchTerm: term,
      }, this.now());
      if (inserted) report.newLeads++;
      report.evaluations.push({ post, term, verdict: 'alert', reason: m.reason });
    }
  }

  private async deliver(report: ScanReport): Promise<void> {
    const { store, notifier } = this.o;
    for (const lead of store.pendingDeliveries(MAX_DELIVERIES_PER_SCAN)) {
      try {
        const messageId = await notifier.sendLead(lead);
        store.markDelivered(lead.postId, messageId, this.now());
        report.delivered++;
      } catch (e) {
        const msg = describeError(e);
        store.markDeliveryFailed(lead.postId, msg);
        report.deliveryFailed++;
        report.deliveryError = msg;
        // Telegram is probably unavailable — keep the rest pending for the next scan.
        break;
      }
    }
  }

  /** Tell the owner about auth/permission problems once, not every 30 minutes. */
  private async noticeOnce(kind: SearchOutcome['kind']): Promise<void> {
    const text = NOTICES[kind];
    if (!text || this.o.store.getMeta(NOTICE_KEY) === kind) return;
    try {
      await this.o.notifier.sendNotice(text);
      this.o.store.setMeta(NOTICE_KEY, kind);
    } catch {
      // visible in /status and logs anyway
    }
  }
}

export function describeError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`.slice(0, 300);
  return String(e).slice(0, 300);
}
