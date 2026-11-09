import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyError, parseThreadsTime, ThreadsClient } from '../src/threads.js';

const TOKEN = 'SECRET_TOKEN_VALUE';

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: URL[] = [];
  const impl = (async (input: string | URL | Request) => {
    calls.push(new URL(String(input)));
    return new Response(JSON.stringify(body), { status, headers });
  }) as typeof fetch;
  return { impl, calls };
}

describe('Threads client', () => {
  it('calls keyword_search with RECENT ordering, since and fields', async () => {
    const f = fakeFetch(200, { data: [
      { id: '1', text: 'hello', username: 'ania', timestamp: '2026-11-09T10:00:00+0000', permalink: 'https://www.threads.com/@ania/post/X' },
      { id: '2', media_type: 'IMAGE' },
    ] });
    const c = new ThreadsClient({ accessToken: TOKEN, fetchImpl: f.impl });
    const r = await c.search('trener boksu', 1_700_000_000, 50);
    assert.equal(r.kind, 'ok');
    assert.equal(r.kind === 'ok' && r.posts.length, 1, 'posts without text are dropped');
    const u = f.calls[0]!;
    assert.equal(u.origin + u.pathname, 'https://graph.threads.com/v1.0/keyword_search');
    assert.equal(u.searchParams.get('q'), 'trener boksu');
    assert.equal(u.searchParams.get('search_type'), 'RECENT');
    assert.equal(u.searchParams.get('since'), '1700000000');
    assert.equal(u.searchParams.get('limit'), '50');
    assert.match(u.searchParams.get('fields')!, /id.*text.*permalink.*timestamp.*username/);
  });

  it('treats an empty data array as a successful empty result', async () => {
    const c = new ThreadsClient({ accessToken: TOKEN, fetchImpl: fakeFetch(200, { data: [] }).impl });
    assert.deepEqual(await c.search('x', 0, 10), { kind: 'ok', posts: [] });
  });

  it('maps expired token, missing permission and rate limit to distinct outcomes', async () => {
    const run = async (status: number, error: object, headers?: Record<string, string>) =>
      new ThreadsClient({ accessToken: TOKEN, fetchImpl: fakeFetch(status, { error }, headers).impl }).search('x', 0, 10);
    const expired = await run(400, { message: 'Session has expired', code: 190, error_subcode: 463 });
    assert.equal(expired.kind, 'auth_error');
    const denied = await run(403, { message: 'Application does not have permission for this action', code: 10 });
    assert.equal(denied.kind, 'permission_denied');
    const limited = await run(429, { message: 'Too many calls', code: 4 }, { 'retry-after': '120' });
    assert.equal(limited.kind, 'rate_limited');
    assert.equal(limited.kind === 'rate_limited' && limited.retryAfterSeconds, 120);
    const down = await run(503, { message: 'Service unavailable', code: 2 });
    assert.equal(down.kind, 'transient');
    for (const r of [expired, denied, limited, down]) {
      assert.ok(!JSON.stringify(r).includes(TOKEN), 'token never leaks into outcomes');
    }
  });

  it('turns timeouts and network failures into transient outcomes without leaking the token', async () => {
    const timeout = (async () => { throw new DOMException('timed out', 'TimeoutError'); }) as typeof fetch;
    const r1 = await new ThreadsClient({ accessToken: TOKEN, fetchImpl: timeout, timeoutMs: 50 }).search('x', 0, 10);
    assert.equal(r1.kind, 'transient');
    const net = (async () => { throw new TypeError(`fetch failed https://graph.threads.com/?access_token=${TOKEN}`); }) as typeof fetch;
    const r2 = await new ThreadsClient({ accessToken: TOKEN, fetchImpl: net }).search('x', 0, 10);
    assert.equal(r2.kind, 'transient');
    assert.ok(!JSON.stringify(r2).includes(TOKEN));
  });

  it('really times out a hanging request', async () => {
    const hang = ((_: unknown, init?: RequestInit) => new Promise((_r, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    })) as typeof fetch;
    const r = await new ThreadsClient({ accessToken: TOKEN, fetchImpl: hang, timeoutMs: 30 }).search('x', 0, 10);
    assert.deepEqual(r, { kind: 'transient', message: 'timeout after 30 ms' });
  });

  it('classifies unknown 4xx as request_error', () => {
    assert.equal(classifyError(400, { code: 100, message: 'Invalid parameter' }, null).kind, 'request_error');
  });

  it('parses Threads timestamps', () => {
    assert.equal(parseThreadsTime('2026-11-09T10:00:00+0000'), Date.parse('2026-11-09T10:00:00Z'));
  });
});
