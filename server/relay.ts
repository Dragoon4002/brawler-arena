// Relay + lobby + referee.
// - Pairs two players by room code and forwards their netplay/signaling packets (players also connect P2P).
// - Public rooms are listed in a lobby; anyone can watch a live fight (spectators get the confirmed input tape).
// - Players mirror their confirmed inputs here; the server replays them with the same sim and reports
//   KOs/winner to the arena contract (server/referee.ts). 30 s with nothing from a player = forfeit.
// Protocol: on connect the server sends {t:'hello', nonce} (32 random bytes, base64). The client's first message is one of
//   {t:'host', name, dna, stage, pub, view, bettable, matchId|null, stake, account, auth?}
//   {t:'join', code, name, dna, stage, account, auth?}
//   {t:'match', matchId, account, name, dna, stage, auth}   tournament/on-chain match with no pre-made room
//   or {t:'watch', code} / {t:'lobby'} / {t:'peek', code}.
// Any seat tied to an on-chain matchId (host/join of a staked/bettable room, every `match`) needs
//   auth = {publicKey, signature}: NEP-413 signMessage of `brawler-arena:<matchId>`, recipient CONTRACT_ID, nonce = hello nonce,
//   by a FullAccess key of `account` (verifyAuth in referee.ts). Bad/missing -> {t:'error'}. Free rooms stay unauthenticated.
//   Skipped when CONTRACT_ID is unset (local dev: nothing on-chain to protect).
// `match`: first arrival gets {t:'room', code, seat}, second starts it; seat = on-chain host 0 / guest 1.
//   Opponent absent NO_SHOW_MS -> present seat wins (referee reports, kos [0,0]); {t:'over', winner, reason:'no-show'}.
// Also serves the built game from dist/ so one process = whole deploy.
import { WebSocketServer, type WebSocket } from 'ws';
import { Referee, monsterDna, view, verifyAuth, CONTRACT_ID, MONSTERS_ID } from './referee.ts';
import { sanitize, type Dna } from '../src/genes.ts';
import { STAGE_IDS, type StageId } from '../src/stages.ts';
import { randomBytes, randomInt } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT ?? 8787);
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const RELAYED = new Set(['in', 'hash', 'sdp', 'ice', 'go', 'pick']);
const FORFEIT_MS = 30_000;
const NO_SHOW_MS = 5 * 60_000; // `match` room: opponent never showed -> present player wins

interface Seat { ws: WebSocket | null; name: string; dna: Dna; account: string; seen: number; tape: number[] }
interface ChainMatch { status: string; host: string; guest: string | null; stake: string; bettable: boolean; monsters?: (string | null)[] }
interface Room {
  code: string; pub: boolean; view: boolean; bettable: boolean; matchId: number | null; stake: string; stage: StageId; // view: private room open to spectators
  seats: Seat[]; spectators: Set<WebSocket>; status: 'waiting' | 'live' | 'done'; winner: number | null;
  ref: Referee | null; frames: number[][]; created: number;
  noShow: number | null; // `match` rooms: on-chain seat of the first arrival (wins if the other never shows)
}
const rooms = new Map<string, Room>();
const lobbySubs = new Set<WebSocket>();
const DIST = join(import.meta.dirname, '..', 'dist');
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

const http = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = join(DIST, path === '/' ? 'index.html' : path);
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found (run npm run build?)');
  }
});
const wss = new WebSocketServer({ server: http, maxPayload: 16 * 1024 });
http.listen(PORT);

const send = (ws: WebSocket, msg: object) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
const newCode = () => {
  let c = '';
  do c = Array.from({ length: 4 }, () => LETTERS[randomInt(LETTERS.length)]).join(''); while (rooms.has(c));
  return c;
};

// Worst of 3 app-level pings, ms. (Protocol-level ws pings get answered by hosting proxies, so they read ~0.)
// Falls back to 300 if the client doesn't answer.
const pongs = new WeakMap<WebSocket, () => void>();
const rtt = (ws: WebSocket) => new Promise<number>((done) => {
  const samples: number[] = [];
  let t = 0;
  const go = () => { t = performance.now(); send(ws, { t: 'ping' }); };
  pongs.set(ws, () => {
    samples.push(performance.now() - t);
    if (samples.length < 3) return go();
    pongs.delete(ws); done(Math.max(...samples)); // worst of 3: jitter margin
  });
  go();
  setTimeout(() => { pongs.delete(ws); done(300); }, 3000);
});

