// Golden vectors for rust sim port. Run: node --experimental-strip-types scripts/golden.ts
// Per run: dna, stage, packed tape (host<<8|guest), per-frame FNV over fighter f64 bits.
import { writeFileSync } from 'node:fs';
import { newGame, step, IN, type Fighter, type GameState } from '../games/brawler/client/src/sim/sim.ts';
import { MOVES } from '../games/brawler/client/src/sim/moves.ts';
import { randomDna, sanitize, statsOf } from '../games/brawler/client/src/genes.ts';
import { STAGE_IDS } from '../games/brawler/client/src/stages.ts';

const STATES = ['idle', 'run', 'jumpsquat', 'air', 'land', 'dodge', 'attack', 'hitstun', 'dead'];
const MOVE_IDS = Object.keys(MOVES);

// Same field order as rust golden test.
export const fields = (f: Fighter) => [
  f.x, f.y, f.vx, f.vy, f.facing, STATES.indexOf(f.state), f.t, +f.grounded, f.airJumps, +f.recoveryUsed, +f.airDodged, +f.fastFall,
  f.move ? MOVE_IDS.indexOf(f.move) : -1, +f.moveHit, f.combo, f.comboT, f.damage, f.stocks, f.hitstun, f.hitlag, f.invuln,
  f.dodgeCd, f.landLag, f.dropT, f.prevIn, f.buf, f.bufT, f.mod.dmg, f.mod.kbTaken, f.mod.startup, f.mod.run,
];

const dv = new DataView(new ArrayBuffer(8));
function fnv(s: GameState) {
  let h = 2166136261;
  for (const v of [...s.fighters.flatMap(fields), s.winner]) {
    dv.setFloat64(0, v, true);
    for (let i = 0; i < 8; i++) h = Math.imul(h ^ dv.getUint8(i), 16777619);
  }
  return h >>> 0;
}

// Chasing bot + LCG noise so fights reach KOs.
function botTape(s: GameState, me: number, rnd: () => number) {
  const f = s.fighters[me], o = s.fighters[1 - me], dx = o.x - f.x;
  let b = Math.abs(dx) > 60 ? (dx > 0 ? IN.RIGHT : IN.LEFT) : 0;
  const r = rnd();
  if (Math.abs(dx) < 110 && r < 90) b |= r < 40 ? IN.HEAVY : IN.LIGHT;
  if (r > 200) b |= rnd() & 255; // noise
  if (o.y < f.y - 60 && r % 7 === 0) b |= IN.JUMP;
  if (r % 13 === 0) b |= IN.UP | (r % 2 ? IN.DOWN : 0);
  if (f.x < 420 || f.x > 1180) b = (b & ~(IN.LEFT | IN.RIGHT)) | (f.x < 800 ? IN.RIGHT : IN.LEFT) | (r % 9 === 0 ? IN.JUMP | IN.HEAVY : 0);
  return b & 255;
}

const runs = [];
for (let n = 0; n < 9; n++) {
  const stage = STAGE_IDS[n % STAGE_IDS.length];
  const dna = [randomDna(n * 2 + 1), randomDna(n * 2 + 2)];
  const s = newGame(dna.map(statsOf), stage);
  let seed = 1000 + n;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 16 & 255;
  const tape: number[] = [], hashes: number[] = [];
  while (s.winner < 0 && tape.length < 12000) {
    const ins = [botTape(s, 0, rnd), botTape(s, 1, rnd)];
    tape.push(ins[0] << 8 | ins[1]);
    step(s, ins);
    hashes.push(fnv(s));
  }
  runs.push({ stage, dna, tape, hashes, winner: s.winner, stocks: s.fighters.map((f) => f.stocks) });
}

const weird = [null, {}, { str: 99, dex: -4, def: '7', spd: null, hue: 400.4, size: 2 }, { str: 2.5, dex: 9.5, def: 'x', spd: true, eye: 3.49 }, randomDna(77)];
const sanitizeCases = weird.map((x) => ({ in: x, out: sanitize(x) }));
const out = new URL('../games/brawler/sim/testdata/golden.json', import.meta.url);
writeFileSync(out, JSON.stringify({ runs, sanitize: sanitizeCases }));
console.log(runs.map((r) => `${r.stage} ${r.tape.length}f winner ${r.winner} stocks ${r.stocks}`).join('\n'));
