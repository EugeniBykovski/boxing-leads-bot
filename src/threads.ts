import type { ThreadsPost } from './types.js';

/**
 * Official Threads keyword search:
 *   GET https://graph.threads.com/v1.0/keyword_search
 *     ?q=…&search_type=RECENT&since=<unix>&limit<=100&fields=id,text,username,timestamp,permalink
 * Requires permissions threads_basic + threads_keyword_search. Without Meta's
 * approval (advanced access) it only searches the token owner's OWN posts.
 * Limit: 2,200 queries per user per rolling 24 hours.
 */
export const DEFAULT_THREADS_API_BASE = 'https://graph.threads.com/v1.0';
const FIELDS = 'id,text,media_type,permalink,timestamp,username';

export type SearchOutcome =
  | { kind: 'ok'; posts: ThreadsPost[] } // may be empty — that is a valid, successful answer
  | { kind: 'auth_error'; message: string } // token expired / invalid
  | { kind: 'permission_denied'; message: string } // missing scope or app not approved
  | { kind: 'rate_limited'; message: string; retryAfterSeconds: number | null }
  | { kind: 'transient'; message: string } // network, timeout, 5xx
  | { kind: 'request_error'; message: string }; // other 4xx — likely a bug in our request

export interface SearchProvider {
  search(query: string, sinceUnix: number, limit: number): Promise<SearchOutcome>;
}

export interface ThreadsClientOptions {
  accessToken: string;
  apiBase?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface GraphError { message?: string; type?: string; code?: number; error_subcode?: number }

/** Map an HTTP status + Graph API error to one of our outcomes. Never includes the token. */
export function classifyError(status: number, err: GraphError | undefined, retryAfter: string | null): SearchOutcome {
  const code = err?.code;
  const msg = `HTTP ${status}${code !== undefined ? `, code ${code}` : ''}${err?.error_subcode ? `/${err.error_subcode}` : ''}: ${(err?.message ?? 'no message').slice(0, 200)}`;
  if (code === 190 || code === 102 || status === 401) return { kind: 'auth_error', message: msg };
  if (code === 10 || (code !== undefined && code >= 200 && code <= 299) || status === 403) {
    return { kind: 'permission_denied', message: msg };
  }
  if (status === 429 || code === 4 || code === 17 || code === 32 || code === 613 || code === 80001) {
    const sec = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null;
    return { kind: 'rate_limited', message: msg, retryAfterSeconds: sec };
  }
  if (status >= 500 || code === 1 || code === 2) return { kind: 'transient', message: msg };
  return { kind: 'request_error', message: msg };
}

/** Threads returns "2024-07-12T19:04:13+0000"; make it parseable everywhere. */
export function parseThreadsTime(ts: string): number {
  return Date.parse(ts.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
}

export class ThreadsClient implements SearchProvider {
  private readonly token: string;
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ThreadsClientOptions) {
    this.token = opts.accessToken;
    this.base = (opts.apiBase ?? DEFAULT_THREADS_API_BASE).replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async get(path: string, params: Record<string, string>): Promise<{ status: number; body: unknown; retryAfter: string | null } | { failed: string }> {
    const url = new URL(`${this.base}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('access_token', this.token);
    try {
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      const body: unknown = await res.json().catch(() => undefined);
      return { status: res.status, body, retryAfter: res.headers.get('retry-after') };
    } catch (e) {
      const name = e instanceof Error ? e.name : 'Error';
      // Never echo the URL: it contains the token.
      return { failed: name === 'TimeoutError' || name === 'AbortError' ? `timeout after ${this.timeoutMs} ms` : `network error (${name})` };
    }
  }

  async search(query: string, sinceUnix: number, limit: number): Promise<SearchOutcome> {
    const r = await this.get('keyword_search', {
      q: query,
      search_type: 'RECENT',
      search_mode: 'KEYWORD',
      since: String(Math.floor(sinceUnix)),
      limit: String(Math.min(100, Math.max(1, limit))),
      fields: FIELDS,
    });
    if ('failed' in r) return { kind: 'transient', message: r.failed };
    const body = r.body as { data?: unknown; error?: GraphError } | undefined;
    if (r.status !== 200 || body?.error) return classifyError(r.status, body?.error, r.retryAfter);
    if (!body || !Array.isArray(body.data)) return { kind: 'transient', message: 'unexpected response shape' };

    const posts: ThreadsPost[] = [];
    for (const item of body.data as Record<string, unknown>[]) {
      const { id, text, username, timestamp, permalink } = item;
      if (typeof id !== 'string' || typeof text !== 'string' || !text.trim()) continue; // media without text
      posts.push({
        id,
        text,
        username: typeof username === 'string' ? username : 'unknown',
        timestamp: typeof timestamp === 'string' ? timestamp : '',
        permalink: typeof permalink === 'string' ? permalink : '',
      });
    }
    return { kind: 'ok', posts };
  }

  /** Username of the token owner (used by `npm run threads:check`). */
  async me(): Promise<{ ok: true; username: string; id: string } | { ok: false; outcome: SearchOutcome }> {
    const r = await this.get('me', { fields: 'id,username' });
    if ('failed' in r) return { ok: false, outcome: { kind: 'transient', message: r.failed } };
    const body = r.body as { id?: string; username?: string; error?: GraphError } | undefined;
    if (r.status !== 200 || body?.error || !body?.id) {
      return { ok: false, outcome: classifyError(r.status, body?.error, r.retryAfter) };
    }
    return { ok: true, id: body.id, username: body.username ?? '' };
  }
}