const str = (v: unknown, n: number) => String(v ?? '').slice(0, n);
const lobbyRow = (r: Room) => ({
  code: r.code, pub: r.pub, status: r.status, stage: r.stage, bettable: r.bettable, matchId: r.matchId, stake: r.stake, winner: r.winner,
  players: r.seats.map((s) => ({ name: s.name, dna: s.dna, account: s.account })), watchers: r.spectators.size,
});
let lobbyTimer: ReturnType<typeof setTimeout> | null = null;
function pushLobby() { // throttled: at most one broadcast per 500 ms
  if (lobbyTimer) return;
  lobbyTimer = setTimeout(() => {
    lobbyTimer = null;
    const list = [...rooms.values()].filter((r) => (r.pub || r.view) && r.status !== 'done').map(lobbyRow);
    for (const ws of lobbySubs) send(ws, { t: 'lobby', rooms: list });
  }, 500);
}

function finish(r: Room, winner: number | null, reason: string) {
  if (r.status === 'done') return;
  r.status = 'done'; r.winner = winner;
  if (reason !== 'ko') r.ref?.result(winner); // on KO the referee already reported from the replay
  const msg = { t: 'over', winner, reason };
  r.seats.forEach((s) => s.ws && send(s.ws, msg));
  r.spectators.forEach((ws) => send(ws, msg));
  pushLobby();
  setTimeout(() => rooms.get(r.code) === r && rooms.delete(r.code), 120_000);
}

// Advance the referee while both players' tapes agree on the next frame.
function replay(r: Room) {
  if (r.status !== 'live' || !r.ref) return;
  const [a, b] = r.seats.map((s) => s.tape);
  const fresh: number[][] = [];
  while (r.ref.frame < a.length && r.ref.frame < b.length) {
    const f = r.ref.frame;
    if (a[f] !== b[f]) return finish(r, null, 'tape mismatch'); // ponytail: tapes are packed as host<<8|guest
    const ins: [number, number] = [a[f] >> 8, a[f] & 255];
    r.frames.push(ins); fresh.push(ins);
    if (r.ref.step(ins) >= 0) { spect(r, fresh); return finish(r, r.ref.state.winner, 'ko'); }
  }
  if (fresh.length) spect(r, fresh);
}
const spect = (r: Room, ins: number[][]) => r.spectators.forEach((ws) => send(ws, { t: 'frames', f0: r.frames.length - ins.length, ins }));

setInterval(() => { // forfeit: a player silent for 30 s loses (both silent -> refund)
  const now = Date.now();
  for (const r of rooms.values()) {
    if (r.status === 'waiting' && r.noShow !== null && r.seats.length === 1 && now - r.created >= NO_SHOW_MS) {
      r.ref = new Referee(r.matchId, [r.seats[0].dna, r.seats[0].dna], r.stage); // fresh game: result() reports kos [0,0]
      finish(r, r.noShow, 'no-show');
      continue;
    }
    if (r.status !== 'live') continue;
    const gone = r.seats.map((s) => now - s.seen > FORFEIT_MS);
    if (gone[0] && gone[1]) finish(r, null, 'both left');
    else if (gone[0] || gone[1]) finish(r, gone[0] ? 1 : 0, 'forfeit');
  }
}, 1000);

// Both seats filled: swap in on-chain monster DNA (if the match has monsters), create the referee, go live, start the clock.
// Status stays 'waiting' until the end so spectators' snapshot carries the final DNA.
async function begin(r: Room, mv?: ChainMatch | null) {
  if (r.matchId !== null) {
    mv ??= await view<ChainMatch>('get_match', { match_id: r.matchId });
    let failed = false;
    await Promise.all(r.seats.map(async (s, i) => {
      const id = mv?.monsters?.[i];
      if (!id) return;
      const d = MONSTERS_ID ? await monsterDna(id) : null;
      if (d) s.dna = d; else failed = true; // never fall back to client DNA for a chain monster
    }));
    if (failed) { // on-chain match stays playable on retry (or expires)
      rooms.delete(r.code); r.status = 'done'; pushLobby();
      r.seats.forEach((s) => { if (s.ws) { send(s.ws, { t: 'error', msg: 'Could not load monster from chain, try again' }); s.ws.close(); } });
      return;
    }
  }
  if (r.status !== 'waiting') return;
  if (r.seats.some((s) => !s.ws || s.ws.readyState !== s.ws.OPEN)) { // someone left during the lookups
    rooms.delete(r.code); finish(r, null, 'opponent left');
    return;
  }
  r.ref = new Referee(r.matchId, [r.seats[0].dna, r.seats[1].dna], r.stage);
  r.status = 'live';
  r.seats.forEach((s) => { s.seen = Date.now(); });
  const players = r.seats.map((s) => ({ name: s.name, dna: s.dna, account: s.account }));
  r.spectators.forEach((ws) => send(ws, { t: 'spec', code: r.code, stage: r.stage, status: r.status, winner: r.winner, matchId: r.matchId, bettable: r.bettable, players, frames: r.frames }));
  pushLobby();
  // Input delay must cover A -> relay -> B latency, plus 2 frames of jitter margin. Same value for both seats.
  const socks = r.seats.map((s) => s.ws!);
  Promise.all(socks.map(rtt)).then(([a, b]) => {
    const delay = Math.min(15, Math.max(3, Math.ceil((a + b) / 2 / (1000 / 60)) + 2));
    socks.forEach((c, i) => send(c, { t: 'start', seat: i, delay, matchId: r.matchId, bettable: r.bettable, players }));
  }).catch((e) => console.warn('start failed', r.code, e));
}

