// Relay + lobby + referee.
// - Pairs two players by room code and forwards their netplay/signaling packets (players also connect P2P).
// - Public rooms are listed in a lobby; anyone can watch a live fight (spectators get the confirmed input tape).
// - Players mirror their confirmed inputs here; the server replays them with the same sim and reports
//   KOs/winner to the arena contract (server/referee.ts). 30 s with nothing from a player = forfeit.
// Also serves the built game from dist/ so one process = whole deploy.
import { WebSocketServer, type WebSocket } from 'ws';
import { Referee, view } from './referee.ts';
import { sanitize, type Dna } from '../src/genes.ts';
import { STAGE_IDS, type StageId } from '../src/stages.ts';
import { randomInt } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT ?? 8787);
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const RELAYED = new Set(['in', 'hash', 'sdp', 'ice', 'go', 'pick']);
const FORFEIT_MS = 30_000;

interface Seat { ws: WebSocket | null; name: string; dna: Dna; account: string; seen: number; tape: number[] }
interface Room {
  code: string; pub: boolean; bettable: boolean; matchId: number | null; stake: string; stage: StageId;
  seats: Seat[]; spectators: Set<WebSocket>; status: 'waiting' | 'live' | 'done'; winner: number | null;
  ref: Referee | null; frames: number[][]; created: number;
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
  code: r.code, status: r.status, stage: r.stage, bettable: r.bettable, matchId: r.matchId, stake: r.stake, winner: r.winner,
  players: r.seats.map((s) => ({ name: s.name, dna: s.dna, account: s.account })), watchers: r.spectators.size,
});
let lobbyTimer: ReturnType<typeof setTimeout> | null = null;
function pushLobby() { // throttled: at most one broadcast per 500 ms
  if (lobbyTimer) return;
  lobbyTimer = setTimeout(() => {
    lobbyTimer = null;
    const list = [...rooms.values()].filter((r) => r.pub && r.status !== 'done').map(lobbyRow);
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
    if (r.status !== 'live') continue;
    const gone = r.seats.map((s) => now - s.seen > FORFEIT_MS);
    if (gone[0] && gone[1]) finish(r, null, 'both left');
    else if (gone[0] || gone[1]) finish(r, gone[0] ? 1 : 0, 'forfeit');
  }
}, 1000);

wss.on('connection', (ws) => {
  let room: Room | null = null, seat = -1;
  ws.on('message', async (raw) => {
    let m: any;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (seat >= 0 && room) room.seats[seat].seen = Date.now();

    if (m.t === 'host' && !room) {
      const code = newCode();
      room = {
        code, pub: !!m.pub, bettable: !!m.bettable, matchId: Number.isInteger(m.matchId) ? m.matchId : null,
        stake: /^\d{1,40}$/.test(m.stake ?? '') ? m.stake : '0', stage: STAGE_IDS.includes(m.stage) ? m.stage : 'ember',
        seats: [{ ws, name: str(m.name, 24) || 'Host', dna: sanitize(m.dna), account: str(m.account, 64), seen: Date.now(), tape: [] }],
        spectators: new Set(), status: 'waiting', winner: null, ref: null, frames: [], created: Date.now(),
      };
      seat = 0; rooms.set(code, room);
      send(ws, { t: 'room', code });
      pushLobby();
    } else if (m.t === 'join' && !room) {
      const r = rooms.get(str(m.code, 8).toUpperCase());
      if (!r || r.status !== 'waiting' || r.seats.length !== 1) return send(ws, { t: 'error', msg: 'Room not found or already full' });
      if (r.matchId !== null) { // staked/bettable: guest must have joined on-chain first
        const mv = await view<{ status: string; guest: string | null }>('get_match', { match_id: r.matchId });
        if (mv && mv.status !== 'live') return send(ws, { t: 'error', msg: 'Join the match on-chain first (stake not paid yet)' });
        // ponytail: guest identity is the claimed account; verify with a NEP-413 signature before mainnet
      }
      if (r.seats.length !== 1 || r.status !== 'waiting') return send(ws, { t: 'error', msg: 'Room already full' });
      room = r; seat = 1;
      r.seats.push({ ws, name: str(m.name, 24) || 'Guest', dna: sanitize(m.dna), account: str(m.account, 64), seen: Date.now(), tape: [] });
      r.status = 'live';
      r.ref = new Referee(r.matchId, [r.seats[0].dna, r.seats[1].dna], r.stage);
      pushLobby();
      // Input delay must cover A -> relay -> B latency, plus 2 frames of jitter margin. Same value for both seats.
      const socks = r.seats.map((s) => s.ws!);
      Promise.all(socks.map(rtt)).then(([a, b]) => {
        const delay = Math.min(15, Math.max(3, Math.ceil((a + b) / 2 / (1000 / 60)) + 2));
        socks.forEach((c, i) => send(c, { t: 'start', seat: i, delay, matchId: r.matchId, bettable: r.bettable }));
      });
    } else if (m.t === 'peek') { // room info by code (works for private rooms: the code is the secret)
      const r = rooms.get(str(m.code, 8).toUpperCase());
      send(ws, { t: 'peek', room: r ? lobbyRow(r) : null });
    } else if (m.t === 'watch' && !room) {
      const r = rooms.get(str(m.code, 8).toUpperCase());
      if (!r) return send(ws, { t: 'error', msg: 'Room not found' });
      room = r; r.spectators.add(ws);
      send(ws, { t: 'spec', code: r.code, stage: r.stage, status: r.status, winner: r.winner, matchId: r.matchId, bettable: r.bettable,
        players: r.seats.map((s) => ({ name: s.name, dna: s.dna, account: s.account })), frames: r.frames });
      pushLobby();
    } else if (m.t === 'lobby') {
      lobbySubs.add(ws);
      send(ws, { t: 'lobby', rooms: [...rooms.values()].filter((r) => r.pub && r.status !== 'done').map(lobbyRow) });
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
    if (seat < 0) { r.spectators.delete(ws); return pushLobby(); }
    r.seats[seat].ws = null;
    const other = r.seats[1 - seat]?.ws;
    if (other) send(other, { t: 'left' });
    if (r.status === 'waiting') { rooms.delete(r.code); pushLobby(); } // host left before anyone joined
    // live: the 30 s forfeit timer decides
  });
});

console.log(`game + relay on http://localhost:${PORT}`);
