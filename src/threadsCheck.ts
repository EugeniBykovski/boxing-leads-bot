import { loadConfigOrExit } from './config.js';
import { ThreadsClient } from './threads.js';

/**
 * Verifies that keyword search really covers OTHER people's public posts.
 * Usage: npm run threads:check -- "a phrase from a recent public post by someone else"
 */
const query = process.argv.slice(2).join(' ').trim();
if (!query) {
  console.error('Usage: npm run threads:check -- "<phrase from a known recent post by ANOTHER author>"');
  process.exit(2);
}
const cfg = loadConfigOrExit(['THREADS_ACCESS_TOKEN']);
const client = new ThreadsClient({ accessToken: cfg.threadsAccessToken, apiBase: cfg.threadsApiBase, timeoutMs: cfg.httpTimeoutMs });

const me = await client.me();
if (!me.ok) {
  console.error(`Token check failed: ${me.outcome.kind}${'message' in me.outcome ? ` — ${me.outcome.message}` : ''}`);
  process.exit(1);
}
console.log(`Token OK, authenticated as @${me.username}`);

const sinceUnix = Date.now() / 1000 - 7 * 24 * 3600;
const res = await client.search(query, sinceUnix, 25);
if (res.kind !== 'ok') {
  console.error(`Search failed: ${res.kind} — ${res.message}`);
  if (res.kind === 'permission_denied') console.error('The app lacks threads_keyword_search (advanced access). See README → Threads.');
  process.exit(1);
}
const others = res.posts.filter((p) => p.username.toLowerCase() !== me.username.toLowerCase());
console.log(`Results: ${res.posts.length} (from other authors: ${others.length})`);
for (const p of others.slice(0, 5)) console.log(`  @${p.username} ${p.timestamp} ${p.permalink}`);
if (others.length > 0) {
  console.log('\n✅ PUBLIC SEARCH CONFIRMED: results include posts by other authors.');
} else {
  console.log('\n❌ NOT PROVEN: no posts by other authors. Either the phrase did not match a post from the last 7 days,');
  console.log('   or the app has no approved threads_keyword_search (then only your own posts are searched).');
  process.exitCode = 1;
}
