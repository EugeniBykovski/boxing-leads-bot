import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderCard, renderCardPreview } from './card.js';
import { Scanner, type Notifier } from './scanner.js';
import { Store } from './store.js';
import type { SearchProvider } from './threads.js';
import type { Lead, ThreadsPost } from './types.js';

/**
 * OFFLINE demo: synthetic posts → production matcher → production card formatter.
 * Temporary SQLite file, no .env, no Threads, no Telegram, zero network calls.
 */
globalThis.fetch = () => Promise.reject(new Error('Network is disabled in the demo'));

const now = Date.now();
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString().replace('Z', '+0000').replace(/\.\d{3}/, '');

let n = 0;
const post = (username: string, text: string, ageMinutes: number): ThreadsPost => {
  const id = String(18_000_000_000_000_000n + BigInt(++n));
  return { id, username, text, timestamp: minutesAgo(ageMinutes), permalink: `https://www.threads.com/@${username}/post/DEMO${n}` };
};

const POSTS: ThreadsPost[] = [
  post('ania.biega', 'Czy ktoś poleci trenera boksu na Mokotowie?', 15),
  post('dmitry_wro', 'Ищу тренера по боксу в Варшаве, я новичок', 40),
  post('olena.k', 'Порадьте, де у Варшаві почати займатися боксом', 75),
  post('mark_in_pl', 'Any recommendations for beginner boxing classes in Warsaw?', 120),
  post('coach_pawel', 'Zapraszam na treningi boksu w Warszawie, mam wolne terminy', 30),
  post('just_someone', 'Looking for a boxing coach', 50),
  post('kasia_m', 'Mieszkam w Warszawie, ale szukam trenera boksu w Krakowie', 90),
  post('fan_boxing', 'Кто продаёт билеты на бокс в Варшаве?', 20),
  post('tomek_old', 'Szukam trenera boksu na Woli, ktoś coś?', 60 * 30), // 30 h old → outside the window
];

/** Same post returned by two different search terms → must be handled once. */
const DUPLICATE_OF = POSTS[0]!;

const provider: SearchProvider = {
  async search(query) {
    if (query === 'trenera boksu') return { kind: 'ok', posts: POSTS };
    if (query === 'boks Warszawa') return { kind: 'ok', posts: [DUPLICATE_OF] };
    return { kind: 'ok', posts: [] };
  },
};

const cards: Lead[] = [];
let messageId = 1000;
const notifier: Notifier = {
  async sendLead(lead) {
    cards.push(lead);
    return ++messageId;
  },
  async sendNotice() {},
};

const dir = mkdtempSync(join(tmpdir(), 'boxing-leads-demo-'));
const store = new Store(join(dir, 'demo.sqlite'));
try {
  const scanner = new Scanner({
    store, provider, notifier,
    terms: ['trenera boksu', 'boks Warszawa', 'boxing coach'],
    lookbackHours: 24, maxRequestsPerScan: 20, resultsPerQuery: 50,
    log: () => undefined,
  });
  const report = (await scanner.runOnce())!;

  const icon = { alert: '✅ ALERT', skip: '⛔ SKIP ', stale: '⌛ STALE', known: '↩ KNOWN' } as const;
  console.log('════ Offline demo: synthetic posts, temporary DB, no network ════\n');
  for (const e of report.evaluations) {
    console.log(`${icon[e.verdict]}  «${e.post.text}»`);
    console.log(`          → ${e.reason}\n`);
  }
  console.log(`Search requests: ${report.requests} · unique posts: ${report.fetched} (duplicate across terms counted once)`);
  console.log(`New leads: ${report.newLeads} · cards "sent": ${report.delivered}\n`);

  console.log('════ Telegram cards (preview) ════');
  for (const lead of cards) console.log(`\n${renderCardPreview(lead)}\n${'─'.repeat(60)}`);

  console.log('\n════ Exact Telegram payload of the first card (parse_mode=HTML) ════\n');
  if (cards[0]) console.log(renderCard(cards[0]));

  const again = (await scanner.runOnce())!;
  console.log(`\n════ Second scan (same posts) ════\nNew leads: ${again.newLeads} · cards sent: ${again.delivered} — no duplicates.`);
} finally {
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
