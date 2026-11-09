import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Scanner } from '../src/scanner.js';
import { Store } from '../src/store.js';
import type { SearchOutcome } from '../src/threads.js';
import { FakeNotifier, FakeProvider, LEAD_TEXT, LEAD_TEXT_2, NOW, post, tempDb } from './helpers.js';

let db: ReturnType<typeof tempDb>;
let store: Store;
beforeEach(() => { db = tempDb(); store = new Store(db.path); });
afterEach(() => { try { store.close(); } catch { /* already closed */ } db.cleanup(); });

const make = (provider: FakeProvider, notifier: FakeNotifier, s = store, terms = ['a', 'b', 'c'], maxRequests = 20) =>
  new Scanner({ store: s, provider, notifier, terms, lookbackHours: 24, maxRequestsPerScan: maxRequests, resultsPerQuery: 50, now: () => NOW, log: () => undefined });

describe('scanner', () => {
  it('skips stale posts outside the lookback window', async () => {
    const p = new FakeProvider({ a: { kind: 'ok', posts: [post('1', LEAD_TEXT, 30), post('2', LEAD_TEXT_2, 2)] } });
    const n = new FakeNotifier();
    const r = (await make(p, n).runOnce())!;
    assert.equal(r.newLeads, 1);
    assert.deepEqual(n.sent.map((l) => l.postId), ['2']);
    assert.equal(r.evaluations.find((e) => e.post.id === '1')?.verdict, 'stale');
  });

  it('dedupes the same post ID returned by several search terms', async () => {
    const same = post('42', LEAD_TEXT);
    const p = new FakeProvider({ a: { kind: 'ok', posts: [same] }, b: { kind: 'ok', posts: [same] }, c: { kind: 'ok', posts: [same] } });
    const n = new FakeNotifier();
    const r = (await make(p, n).runOnce())!;
    assert.equal(r.fetched, 1);
    assert.equal(r.newLeads, 1);
    assert.equal(n.sent.length, 1);
  });

  it('does not re-send after reopening the SQLite file (restart)', async () => {
    const p = new FakeProvider({ a: { kind: 'ok', posts: [post('7', LEAD_TEXT)] } });
    const n = new FakeNotifier();
    await make(p, n).runOnce();
    store.close();

    store = new Store(db.path);
    const r = (await make(p, n, store).runOnce())!;
    assert.equal(r.newLeads, 0);
    assert.equal(r.delivered, 0);
    assert.equal(n.sent.length, 1);
    assert.equal(r.evaluations[0]?.verdict, 'known');
  });

  it('keeps a lead pending when Telegram fails, then delivers it on the next scan', async () => {
    const p = new FakeProvider({ a: { kind: 'ok', posts: [post('9', LEAD_TEXT)] } });
    const n = new FakeNotifier();
    n.failNext = 1;
    const r1 = (await make(p, n).runOnce())!;
    assert.equal(r1.deliveryFailed, 1);
    assert.match(r1.deliveryError ?? '', /Network/);
    let lead = store.getLead('9')!;
    assert.equal(lead.deliveryStatus, 'pending');
    assert.equal(lead.deliveryAttempts, 1);
    assert.equal(lead.telegramMessageId, null);

    const r2 = (await make(p, n).runOnce())!;
    assert.equal(r2.delivered, 1);
    lead = store.getLead('9')!;
    assert.equal(lead.deliveryStatus, 'sent');
    assert.ok(lead.telegramMessageId);
    assert.equal(lead.decision, null, 'delivery state is separate from the decision');

    const r3 = (await make(p, n).runOnce())!;
    assert.equal(r3.delivered, 0);
    assert.equal(n.sent.length, 1);
  });

  it('stops on permission denied, records it and notifies once', async () => {
    const denied: SearchOutcome = { kind: 'permission_denied', message: 'HTTP 403, code 10: no permission' };
    const p = new FakeProvider({}, denied);
    const n = new FakeNotifier();
    const r = (await make(p, n).runOnce())!;
    assert.equal(r.outcome, 'permission_denied');
    assert.equal(p.calls.length, 1, 'no further requests after a permission error');
    assert.equal(store.lastScan()?.outcome, 'permission_denied');
    assert.equal(store.lastSuccessfulScan(), null);
    await make(p, n).runOnce();
    assert.equal(n.notices.length, 1, 'owner is notified only once');
  });

  it('distinguishes auth error from permission error', async () => {
    const p = new FakeProvider({}, { kind: 'auth_error', message: 'code 190' });
    const r = (await make(p, new FakeNotifier()).runOnce())!;
    assert.equal(r.outcome, 'auth_error');
  });

  it('stops on rate limit and cools down on the next scan', async () => {
    const p = new FakeProvider({ a: { kind: 'ok', posts: [] }, b: { kind: 'rate_limited', message: 'code 4', retryAfterSeconds: null } });
    const n = new FakeNotifier();
    const r = (await make(p, n).runOnce())!;
    assert.equal(r.outcome, 'rate_limited');
    assert.deepEqual(p.calls, ['a', 'b']);
    const r2 = (await make(p, n).runOnce())!;
    assert.equal(r2.outcome, 'cooldown');
    assert.equal(p.calls.length, 2, 'no requests during cooldown');
  });

  it('treats a successful empty response as ok, and transient failures as partial', async () => {
    const r1 = (await make(new FakeProvider({}), new FakeNotifier()).runOnce())!;
    assert.equal(r1.outcome, 'ok');
    assert.equal(r1.fetched, 0);
    const r2 = (await make(new FakeProvider({ b: { kind: 'transient', message: 'timeout' } }), new FakeNotifier()).runOnce())!;
    assert.equal(r2.outcome, 'partial');
    const r3 = (await make(new FakeProvider({}, { kind: 'transient', message: 'timeout' }), new FakeNotifier()).runOnce())!;
    assert.equal(r3.outcome, 'provider_error');
  });

  it('bounds the number of requests per scan', async () => {
    const p = new FakeProvider({});
    await make(p, new FakeNotifier(), store, ['a', 'b', 'c', 'd', 'e'], 2).runOnce();
    assert.equal(p.calls.length, 2);
  });

  it('prevents overlapping scans', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const p = new FakeProvider({});
    p.search = async () => { await gate; return { kind: 'ok', posts: [] }; };
    const s = make(p, new FakeNotifier());
    const first = s.runOnce();
    assert.equal(await s.runOnce(), null);
    release();
    assert.ok(await first);
  });

  it('does not alert on non-matching posts', async () => {
    const p = new FakeProvider({ a: { kind: 'ok', posts: [post('5', 'Zapraszam na treningi boksu w Warszawie, mam wolne terminy')] } });
    const n = new FakeNotifier();
    const r = (await make(p, n).runOnce())!;
    assert.equal(r.newLeads, 0);
    assert.equal(n.sent.length, 0);
    assert.equal(store.hasLead('5'), false, 'non-matching post text is not stored');
  });
});
