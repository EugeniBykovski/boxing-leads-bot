import { loadConfigOrExit } from './config.js';
import { Scanner } from './scanner.js';
import { SEARCH_TERMS } from './searchTerms.js';
import { Store } from './store.js';
import { createBot, registerHandlers, TelegramNotifier } from './telegram.js';
import { ThreadsClient } from './threads.js';

/** Persistent worker: Telegram long polling + a Threads scan every N minutes. */
async function main(): Promise<void> {
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
  registerHandlers(bot, store, cfg, () => scanner.isRunning);

  await bot.api.setMyCommands([{ command: 'status', description: 'Статус сканера' }]).catch(() => undefined);

  const tick = () => scanner.runOnce().catch((e) => console.error('[scan] unexpected failure:', e instanceof Error ? e.message : e));
  const timer = setInterval(tick, cfg.scanIntervalMinutes * 60_000);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal}: stopping`);
    clearInterval(timer);
    await bot.stop().catch(() => undefined);
    while (scanner.isRunning) await new Promise((r) => setTimeout(r, 200));
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  console.log(`[worker] started: scan every ${cfg.scanIntervalMinutes} min, lookback ${cfg.lookbackHours} h, db ${cfg.databasePath}`);
  void tick();
  await bot.start({ allowed_updates: ['message', 'callback_query'], onStart: (me) => console.log(`[bot] polling as @${me.username}`) });
}

main().catch((e) => {
  console.error('[worker] fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
