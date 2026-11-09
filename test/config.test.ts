import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readConfig } from '../src/config.js';

describe('config', () => {
  it('reports missing variable names without values', () => {
    const r = readConfig({ THREADS_ACCESS_TOKEN: 'secret-abc', TELEGRAM_BOT_TOKEN: '' });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.deepEqual(r.missing, ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_OWNER_USER_ID', 'TELEGRAM_CHAT_ID']);
      assert.ok(!JSON.stringify(r).includes('secret-abc'));
    }
  });

  it('applies defaults (30 min, 24 h) and validates optional settings', () => {
    const base = { THREADS_ACCESS_TOKEN: 't', TELEGRAM_BOT_TOKEN: 'b', TELEGRAM_OWNER_USER_ID: '111', TELEGRAM_CHAT_ID: '111' };
    const ok = readConfig(base);
    assert.ok(ok.ok && ok.config.scanIntervalMinutes === 30 && ok.config.lookbackHours === 24);
    const custom = readConfig({ ...base, SCAN_INTERVAL_MINUTES: '15', LOOKBACK_HOURS: '48' });
    assert.ok(custom.ok && custom.config.scanIntervalMinutes === 15 && custom.config.lookbackHours === 48);
    const bad = readConfig({ ...base, SCAN_INTERVAL_MINUTES: 'often' });
    assert.ok(!bad.ok && bad.invalid[0]?.startsWith('SCAN_INTERVAL_MINUTES'));
  });

  it('requires the chat to be the owner\'s private chat', () => {
    const r = readConfig({ THREADS_ACCESS_TOKEN: 't', TELEGRAM_BOT_TOKEN: 'b', TELEGRAM_OWNER_USER_ID: '111', TELEGRAM_CHAT_ID: '-100123' });
    assert.ok(!r.ok && r.invalid.some((i) => i.startsWith('TELEGRAM_CHAT_ID')));
  });
});
