// Brawler bots: exhibition bot-vs-bot room, challenger that fights humans waiting in free rooms, template commentator.
import { hash, newGame, step, type GameState } from '../games/brawler/client/src/lib/sim/sim.ts';
import { nameFor, randomDna, sanitize, statsOf, type Dna } from '../games/brawler/client/src/lib/genes.ts';
import { STAGE_IDS } from '../games/brawler/client/src/lib/stages.ts';
import { Netplay } from '../games/brawler/client/src/lib/net.ts';
import { joinable, pilot, template, type Level, type Moment, type View } from './brain.ts';

const env = process.env;
const SERVER = env.SERVER_URL ?? 'wss://65-0-237-185.sslip.io';
const on = (k: string) => env[k] !== '0';
const JOIN_AFTER = Number(env.JOIN_AFTER_S ?? 20) * 1000;
const LEVEL = (env.BOT_LEVEL ?? 'medium') as Level;
const CASTER = env.COMMENTATOR_NAME ?? 'Bot Commentator';
const SAY_GAP = 6000;
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const pickOne = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
const monster = (): { name: string; dna: Dna } => { const seed = Math.floor(Math.random() * 2 ** 31); return { name: `Bot ${nameFor(seed)}`.slice(0, 24), dna: randomDna(seed) }; };

/* ---------- seat: one bot player over the normal client protocol ---------- */

interface Seat { ws: WebSocket; send: (o: object) => void; code: string; spectators: number; net: Netplay | null; live: boolean; leave: () => void }
interface SeatHooks { room?: (s: Seat) => void; state?: (s: Seat, m: any) => void; over?: (s: Seat, m: any) => void; rematch?: (s: Seat) => void; gone?: (s: Seat) => void }

function seat(first: object, me: { name: string; dna: Dna }, level: Level, hooks: SeatHooks) {
  const ws = new WebSocket(SERVER);
  const send = (o: object) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(o));
  let stage = 'ember', stop = () => {}, flush = () => {};
  const s: Seat = { ws, send, code: '', spectators: 0, net: null, live: false, leave: () => { stop(); ws.close(); } };
  const tag = () => `[${s.code || '----'}] ${me.name}`;

  // Same loop as the browser (session.ts): 60 Hz accumulator on an 8 ms timer, confirmed inputs mirrored as tape.
  const fight = (m: any) => {
    stop();
    const g: GameState = newGame(m.players.map((p: any) => statsOf(sanitize(p.dna))), STAGE_IDS.includes(stage as any) ? stage as any : 'ember');
    send({ t: 'pick', name: me.name, dna: me.dna, stage });
    send({ t: 'go', p2p: false, delay: m.delay }); // human host takes relay + server delay at once, no 4 s P2P wait
    const net = s.net = new Netplay(send, m.seat, m.delay);
    s.live = true;
    const brain = pilot(level);
    let batch: number[] = [], f0 = 0;
    flush = () => { if (batch.length) { send({ t: 'tape', f0, ins: batch }); f0 += batch.length; batch = []; } };
    const advance = (ins: number[]) => {
      if (g.winner >= 0) return;
      step(g, ins);
      batch.push((ins[0] << 16) | ins[1]);
      if (batch.length >= 6 || g.winner >= 0) flush();
    };
    const DT = 1000 / 60;
    let acc = 0, last = performance.now();
    const clock = setInterval(() => {
      const now = performance.now();
      acc = Math.min(acc + now - last, 250); last = now;
      while (acc >= DT) { acc -= DT; net.tick(() => brain(g, m.seat), advance, () => hash(g)); }
    }, 8);
    const hb = setInterval(() => send({ t: 'hb' }), 1000);
    stop = () => { clearInterval(clock); clearInterval(hb); stop = () => {}; };
    log(`${tag()} fighting as seat ${m.seat}, ${m.delay}f delay, ${stage}`);
  };

  ws.onopen = () => send({ ...first, ...me, stage: (first as any).stage ?? 'ember' });
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.t === 'ping') send({ t: 'pong' });
    else if (m.t === 'room') { s.code = m.code; hooks.room?.(s); }
    else if (m.t === 'roomstate') { stage = m.stage; s.spectators = m.spectators; hooks.state?.(s, m); }
    else if (m.t === 'start') fight(m);
    else if (m.t === 'in' || m.t === 'hash') s.net?.onMessage(m);
    else if (m.t === 'rejoin') { flush(); s.net?.resync(send); send({ t: 'resync' }); }
    else if (m.t === 'over') {
      flush(); s.live = false; // keep ticking (like a browser) so the opponent's netplay doesn't stall at the end screen
      log(`${tag()} over: winner ${m.winner} (${m.reason}), frame ${s.net?.frame}, desync ${s.net?.desync}`);
      hooks.over?.(s, m);
    } else if (m.t === 'rematch') hooks.rematch?.(s);
    else if (m.t === 'left') hooks.gone?.(s);
    else if (m.t === 'error') log(`${tag()} error: ${m.msg}`);
  };
  let down = false; // undici fires only `error` when a connect fails
  ws.onclose = ws.onerror = () => { if (!down) { down = true; stop(); hooks.gone?.(s); } };
  return s;
}

