import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { CALLBACK, cardKeyboard, escapeHtml, renderCard, safePermalink } from '../src/card.js';
import { Store } from '../src/store.js';
import { buildStatusText, handleDecision, isOwner } from '../src/telegram.js';
import { NOW, tempDb } from './helpers.js';

const OWNER = { ownerUserId: 111, chatId: 111 };
let db: ReturnType<typeof tempDb>;
let store: Store;
beforeEach(() => {
  db = tempDb();
  store = new Store(db.path);
  store.insertLead({
    postId: '123', username: 'ania', text: 'Czy ktoś poleci <b>trenera</b> boksu & na Mokotowie?',
    permalink: 'https://www.threads.com/@ania/post/XYZ', publishedAt: NOW, language: 'pl',
    reason: 'ищет тренера по боксу · Варшава, Мокотув', reply: 'Cześć!', searchTerm: 'trenera boksu',
  }, NOW);
});
afterEach(() => { store.close(); db.cleanup(); });

const tap = (data: string, over: Partial<{ fromId: number; chatId: number; chatType: string }> = {}) =>
  handleDecision(store, OWNER, { fromId: 111, chatId: 111, chatType: 'private', data, now: NOW + 1000, ...over });

describe('owner restriction', () => {
  it('accepts only the owner in the private chat', () => {
    assert.equal(isOwner(OWNER, 111, 111, 'private'), true);
    assert.equal(isOwner(OWNER, 222, 222, 'private'), false);
    assert.equal(isOwner(OWNER, 111, -100500, 'group'), false);
    assert.equal(isOwner(OWNER, undefined, 111, 'private'), false);
  });

  it('rejects callbacks from other users and chats without changing state', () => {
    assert.equal(tap(CALLBACK.replied('123'), { fromId: 222, chatId: 222 }).kind, 'unauthorized');
    assert.equal(tap(CALLBACK.replied('123'), { chatId: -100500, chatType: 'supergroup' }).kind, 'unauthorized');
    assert.equal(store.getLead('123')!.decision, null);
  });
});

describe('owner decisions', () => {
  it('persists a decision and makes repeated taps harmless', () => {
    const first = tap(CALLBACK.replied('123'));
    assert.equal(first.kind, 'updated');
    const decidedAt = store.getLead('123')!.decidedAt;
    const again = tap(CALLBACK.replied('123'));
    assert.equal(again.kind, 'unchanged');
    assert.equal(store.getLead('123')!.decidedAt, decidedAt);
    assert.equal(tap(CALLBACK.skipped('123')).kind, 'updated', 'owner may change their mind');
    assert.equal(store.getLead('123')!.decision, 'skipped');
  });

  it('handles malformed data and unknown posts', () => {
    assert.equal(tap('d:x:123').kind, 'invalid');
    assert.equal(tap('garbage').kind, 'invalid');
    assert.equal(tap(CALLBACK.replied('999')).kind, 'not_found');
  });

  it('keeps callback data within Telegram limits', () => {
    assert.ok(Buffer.byteLength(CALLBACK.skipped('9'.repeat(40))) <= 64);
  });
});

describe('card', () => {
  it('escapes third-party text and shows required parts', () => {
    const html = renderCard(store.getLead('123')!);
    assert.ok(html.includes('&lt;b&gt;trenera&lt;/b&gt;'));
    assert.ok(html.includes('&amp; na'));
    assert.ok(html.includes('@ania'));
    assert.match(html, /\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} \(Варшава\)/);
    assert.ok(html.includes('<pre>Cześć!</pre>'));
  });

  it('shows the time in Europe/Warsaw', () => {
    const html = renderCard({ ...store.getLead('123')!, publishedAt: Date.parse('2026-07-01T10:00:00Z') });
    assert.ok(html.includes('01.07.2026, 12:00'), 'CEST = UTC+2');
  });

  it('has the three buttons with an HTTPS Threads link', () => {
    const rows = cardKeyboard(store.getLead('123')!).inline_keyboard.flat();
    assert.deepEqual(rows.map((b) => b.text), ['Открыть в Threads', 'Ответил', 'Пропустить']);
    const open = rows[0] as { url?: string };
    assert.equal(open.url, 'https://www.threads.com/@ania/post/XYZ');
  });

  it('refuses non-Threads or non-HTTPS links', () => {
    assert.equal(safePermalink('http://www.threads.net/@a/post/1'), null);
    assert.equal(safePermalink('https://evil.example/@a'), null);
    assert.equal(safePermalink('javascript:alert(1)'), null);
    assert.ok(safePermalink('https://www.threads.net/@a/post/1'));
  });

  it('escapeHtml covers the three special characters', () => {
    assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href="x"&gt;&amp;&lt;/a&gt;');
  });
});

describe('/status', () => {
  it('reports last success, lead counts and provider errors', () => {
    const ok = store.startScan(NOW - 3600_000);
    store.finishScan(ok, NOW - 3600_000, { outcome: 'ok', requests: 3, fetched: 5, newLeads: 1, delivered: 1, deliveryFailed: 0, providerError: null, deliveryError: null });
    const bad = store.startScan(NOW);
    store.finishScan(bad, NOW, { outcome: 'auth_error', requests: 1, fetched: 0, newLeads: 0, delivered: 0, deliveryFailed: 1, providerError: 'auth_error: code 190', deliveryError: 'HttpError: <timeout>' });
    const text = buildStatusText(store, { scanIntervalMinutes: 30, lookbackHours: 24 }, NOW, false);
    assert.match(text, /Последний успешный скан: .*1 ч назад/);
    assert.match(text, /токен Threads истёк/);
    assert.match(text, /code 190/);
    assert.match(text, /&lt;timeout&gt;/);
    assert.match(text, /всего 1/);
  });
});
