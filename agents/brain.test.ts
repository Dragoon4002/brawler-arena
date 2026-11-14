import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heuristic, template, validate, winProb, type View } from './brain.ts';

const B = { minBet: 0.01, maxBet: 0.1, left: 0.3 };
const v = (s0: number, d0: number, s1: number, d1: number, price0 = 0.5): View =>
  ({ fighters: [{ name: 'Ash', stocks: s0, damage: d0 }, { name: 'Bo', stocks: s1, damage: d1 }], secs: 30, price0 });

test('validate', () => {
  assert.deepEqual(validate({ action: 'buy', side: 1, amount: 0.05, reason: 'go' }, B), { action: 'buy', side: 1, amount: 0.05, reason: 'go' });
  assert.equal(validate({ action: 'buy', side: 1, amount: 5, reason: 'x' }, B)!.amount, 0.1); // clamped to maxBet
  assert.equal(validate({ action: 'buy', side: 0, amount: 0.001, reason: 'x' }, B)!.amount, 0.01); // clamped to min
  assert.equal(validate({ action: 'buy', side: 0, amount: 0.09, reason: 'x' }, { ...B, left: 0.04 })!.amount, 0.04);
  assert.equal(validate({ action: 'buy', side: 0, amount: 0.09, reason: 'x' }, { ...B, left: 0.005 }), null); // no budget
  for (const bad of [null, 'buy', {}, { action: 'sell', side: 0, amount: 1, reason: 'x' }, { action: 'buy', side: 2, amount: 1, reason: 'x' },
    { action: 'buy', side: '0', amount: 1, reason: 'x' }, { action: 'buy', side: 0, amount: NaN, reason: 'x' }, { action: 'buy', side: 0, amount: 1, reason: '' }])
    assert.equal(validate(bad, B), null, JSON.stringify(bad));
  assert.equal(validate({ action: 'hold' }, B)!.action, 'hold');
  assert.equal(validate({ action: 'buy', side: 0, amount: 1, reason: 'a'.repeat(500) }, B)!.reason.length, 120);
});

test('winProb', () => {
  assert.equal(winProb(v(3, 0, 3, 0)), 0.5);
  assert.ok(winProb(v(3, 0, 1, 50)) > 0.9);
  assert.ok(winProb(v(1, 150, 3, 0)) < 0.1);
});

test('heuristic personas', () => {
  const lead = v(3, 10, 2, 80, 0.6);
  const m = heuristic('Momentum', lead, B);
  assert.equal(m.action, 'buy'); assert.equal(m.side, 0); assert.ok(m.amount >= 0.01 && m.amount <= 0.1);
  assert.equal(heuristic('Momentum', v(3, 0, 3, 0), B).action, 'hold');
  const u = heuristic('Underdog', v(3, 10, 2, 80, 0.75), B);
  assert.equal(u.action, 'buy'); assert.equal(u.side, 1);
  assert.equal(heuristic('Underdog', { ...lead, price0: 0.55 }, B).action, 'hold'); // trailing side at 45% not cheap
  const q = heuristic('Quant', v(3, 0, 1, 100, 0.5), B); // model ~0.98 vs 0.5
  assert.equal(q.action, 'buy'); assert.equal(q.side, 0); assert.equal(q.amount, 0.1);
  assert.equal(heuristic('Quant', v(3, 0, 3, 0, 0.52), B).action, 'hold');
  assert.equal(heuristic('Momentum', lead, { ...B, left: 0 }).action, 'hold');
});

test('templates', () => {
  const s = v(2, 0, 1, 120);
  assert.match(template({ kind: 'ko', who: 1, v: s })!, /Bo goes DOWN.*1 stock left/);
  assert.match(template({ kind: 'over', who: 0, v: s, winner: 0 })!, /Ash takes it/);
  assert.match(template({ kind: 'over', who: 0, v: s, winner: null })!, /voided/);
});
