// Tiny relay for lockstep netplay: pairs two clients by room code and forwards their input/hash packets.
// No game logic here; both clients run the same deterministic sim.
import { WebSocketServer, type WebSocket } from 'ws';
import { randomInt } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 8787);
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const RELAYED = new Set(['in', 'hash']);
const rooms = new Map<string, WebSocket[]>();
const wss = new WebSocketServer({ port: PORT, maxPayload: 1024 });

const send = (ws: WebSocket, msg: object) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
const newCode = () => {
  let c = '';
  do c = Array.from({ length: 4 }, () => LETTERS[randomInt(LETTERS.length)]).join(''); while (rooms.has(c));
  return c;
};

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
      r.forEach((c, seat) => send(c, { t: 'start', seat }));
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

console.log(`relay listening on ws://localhost:${PORT}`);
