import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nick, unit } from './chain.ts';

test('nick hides chain ids', () => {
  assert.equal(nick('alice.testnet'), 'alice');
  assert.equal(nick('bob.brawler.testnet', 'x'), 'bob');
  assert.equal(nick('me.testnet', 'me.testnet'), 'You');
  assert.equal(nick('a'.repeat(64)), 'Player aaaa');
  assert.equal(nick(null), '—');
  assert.equal(unit(), 'coins');
});
