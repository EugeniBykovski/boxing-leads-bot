import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Notifier } from '../src/scanner.js';
import type { SearchOutcome, SearchProvider } from '../src/threads.js';
import type { Lead, ThreadsPost } from '../src/types.js';

export const NOW = Date.parse('2026-11-09T12:00:00Z');

export function tempDb(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'boxing-leads-test-'));
  return { path: join(dir, 'test.sqlite'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function post(id: string, text: string, ageHours = 1): ThreadsPost {
  const ts = new Date(NOW - ageHours * 3600_000).toISOString().replace(/\.\d{3}Z$/, '+0000');
  return { id, text, username: `user${id}`, timestamp: ts, permalink: `https://www.threads.com/@user${id}/post/ABC${id}` };
}

/** Provider returning scripted outcomes per term; records every call. */
export class FakeProvider implements SearchProvider {
  calls: string[] = [];
  constructor(private readonly byTerm: Record<string, SearchOutcome>, private readonly fallback: SearchOutcome = { kind: 'ok', posts: [] }) {}
  async search(query: string): Promise<SearchOutcome> {
    this.calls.push(query);
    return this.byTerm[query] ?? this.fallback;
  }
}

/** Notifier that can be told to fail the next N sends. */
export class FakeNotifier implements Notifier {
  sent: Lead[] = [];
  notices: string[] = [];
  failNext = 0;
  private id = 100;
  async sendLead(lead: Lead): Promise<number> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('HttpError: Network request for sendMessage failed');
    }
    this.sent.push(lead);
    return ++this.id;
  }
  async sendNotice(text: string): Promise<void> {
    this.notices.push(text);
  }
}

export const LEAD_TEXT = 'Czy ktoś poleci trenera boksu na Mokotowie?';
export const LEAD_TEXT_2 = 'Ищу тренера по боксу в Варшаве, я новичок';
