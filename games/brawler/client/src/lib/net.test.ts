import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PRED, Netplay } from './net.ts';
import { newGame, step, hash } from './sim/sim.ts';

// Two peers over a link that drops 30% of packets and delays the rest 0-5 ticks (like an unreliable DataChannel).
test('lockstep survives packet loss, peers stay in sync', () => {
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
  let now = 0, lag = false;
  const wire: { at: number; to: number; m: object }[] = [];
  const peers = [0, 1].map((seat) => {
    const s = newGame();
    const net = new Netplay((m) => { if (rnd() > 0.3) wire.push({ at: now + Math.floor(rnd() * 6), to: 1 - seat, m: JSON.parse(JSON.stringify(m)) }); }, seat, 3);
    return { s, net };
  });
  for (now = 0; now < 3000; now++) {
    for (let i = wire.length - 1; i >= 0; i--) if (wire[i].at <= now) { peers[wire[i].to].net.onMessage(wire[i].m as any); wire.splice(i, 1); }
    for (const p of peers) { p.net.tick(() => Math.floor(rnd() * 512), (inp) => step(p.s, inp), () => hash(p.s)); lag ||= p.net.lagging; }
  }
  const [a, b] = peers;
  assert.ok(a.net.frame > 1500 && b.net.frame > 1500, `frames ${a.net.frame} ${b.net.frame}`);
  assert.equal(a.net.desync || b.net.desync, false);
  assert.equal(lag, false, 'jitter within the prediction window never shows the banner');
});

// Peer silent: local sim keeps running on prediction for MAX_PRED frames (no freeze), banner only after a real hold-up.
test('predicts through short gaps, lagging only after a sustained stall', () => {
  const net = new Netplay(() => {}, 0, 2);
  const tick = () => net.tick(() => 0, () => {}, () => 0);
  for (let i = 0; i < 5; i++) tick();
  assert.equal(net.stalled, false, 'prediction covers a short gap');
  assert.equal(net.frame, 2, 'only the prefilled frames are confirmed');
  for (let i = 0; i < 20 && !net.stalled; i++) tick();
  assert.equal(net.head - net.frame, MAX_PRED, 'runs ahead exactly the prediction window');
  assert.equal(net.predicted().length, MAX_PRED);
  assert.equal(net.lagging, false, 'micro-stall must not show the banner');
  net.onMessage({ t: 'in', f: 2, b: [0, 0, 0] });
  tick();
  assert.equal(net.frame, 5);
  assert.equal(net.stallTicks, 0);
  for (let i = 0; i < 40; i++) tick();
  assert.equal(net.lagging, true);
});