wss.on('connection', (ws) => {
  let room: Room | null = null, seat = -1;
  const nonce = randomBytes(32);
  send(ws, { t: 'hello', nonce: nonce.toString('base64') });
  const authed = (m: any, acct: string, matchId: number) => !CONTRACT_ID || verifyAuth(m.auth, acct, matchId, nonce);
  const DENIED = { t: 'error', msg: 'Wallet signature check failed' };
  ws.on('message', async (raw) => {
    let m: any;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (seat >= 0 && room) { seat = room.seats.findIndex((x) => x.ws === ws); if (seat >= 0) room.seats[seat].seen = Date.now(); } // seat can shift when a match room fills

    if (m.t === 'host' && !room) {
      const matchId: number | null = Number.isInteger(m.matchId) ? m.matchId : null, acct = str(m.account, 64);
      if (matchId !== null && CONTRACT_ID) { // staked/bettable: must be the on-chain host
        const mv = await view<ChainMatch>('get_match', { match_id: matchId });
        if (!mv || mv.status !== 'open' || mv.host !== acct) return send(ws, { t: 'error', msg: 'Not the host of this on-chain match' });
        if (!(await authed(m, acct, matchId))) return send(ws, DENIED);
        if ([...rooms.values()].some((x) => x.matchId === matchId && x.status !== 'done')) return send(ws, { t: 'error', msg: 'Room for this match already exists' });
      }
      if (room) return;
      const code = newCode();
      room = {
        code, pub: !!m.pub, view: !!m.pub || !!m.view, bettable: !!m.bettable, matchId,
        stake: /^\d{1,40}$/.test(m.stake ?? '') ? m.stake : '0', stage: STAGE_IDS.includes(m.stage) ? m.stage : 'ember',
        seats: [{ ws, name: str(m.name, 24) || 'Host', dna: sanitize(m.dna), account: acct, seen: Date.now(), tape: [] }],
        spectators: new Set(), status: 'waiting', winner: null, ref: null, frames: [], created: Date.now(), noShow: null,
      };
      seat = 0; rooms.set(code, room);
      send(ws, { t: 'room', code });
      pushLobby();
    } else if (m.t === 'join' && !room) {
      const r = rooms.get(str(m.code, 8).toUpperCase());
      if (!r || r.status !== 'waiting' || r.seats.length !== 1) return send(ws, { t: 'error', msg: 'Room not found or already full' });
      let mv: ChainMatch | null = null;
      if (r.matchId !== null) { // staked/bettable: guest must have joined on-chain first, and prove the account
        mv = await view<ChainMatch>('get_match', { match_id: r.matchId });
        if (!mv && CONTRACT_ID) return send(ws, { t: 'error', msg: 'Match not found on-chain' });
        if (mv && mv.status !== 'live') return send(ws, { t: 'error', msg: 'Join the match on-chain first (stake not paid yet)' });
        if (mv && mv.guest !== str(m.account, 64)) return send(ws, { t: 'error', msg: 'Another account paid for this seat' });
        if (!(await authed(m, str(m.account, 64), r.matchId))) return send(ws, DENIED);
      }
      if (r.seats.length !== 1 || r.status !== 'waiting') return send(ws, { t: 'error', msg: 'Room already full' });
      room = r; seat = 1;
      r.seats.push({ ws, name: str(m.name, 24) || 'Guest', dna: sanitize(m.dna), account: str(m.account, 64), seen: Date.now(), tape: [] });
      begin(r, mv).catch((e) => { console.warn('begin failed', r.code, e); finish(r, null, 'server error'); });
    } else if (m.t === 'match' && !room) {
      const id = m.matchId, acct = str(m.account, 64);
      if (!Number.isInteger(id)) return send(ws, { t: 'error', msg: 'Bad matchId' });
      const mv = await view<ChainMatch>('get_match', { match_id: id });
      if (!mv) return send(ws, { t: 'error', msg: 'Match not found' });
      if (mv.status !== 'live') return send(ws, { t: 'error', msg: 'Match is not live on-chain' });
      const me = acct === mv.host ? 0 : acct === mv.guest ? 1 : -1; // seat = on-chain order
      if (me < 0) return send(ws, { t: 'error', msg: 'Not a player in this match' });
      if (!(await authed(m, acct, id))) return send(ws, DENIED);
      if (room) return;
      const mine: Seat = { ws, name: str(m.name, 24) || (me ? 'Guest' : 'Host'), dna: sanitize(m.dna), account: acct, seen: Date.now(), tape: [] };
      const r = [...rooms.values()].find((x) => x.matchId === id && x.status === 'waiting');
      if (!r) {
        const code = newCode();
        room = {
          code, pub: mv.bettable, view: true, bettable: mv.bettable, matchId: id, stake: /^\d{1,40}$/.test(mv.stake) ? mv.stake : '0',
          stage: STAGE_IDS.includes(m.stage) ? m.stage : 'ember', seats: [mine], spectators: new Set(), status: 'waiting',
          winner: null, ref: null, frames: [], created: Date.now(), noShow: me,
        };
        rooms.set(code, room); seat = 0;
        send(ws, { t: 'room', code, seat: me });
        pushLobby();
      } else {
        if (r.seats.length !== 1 || r.seats[0].account !== (me ? mv.host : mv.guest)) return send(ws, { t: 'error', msg: 'Room already taken' });
        room = r; r.seats[me ? 'push' : 'unshift'](mine); seat = me;
        begin(r, mv).catch((e) => { console.warn('begin failed', r.code, e); finish(r, null, 'server error'); });
      }
    } else if (m.t === 'peek') { // room info by code (works for private rooms: the code is the secret)
      const r = rooms.get(str(m.code, 8).toUpperCase());
      send(ws, { t: 'peek', room: r ? lobbyRow(r) : null });
    } else if (m.t === 'watch' && !room) {
      const r = rooms.get(str(m.code, 8).toUpperCase());
      if (!r) return send(ws, { t: 'error', msg: 'Room not found' });
      if (!r.view) return send(ws, { t: 'error', msg: 'This private room is closed to spectators' });
      room = r; r.spectators.add(ws);
      send(ws, { t: 'spec', code: r.code, stage: r.stage, status: r.status, winner: r.winner, matchId: r.matchId, bettable: r.bettable,
        players: r.seats.map((s) => ({ name: s.name, dna: s.dna, account: s.account })), frames: r.frames });
      pushLobby();
    } else if (m.t === 'lobby') {
      lobbySubs.add(ws);
      send(ws, { t: 'lobby', rooms: [...rooms.values()].filter((r) => (r.pub || r.view) && r.status !== 'done').map(lobbyRow) });
    } else if (m.t === 'tape' && room && seat >= 0 && Number.isInteger(m.f0) && Array.isArray(m.ins)) {
      const tape = room.seats[seat].tape;
      if (m.f0 !== tape.length) return; // batches arrive in order on one socket; ignore dupes
      for (const v of m.ins.slice(0, 600)) tape.push(Number(v) & 0xffff);
      replay(room);
    } else if (m.t === 'pong') {
      pongs.get(ws)?.();
    } else if (m.t && RELAYED.has(m.t) && room && seat >= 0) {
      const other = room.seats[1 - seat]?.ws;
      if (other && other.readyState === other.OPEN) other.send(raw.toString());
    }
  });
  ws.on('close', () => {
    lobbySubs.delete(ws);
    if (!room) return;
    const r = room;
    seat = r.seats.findIndex((x) => x.ws === ws);
    if (seat < 0) { r.spectators.delete(ws); return pushLobby(); }
    r.seats[seat].ws = null;
    const other = r.seats[1 - seat]?.ws;
    if (other) send(other, { t: 'left' });
    if (r.status === 'waiting') { rooms.delete(r.code); pushLobby(); } // host left before anyone joined
    // live: the 30 s forfeit timer decides
  });
});

if (CONTRACT_ID && !MONSTERS_ID) console.error('!!! CONTRACT_ID set but MONSTERS_ID empty: matches with on-chain monsters will fail to start');
console.log(`game + relay on http://localhost:${PORT}`);
