import { loadConfigOrExit } from './config.js';
import { Scanner } from './scanner.js';
import { SEARCH_TERMS } from './searchTerms.js';
import { Store } from './store.js';
import { createBot, TelegramNotifier } from './telegram.js';
import { ThreadsClient } from './threads.js';

/**
 * One bounded LIVE scan: real Threads search, real Telegram delivery to your
 * private chat, real SQLite file. Never falls back to demo data.
 * Exit codes: 0 = search succeeded, 1 = provider/delivery problem, 2 = config.
 */
const cfg = loadConfigOrExit();
const store = new Store(cfg.databasePath);
const bot = createBot(cfg);
const scanner = new Scanner({
  store,
  provider: new ThreadsClient({ accessToken: cfg.threadsAccessToken, apiBase: cfg.threadsApiBase, timeoutMs: cfg.httpTimeoutMs }),
  notifier: new TelegramNotifier(bot, cfg.chatId),
  terms: SEARCH_TERMS,
  lookbackHours: cfg.lookbackHours,
  maxRequestsPerScan: cfg.maxRequestsPerScan,
  resultsPerQuery: cfg.resultsPerQuery,
});

try {
  const r = await scanner.runOnce();
  if (!r) process.exitCode = 1;
  else {
    const counts = { alert: 0, skip: 0, stale: 0, known: 0 };
    for (const e of r.evaluations) counts[e.verdict]++;
    console.log(`\nOutcome: ${r.outcome}`);
    console.log(`Requests: ${r.requests}, unique posts: ${r.fetched}, matched: ${counts.alert}, skipped: ${counts.skip}, stale: ${counts.stale}, already known: ${counts.known}`);
    console.log(`New leads: ${r.newLeads}, delivered to Telegram: ${r.delivered}, delivery failures: ${r.deliveryFailed}`);
    if (r.providerError) console.log(`Threads error: ${r.providerError}`);
    if (r.deliveryError) console.log(`Telegram error: ${r.deliveryError}`);
    if (r.fetched === 0 && (r.outcome === 'ok' || r.outcome === 'partial')) {
      console.log('\nNote: an empty result does NOT prove public search works. Run `npm run threads:check -- "<phrase>"` with a known post by another author.');
    }
    process.exitCode = r.outcome === 'ok' && r.deliveryFailed === 0 ? 0 : 1;
  }
} finally {
  store.close();
}