/* ---------- exhibition: one public bot-vs-bot room, always ---------- */

function exhibition() {
  let done = false;
  const restart = (why: string) => {
    if (done) return;
    done = true;
    log(`exhibition: ${why}, new room in 5 s`);
    host.leave(); guest?.leave();
    setTimeout(exhibition, 5000);
  };
  let guest: Seat | null = null;
  const a = monster(), b = monster();
  const host = seat({ t: 'host', stage: pickOne(STAGE_IDS), pub: true, view: true, bettable: false, matchId: null, stake: '0', account: 'bot-1.brawler' }, a, 'medium', {
    room: (h) => {
      log(`exhibition: room ${h.code} ${a.name} vs ${b.name}`);
      guest = seat({ t: 'join', code: h.code, account: 'bot-2.brawler' }, b, 'medium', {
        room: () => setTimeout(() => host.send({ t: 'begin' }), 3000),
        gone: () => restart('guest gone'),
      });
    },
    // watchers stay in the room for a rematch; nobody watching -> fresh monsters + arena
    over: (h) => setTimeout(() => {
      if (done) return;
      if (h.spectators > 0) { host.send({ t: 'rematch' }); guest?.send({ t: 'rematch' }); }
      else restart('match over');
    }, 8000),
    gone: () => restart('host gone'),
  });
}

/* ---------- challenger: joins humans waiting alone in public free rooms ---------- */

const waiting = new Map<string, number>(), taken = new Set<string>();
let rows: any[] = [];

function challenge(code: string) {
  taken.add(code);
  let games = 0, asked = false;
  const me = monster();
  log(`challenger: joining ${code} as ${me.name} (${LEVEL})`);
  const s = seat({ t: 'join', code, account: 'bot-3.brawler' }, me, LEVEL, {
    room: (x) => setTimeout(() => x.send({ t: 'chat', text: `${me.name} here (${LEVEL} bot). Press Start when ready!` }), 1000),
    over: (x) => {
      games++;
      if (games > 1) return void setTimeout(x.leave, 3000);
      setTimeout(() => !asked && x.leave(), 30_000);
    },
    rematch: (x) => { asked = true; if (games === 1) x.send({ t: 'rematch' }); },
    gone: (x) => { if (!x.live) x.leave(); }, // mid-fight drop: they may rejoin, else the server forfeits them
  });
}

setInterval(() => {
  if (!on('CHALLENGER')) return;
  const now = Date.now(), live = new Set(rows.map((r) => r.code));
  for (const c of waiting.keys()) if (!live.has(c)) waiting.delete(c);
  for (const c of taken) if (!live.has(c)) taken.delete(c);
  for (const r of rows) {
    if (!joinable(r, 0, 0)) { waiting.delete(r.code); continue; }
    if (!waiting.has(r.code)) waiting.set(r.code, now);
    if (!taken.has(r.code) && joinable(r, now - waiting.get(r.code)!, JOIN_AFTER)) challenge(r.code);
  }
}, 1000);

/* ---------- commentator ---------- */

interface Room { code: string; names: [string, string]; game: GameState | null; done: boolean; ws: WebSocket; lastSay: number; ticks: number; pending: Moment | null; dmgMark: [number, number]; behind: [boolean, boolean]; timer?: ReturnType<typeof setInterval> }
const rooms = new Map<string, Room>();

