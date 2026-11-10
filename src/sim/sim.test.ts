import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, step, hash, IN, STAGE, MAX_HP, type GameState } from './sim.ts';

const run = (s: GameState, n: number, inputs: () => number[]) => { for (let i = 0; i < n; i++) step(s, inputs()); };

// Two grounded fighters standing close, facing each other.
function faceOff(gap = 60) {
  const s = newGame();
  run(s, 60, () => [0, 0]); // fall onto soft platforms
  const [a, b] = s.fighters;
  Object.assign(a, { x: 800 - gap / 2, y: STAGE.main.y, facing: 1 });
  Object.assign(b, { x: 800 + gap / 2, y: STAGE.main.y, facing: -1 });
  run(s, 2, () => [0, 0]);
  return s;
}

test('deterministic: same input script -> same hash', () => {
  const play = () => {
    const s = newGame();
    let seed = 42;
    const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) & 255;
    for (let f = 0; f < 3000; f++) step(s, [rnd(), rnd()]);
    return s;
  };
  const a = play(), b = play();
  assert.equal(hash(a), hash(b));
  assert.notEqual(hash(a), hash(newGame()));
});

test('jab lands, damages, hitstuns', () => {
  const s = faceOff();
  step(s, [IN.LIGHT, 0]);
  run(s, 12, () => [0, 0]);
  const b = s.fighters[1];
  assert.ok(b.damage > 0, 'damage dealt');
  assert.ok(b.state === 'hitstun' || b.hitlag > 0);
});

test('knockback grows with damage', () => {
  const launch = (pct: number) => {
    const s = faceOff(80);
    s.fighters[1].damage = pct;
    step(s, [IN.HEAVY | IN.RIGHT, 0]);
    let vx = 0;
    for (let i = 0; i < 40 && !vx; i++) { step(s, [0, 0]); if (s.fighters[1].state === 'hitstun') vx = s.fighters[1].vx; }
    return vx;
  };
  const low = launch(0), high = launch(120);
  assert.ok(low > 0 && high > low * 2, `low=${low} high=${high}`);
});

test('dodge i-frames avoid the hit', () => {
  const s = faceOff();
  step(s, [0, IN.DODGE]);
  step(s, [IN.LIGHT, 0]);
  run(s, 10, () => [0, 0]);
  assert.equal(s.fighters[1].damage, 0);
});

test('leaving blast zone costs a stock, then respawn', () => {
  const s = faceOff();
  s.fighters[1].x = STAGE.blast.x1 + 10;
  step(s, [0, 0]);
  assert.equal(s.fighters[1].stocks, 2);
  assert.equal(s.fighters[1].state, 'dead');
  run(s, 100, () => [0, 0]);
  assert.notEqual(s.fighters[1].state, 'dead');
  assert.equal(s.fighters[1].damage, 0);
});

test('last stock lost -> winner', () => {
  const s = faceOff();
  s.fighters[0].stocks = 1;
  s.fighters[0].y = STAGE.blast.y1 + 10;
  step(s, [0, 0]);
  assert.equal(s.winner, 1);
});

test('ground pound holds until landing', () => {
  const s = faceOff();
  const a = s.fighters[0];
  Object.assign(a, { x: 800, y: 100, grounded: false, state: 'air' }); // above the gap between soft platforms
  step(s, [IN.HEAVY | IN.DOWN, 0]);
  run(s, 15, () => [0, 0]);
  assert.equal(a.state, 'attack');
  assert.ok(a.vy > 15, 'falling fast');
  run(s, 60, () => [0, 0]);
  assert.equal(a.grounded, true);
  assert.notEqual(a.move, 'groundPound');
});

test('health depleted -> stock lost', () => {
  const s = faceOff();
  s.fighters[1].damage = MAX_HP - 1;
  step(s, [IN.LIGHT, 0]);
  run(s, 12, () => [0, 0]);
  assert.equal(s.fighters[1].stocks, 2);
});
