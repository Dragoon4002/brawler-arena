import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Netplay } from './net.ts';
import { newGame, step, hash } from './sim/sim.ts';

// Two peers over a link that drops 30% of packets and delays the rest 0-5 ticks (like an unreliable DataChannel).
test('lockstep survives packet loss, peers stay in sync', () => {
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
  let now = 0;
  const wire: { at: number; to: number; m: object }[] = [];
  const peers = [0, 1].map((seat) => {
    const s = newGame();
    const net = new Netplay((m) => { if (rnd() > 0.3) wire.push({ at: now + Math.floor(rnd() * 6), to: 1 - seat, m: JSON.parse(JSON.stringify(m)) }); }, seat, 3);
    return { s, net };
  });
  for (now = 0; now < 3000; now++) {
    for (let i = wire.length - 1; i >= 0; i--) if (wire[i].at <= now) { peers[wire[i].to].net.onMessage(wire[i].m as any); wire.splice(i, 1); }
    for (const p of peers) p.net.tick(() => Math.floor(rnd() * 256), (inp) => step(p.s, inp), () => hash(p.s));
  }
  const [a, b] = peers;
  assert.ok(a.net.frame > 1500 && b.net.frame > 1500, `frames ${a.net.frame} ${b.net.frame}`);
  assert.equal(a.net.desync || b.net.desync, false);
});

// Banner rule: brief stalls (jitter, a dropped packet) stay hidden; a real hold-up (peer silent 250 ms+) shows.
test('lagging only after a sustained stall', () => {
  const net = new Netplay(() => {}, 0, 2);
  const tick = () => net.tick(() => 0, () => {}, () => 0);
  tick(); tick(); // frames 0-1 come prefilled
  for (let i = 0; i < 3; i++) tick();
  assert.equal(net.stalled, true);
  assert.equal(net.lagging, false, 'micro-stall must not show the banner');
  net.onMessage({ t: 'in', f: 2, b: [0] });
  tick();
  assert.equal(net.stallTicks, 0);
  for (let i = 0; i < 15; i++) tick();
  assert.equal(net.lagging, true);
});
