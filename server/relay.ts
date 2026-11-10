// Tiny relay for lockstep netplay: pairs two clients by room code and forwards their input/hash packets.
// No game logic here; both clients run the same deterministic sim.
// Also serves the built game from dist/ so one process = whole deploy.
import { WebSocketServer, type WebSocket } from 'ws';
import { randomInt } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT ?? 8787);
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const RELAYED = new Set(['in', 'hash']);
const rooms = new Map<string, WebSocket[]>();
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
const wss = new WebSocketServer({ server: http, maxPayload: 1024 });
http.listen(PORT);

const send = (ws: WebSocket, msg: object) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
const newCode = () => {
  let c = '';
  do c = Array.from({ length: 4 }, () => LETTERS[randomInt(LETTERS.length)]).join(''); while (rooms.has(c));
  return c;
};

// Median of 3 app-level pings, ms. (Protocol-level ws pings get answered by hosting proxies, so they read ~0.)
// Falls back to 300 if the client doesn't answer.
const pongs = new WeakMap<WebSocket, () => void>();
const rtt = (ws: WebSocket) => new Promise<number>((done) => {
  const samples: number[] = [];
  let t = 0;
  const go = () => { t = performance.now(); send(ws, { t: 'ping' }); };
  pongs.set(ws, () => {
    samples.push(performance.now() - t);
    if (samples.length < 3) return go();
    pongs.delete(ws); done(samples.sort((a, b) => a - b)[1]);
  });
  go();
  setTimeout(() => { pongs.delete(ws); done(300); }, 3000);
});

wss.on('connection', (ws) => {
  let room = '';
  ws.on('message', (raw) => {
    let msg: { t?: string; code?: string };
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.t === 'host' && !room) {
      room = newCode(); rooms.set(room, [ws]);
      send(ws, { t: 'room', code: room });
    } else if (msg.t === 'join' && !room) {
      const code = String(msg.code ?? '').toUpperCase().slice(0, 8);
      const r = rooms.get(code);
      if (!r || r.length !== 1) return send(ws, { t: 'error', msg: 'Room not found or full' });
      room = code; r.push(ws);
      // Input delay must cover A -> relay -> B latency, plus 2 frames of jitter margin. Same value for both seats.
      Promise.all(r.map(rtt)).then(([a, b]) => {
        const delay = Math.min(15, Math.max(3, Math.ceil((a + b) / 2 / (1000 / 60)) + 2));
        r.forEach((c, seat) => send(c, { t: 'start', seat, delay }));
      });
    } else if (msg.t === 'pong') {
      pongs.get(ws)?.();
    } else if (msg.t && RELAYED.has(msg.t)) {
      const other = rooms.get(room)?.find((c) => c !== ws);
      if (other?.readyState === other?.OPEN) other!.send(raw.toString());
    }
  });
  ws.on('close', () => {
    const r = rooms.get(room);
    if (!r) return;
    r.forEach((c) => c !== ws && send(c, { t: 'left' }));
    rooms.delete(room);
  });
});

console.log(`game + relay on http://localhost:${PORT}`);