const snapshot = (r: Room): View | null => r.game && {
  fighters: r.game.fighters.map((f, i) => ({ name: r.names[i], stocks: f.stocks, damage: f.damage })) as View['fighters'],
  secs: r.game.frame / 60,
};
const PRIO = { start: 1, swing: 2, ko: 3, comeback: 4, over: 5 };
const queue = (r: Room, kind: Moment['kind'], who = 0, winner?: number | null) => {
  const v = snapshot(r);
  if (v && (!r.pending || PRIO[kind] >= PRIO[r.pending.kind])) r.pending = { kind, who, v, winner };
};

function watch(code: string) {
  const ws = new WebSocket(SERVER);
  const r: Room = { code, names: ['P1', 'P2'], game: null, done: false, ws, lastSay: 0, ticks: 0, pending: null, dmgMark: [0, 0], behind: [false, false] };
  rooms.set(code, r);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'watch', code, account: CASTER }));
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.t === 'ping') ws.send('{"t":"pong"}');
    else if (m.t === 'spec') {
      r.names = [m.players[0]?.name ?? 'P1', m.players[1]?.name ?? 'P2'];
      r.game = newGame(m.players.slice(0, 2).map((p: any) => statsOf(sanitize(p.dna))), STAGE_IDS.includes(m.stage) ? m.stage : 'ember');
      for (const ins of m.frames) step(r.game, ins);
      if (m.frames.length < 120) queue(r, 'start');
    } else if (m.t === 'frames' && r.game) {
      for (const ins of m.ins) {
        const before = r.game.fighters.map((f) => f.stocks);
        step(r.game, ins);
        for (const e of r.game.events) if (e.kind === 'ko') queue(r, 'ko', e.who);
        const [a, b] = r.game.fighters.map((f) => f.stocks);
        if (a !== before[0] || b !== before[1]) {
          if (a === b && (r.behind[0] || r.behind[1])) { queue(r, 'comeback', r.behind[0] ? 0 : 1); r.behind = [false, false]; }
          if (a < b) r.behind[0] = true;
          if (b < a) r.behind[1] = true;
        }
      }
    } else if (m.t === 'over') {
      r.done = true;
      queue(r, 'over', 0, m.winner);
      speak(r); setTimeout(() => close(r), 2000);
    }
  };
  ws.onclose = ws.onerror = () => close(r);
  r.timer = setInterval(() => {
    if (!r.game || r.done) return;
    if (r.ticks++ % 3 === 0) r.game.fighters.forEach((x, i) => { if (x.damage - r.dmgMark[i] >= 40) queue(r, 'swing', i); r.dmgMark[i] = x.damage; });
    speak(r);
  }, 1000);
}

function close(r: Room) {
  if (rooms.get(r.code) !== r) return;
  rooms.delete(r.code);
  clearInterval(r.timer);
  r.ws.close();
}

function speak(r: Room) {
  const m = r.pending, now = Date.now();
  if (!m || (now - r.lastSay < SAY_GAP && m.kind !== 'over')) return;
  r.pending = null;
  r.lastSay = now;
  const line = template(m);
  log(`[${r.code}] ${CASTER}: ${line}`);
  if (r.ws.readyState === WebSocket.OPEN) r.ws.send(JSON.stringify({ t: 'chat', text: line }));
}

/* ---------- lobby ---------- */

function lobby() {
  const ws = new WebSocket(SERVER);
  ws.onopen = () => { log(`lobby connected ${SERVER}`); ws.send('{"t":"lobby"}'); };
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.t === 'ping') return ws.send('{"t":"pong"}');
    if (m.t !== 'lobby') return;
    rows = m.rooms;
    if (on('COMMENTATOR')) for (const row of rows) if (row.status === 'live' && !rooms.has(row.code)) watch(row.code);
  };
  let down = false;
  ws.onclose = ws.onerror = () => { if (!down) { down = true; rows = []; log('lobby down, reconnecting'); setTimeout(lobby, 3000); } };
}

log(`bots up: exhibition ${on('EXHIBITION')}, challenger ${on('CHALLENGER')} (${LEVEL}, after ${JOIN_AFTER / 1000} s), commentator ${on('COMMENTATOR')}`);
lobby();
if (on('EXHIBITION')) exhibition();
