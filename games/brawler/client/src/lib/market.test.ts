import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Market, ONE, simulate } from './market.ts';

test('books balance for every outcome, many random runs', () => {
  for (let run = 1; run <= 40; run++) for (const winner of [0, 1, null] as const) {
    const { audit, market } = simulate({ run, winner, traders: 6 + (run % 5), trades: 30 + run });
    assert.ok(audit.dust >= 0n, `overpaid run ${run} winner ${winner}: ${audit.dust}`);
    assert.ok(audit.dust < 1000n, `dust only, run ${run}: ${audit.dust}`);
    for (const [who] of market.positions) assert.equal(market.due(who), 0n); // all claimed
  }
});

test('long raises price, short lowers it, quote matches fill', () => {
  const m = new Market(5n * ONE);
  const q = m.quoteBuy(0, ONE);
  assert.equal(m.buy('a', 0, ONE, q), q);
  const up = m.price;
  assert.ok(up > 5000);
  m.buy('b', 1, 2n * ONE);
  assert.ok(m.price < up);
});

test('positions lock until the fight ends: there is no way to sell', () => {
  assert.equal('sell' in new Market(5n * ONE), false);
});

test('guards match the contract', () => {
  const m = new Market(5n * ONE);
  assert.throws(() => m.buy('a', 0, ONE / 1000n), /Bet below minimum/);
  assert.throws(() => m.buy('a', 0, 101n * ONE), /Bet above maximum/);
  const sh = m.buy('a', 0, ONE);
  assert.throws(() => m.buy('b', 0, ONE, ONE * 10n), /Price moved/);
  m.finish(0);
  assert.throws(() => m.buy('a', 0, ONE), /Betting closed/);
  assert.equal(m.claim('a'), sh); // 1 NEAR per winning share
});

test('void refunds net deposit (after fee) and house keeps the rest', () => {
  const m = new Market(5n * ONE);
  m.buy('a', 0, 3n * ONE);
  m.finish(null);
  assert.equal(m.claim('a'), 3n * ONE - (3n * ONE) / 1000n);
  const a = m.audit();
  assert.equal(a.house, 5n * ONE);
  assert.equal(a.dust, 0n);
});

test('each bet is its own position; all settle together at the result', () => {
  const m = new Market(5n * ONE);
  const a1 = m.buy('a', 0, 45n * ONE / 10n), b = m.buy('a', 1, 25n * ONE / 10n), a2 = m.buy('a', 0, 15n * ONE / 10n);
  assert.deepEqual(m.lots.get('a')!.map((l) => [l.side, l.shares]), [[0, a1], [1, b], [0, a2]]);
  m.finish(0);
  assert.equal(m.claim('a'), a1 + a2); // A shares pay 1 NEAR each, B shares nothing
});
