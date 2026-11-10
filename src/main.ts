import { newGame, step, hash, IN, type GameState, type StageId } from './sim/sim.ts';
import { createRenderer } from './render/draw.ts';
import { localInputs, soloInput } from './input.ts';
import { Netplay, linkPeer } from './net.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const menu = $('menu'), status = $('status');
const renderer = createRenderer($<HTMLCanvasElement>('game'));
// Dev: separate relay on :8787. Prod: relay serves the page, so same host.
const params = new URLSearchParams(location.search);
const FORCE_RELAY = params.has('relay'); // ?relay -> skip P2P (debug fallback path)
const SERVER = params.get('server') ?? import.meta.env.VITE_SERVER_URL ??
  (import.meta.env.DEV ? `ws://${location.hostname}:8787` : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);

let mode: 'menu' | 'local' | 'online' = 'menu';
// ponytail: ?stage=grove|docks picks the arena until the Play screen's arena select lands.
const STAGE_ID = (['ember', 'grove', 'docks'].includes(params.get('stage') ?? '') ? params.get('stage') : 'ember') as StageId;
let state: GameState = newGame(undefined, STAGE_ID);
let net: Netplay | null = null;
let ws: WebSocket | null = null;
let peer: ReturnType<typeof linkPeer> | null = null;
let link = ''; // 'P2P · 3f' / 'RELAY · 9f' debug label
let banner = '';
let overFrames = 0;

// Shared by local + online so rematch is deterministic too.
function advance(inputs: number[]) {
  if (state.winner >= 0 && ++overFrames > 90 && inputs.every((b) => b & IN.JUMP)) { state = newGame(undefined, STAGE_ID); overFrames = 0; }
  step(state, inputs);
  renderer.onEvents(state.events);
}

function start(m: typeof mode) {
  mode = m; state = newGame(undefined, STAGE_ID); overFrames = 0; banner = '';
  menu.hidden = m !== 'menu';
}

// Free-tier hosts sleep when idle and refuse the first connections while waking (~30-60 s), so retry for ~75 s.
function online(first: object, tries = 0) {
  ws?.close(); peer?.close(); peer = null; net = null;
  if (!tries) status.textContent = 'Connecting…';
  const sock = new WebSocket(SERVER);
  ws = sock;
  let opened = false;
  sock.onopen = () => { opened = true; sock.send(JSON.stringify(first)); };
  sock.onerror = () => {
    if (opened || ws !== sock) return;
    if (tries >= 30) { status.textContent = `Can't reach server ${SERVER}`; return; }
    status.textContent = 'Waking up server… (can take up to a minute)';
    setTimeout(() => ws === sock && online(first, tries + 1), 2500);
  };
  sock.onclose = () => { if (mode === 'online') { banner = 'Connection closed'; } };
  sock.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'ping') sock.send('{"t":"pong"}');
    else if (m.t === 'room') status.textContent = `Room ${m.code} — share this code, waiting for opponent…`;
    else if (m.t === 'error') status.textContent = m.msg;
    else if (m.t === 'start') {
      status.textContent = 'Opponent found — connecting…';
      const seat = m.seat;
      peer = linkPeer(sock, seat, m.delay, FORCE_RELAY, (d) => net?.onMessage(d), (send, delay, label) => {
        net = new Netplay(send, seat, delay);
        link = `${label} · ${delay}f delay`;
        renderer.setNames(seat === 0 ? ['YOU', 'RIVAL'] : ['RIVAL', 'YOU']);
        start('online');
      });
    } else if (m.t === 'sdp' || m.t === 'ice' || m.t === 'go') peer?.signal(m);
    else if (m.t === 'left') banner = 'Opponent left';
    else net?.onMessage(m);
  };
}

$('local').onclick = () => { ws?.close(); peer?.close(); net = null; renderer.setNames(['P1', 'P2']); start('local'); };
$('host').onclick = () => online({ t: 'host' });
$('join').onclick = () => online({ t: 'join', code: $<HTMLInputElement>('code').value.trim() });
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && mode !== 'menu') { ws?.close(); peer?.close(); net = null; status.textContent = ''; start('menu'); }
});

const DT = 1000 / 60;
let acc = 0, last = performance.now();
function frame(now: number) {
  acc = Math.min(acc + now - last, 250); last = now;
  while (acc >= DT) {
    acc -= DT;
    if (mode === 'local') advance(localInputs());
    else if (mode === 'online' && net && !banner) net.tick(soloInput, advance, () => hash(state));
  }
  const b = banner || (net?.desync ? 'DESYNC detected' : net?.stalled && state.frame > 10 ? 'waiting for opponent…' : '');
  renderer.draw(state, mode === 'online' ? b : banner, mode === 'online' ? link : '');
  requestAnimationFrame(frame);
}
(globalThis as any).__net = () => ({ net, link, frame: state.frame }); // debug/test hook
requestAnimationFrame(frame);
