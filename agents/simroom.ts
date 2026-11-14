// Local test helper: hosts + joins a free public room on SERVER_URL, starts it, and plays a bot-vs-bot fight in real time.
import { IN, newGame, step } from '../games/brawler/client/src/lib/sim/sim.ts';
import { STAGES } from '../games/brawler/client/src/lib/stages.ts';

const SERVER = process.env.SERVER_URL ?? 'ws://localhost:8799';
const dna = { str: 6, dex: 5, def: 5, spd: 6 }; // = DEFAULT_STATS, so this sim matches the referee's
const open = (first: object) => new Promise<WebSocket>((ok) => {
  const ws = new WebSocket(SERVER);
  ws.onopen = () => { ws.send(JSON.stringify(first)); ok(ws); };
});
const next = (ws: WebSocket, t: string) => new Promise<any>((ok) => ws.addEventListener('message', function h(e) {
  const m = JSON.parse(String(e.data));
  if (m.t === t) { ws.removeEventListener('message', h); ok(m); }
}));
const pong = (ws: WebSocket) => ws.addEventListener('message', (e) => { if (JSON.parse(String(e.data)).t === 'ping') ws.send('{"t":"pong"}'); });

const host = await open({ t: 'host', name: 'Grimfang', dna: dna, stage: 'ember', pub: true, view: true, bettable: false, matchId: null, stake: '0', account: 'host.testnet' });
pong(host);
host.addEventListener('message', (e) => { const m = JSON.parse(String(e.data)); if (m.t === 'chat') console.log(`chat <${m.from}> ${m.text}`); else if (m.t === 'over') console.log('over', m); });
const { code } = await next(host, 'room');
const guest = await open({ t: 'join', code, name: 'Mossback', dna: dna, stage: 'ember', account: 'guest.testnet' });
pong(guest);
await next(guest, 'room');
console.log(`room ${code} ready, starting in 4 s`);
await new Promise((r) => setTimeout(r, 4000));
host.send('{"t":"begin"}');
await next(host, 'start');
console.log('live');

const s = newGame(undefined, 'ember');
let f0 = 0;
// demo.ts bot (that file needs a browser), seat 0 a bit more aggressive so the fight swings
const bot = (me: number) => {
  const f = s.fighters[me], o = s.fighters[1 - me], dx = o.x - f.x, t = s.frame + me * 37;
  let b = Math.abs(dx) > 70 ? (dx > 0 ? IN.RIGHT : IN.LEFT) : 0;
  if (Math.abs(dx) < 90 && t % 24 < (me ? 2 : 4)) b |= t % 96 < 24 ? IN.HEAVY : IN.LIGHT;
  if (o.y < f.y - 80 && t % 30 === 0) b |= IN.JUMP;
  const g = STAGES[s.stage].solids.map((r) => ({ lo: r.x0 + 60, hi: r.x1 - 60 }));
  if (!g.some((r) => f.x >= r.lo && f.x <= r.hi)) {
    const mid = (r: { lo: number; hi: number }) => (r.lo + r.hi) / 2;
    const to = g.reduce((a, r) => (Math.abs(o.x - mid(r)) < Math.abs(o.x - mid(a)) ? r : a));
    const goal = Math.min(to.hi, Math.max(to.lo, f.x < mid(to) ? to.lo + 40 : to.hi - 40));
    b = (f.x < goal ? IN.RIGHT : IN.LEFT) | (t % 20 === 0 ? IN.JUMP : 0);
  }
  if (Math.random() < 0.03) b ^= [IN.JUMP, IN.LEFT, IN.RIGHT, IN.HEAVY][Math.floor(Math.random() * 4)]; // break stalemates
  return b;
};
const timer = setInterval(() => {
  if (s.frame % 600 < 6) console.log(s.frame, s.fighters.map((f) => `${f.stocks}/${Math.round(f.damage)}`).join(' vs '));
  const batch: number[] = [];
  for (let i = 0; i < 6 && s.winner < 0; i++) { const ins = [bot(0), bot(1)]; step(s, ins); batch.push((ins[0] << 16) | ins[1]); }
  if (s.frame > 60 * 150) { console.log('150 s cap: guest quits'); guest.close(); clearInterval(timer); setTimeout(() => process.exit(0), 40_000); return; }
  const msg = JSON.stringify({ t: 'tape', f0, ins: batch });
  host.send(msg); guest.send(msg);
  f0 += batch.length;
  if (s.winner >= 0) { clearInterval(timer); console.log(`winner ${s.winner} at frame ${s.frame}`); setTimeout(() => process.exit(0), 3000); }
}, 100);
