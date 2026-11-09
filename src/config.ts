import { existsSync } from 'node:fs';
import { DEFAULT_THREADS_API_BASE } from './threads.js';

export interface Config {
  threadsAccessToken: string;
  telegramBotToken: string;
  ownerUserId: number;
  chatId: number;
  scanIntervalMinutes: number;
  lookbackHours: number;
  maxRequestsPerScan: number;
  resultsPerQuery: number;
  httpTimeoutMs: number;
  databasePath: string;
  threadsApiBase: string;
}

export type RequiredVar = 'THREADS_ACCESS_TOKEN' | 'TELEGRAM_BOT_TOKEN' | 'TELEGRAM_OWNER_USER_ID' | 'TELEGRAM_CHAT_ID';
export const ALL_REQUIRED: RequiredVar[] = ['THREADS_ACCESS_TOKEN', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_OWNER_USER_ID', 'TELEGRAM_CHAT_ID'];

export type ConfigResult =
  | { ok: true; config: Config }
  | { ok: false; missing: string[]; invalid: string[] };

/** Loads ./.env into process.env if present (existing variables win). */
export function loadDotEnv(path = '.env'): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

function int(env: NodeJS.ProcessEnv, name: string, def: number, min: number, max: number, invalid: string[]): number {
  const raw = env[name]?.trim();
  if (!raw) return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    invalid.push(`${name} (integer ${min}..${max})`);
    return def;
  }
  return n;
}

/**
 * Validates configuration. Error lists contain variable NAMES only, never values.
 */
export function readConfig(env: NodeJS.ProcessEnv, required: readonly RequiredVar[] = ALL_REQUIRED): ConfigResult {
  const missing = required.filter((k) => !env[k]?.trim());
  const invalid: string[] = [];

  const id = (name: RequiredVar): number => {
    const raw = env[name]?.trim();
    if (!raw) return 0;
    if (!/^-?\d{1,16}$/.test(raw)) {
      invalid.push(`${name} (numeric Telegram ID)`);
      return 0;
    }
    return Number(raw);
  };
  const ownerUserId = id('TELEGRAM_OWNER_USER_ID');
  const chatId = id('TELEGRAM_CHAT_ID');
  if (required.includes('TELEGRAM_CHAT_ID') && ownerUserId && chatId && ownerUserId !== chatId) {
    invalid.push('TELEGRAM_CHAT_ID (must be your private chat with the bot, which equals TELEGRAM_OWNER_USER_ID)');
  }

  const config: Config = {
    threadsAccessToken: env.THREADS_ACCESS_TOKEN?.trim() ?? '',
    telegramBotToken: env.TELEGRAM_BOT_TOKEN?.trim() ?? '',
    ownerUserId,
    chatId,
    scanIntervalMinutes: int(env, 'SCAN_INTERVAL_MINUTES', 30, 5, 24 * 60, invalid),
    lookbackHours: int(env, 'LOOKBACK_HOURS', 24, 1, 7 * 24, invalid),
    maxRequestsPerScan: int(env, 'MAX_REQUESTS_PER_SCAN', 20, 1, 45, invalid),
    resultsPerQuery: int(env, 'RESULTS_PER_QUERY', 50, 1, 100, invalid),
    httpTimeoutMs: int(env, 'HTTP_TIMEOUT_MS', 15_000, 1_000, 120_000, invalid),
    databasePath: env.DATABASE_PATH?.trim() || './data/leads.sqlite',
    threadsApiBase: env.THREADS_API_BASE?.trim() || DEFAULT_THREADS_API_BASE,
  };
  if (missing.length || invalid.length) return { ok: false, missing, invalid };
  return { ok: true, config };
}

/** For CLI entry points: load .env, validate, print names of problems and exit on failure. */
export function loadConfigOrExit(required: readonly RequiredVar[] = ALL_REQUIRED): Config {
  loadDotEnv();
  const res = readConfig(process.env, required);
  if (res.ok) return res.config;
  console.error('Configuration error. Fix these variables in .env (values are not shown):');
  for (const m of res.missing) console.error(`  - missing: ${m}`);
  for (const i of res.invalid) console.error(`  - invalid: ${i}`);
  console.error('See .env.example and README.md.');
  process.exit(2);
}
