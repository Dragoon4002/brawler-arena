// One fight on one canvas: local hot-seat or online (relay signaling + P2P/relay lockstep).
// The React <ArenaView> starts a session and calls stop() on unmount.
import { newGame, step, hash, IN, type GameState } from '../sim/sim.ts';
import { createRenderer } from '../render/draw.ts';
import { localInputs, soloInput } from '../input.ts';
import { Netplay, linkPeer } from '../net.ts';
import { lookOf, sanitize, statsOf, type Dna } from '../genes.ts';
import { STAGE_IDS, type StageId } from '../stages.ts';
import { music, playEvents } from '../audio.ts';

export interface Player { name: string; dna: Dna }
export interface Hooks {
  status?: (text: string) => void; // lobby text (room code, connecting…)
  started?: (players: Player[], seat: number) => void;
  result?: (winnerSeat: number, kos: number[], seat: number) => void; // once per finished game; kos[i] = stocks player i took
}

const params = new URLSearchParams(location.search);
const FORCE_RELAY = params.has('relay'); // ?relay -> skip P2P (debug fallback path)
export const SERVER = params.get('server') ?? import.meta.env.VITE_SERVER_URL ??
  (import.meta.env.DEV ? `ws://${location.hostname}:8787` : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);

function loop(canvas: HTMLCanvasElement, players: Player[], seat: number, stage: StageId, hooks: Hooks) {
  const renderer = createRenderer(canvas);
  let state: GameState = newGame(players.map((p) => statsOf(p.dna)), stage);
  let overFrames = 0, reported = false, raf = 0;
  let net: Netplay | null = null;
  let banner = '', link = '';
  renderer.setPlayers(players.map((p, i) => (seat < 0 ? p.name : i === seat ? `${p.name} (you)` : p.name)), players.map((p) => lookOf(p.dna)));

  // Shared by local + online so rematch is deterministic too.
  function advance(inputs: number[]) {
    if (state.winner >= 0 && ++overFrames > 90 && inputs.every((b) => b & IN.JUMP)) {
      state = newGame(players.map((p) => statsOf(p.dna)), stage); overFrames = 0; reported = false;
    }
    step(state, inputs);
    renderer.onEvents(state.events);
    playEvents(state, seat);
    if (state.winner >= 0 && !reported) { reported = true; hooks.result?.(state.winner, state.fighters.map((_, i) => 3 - state.fighters[1 - i].stocks), seat); }
  }

  const DT = 1000 / 60;
  let acc = 0, last = performance.now();
  function frame(now: number) {
    acc = Math.min(acc + now - last, 250); last = now;
    while (acc >= DT) {
      acc -= DT;
      if (seat < 0) advance(localInputs());
      else if (net && !banner) net.tick(soloInput, advance, () => hash(state));
    }
    const b = banner || (net?.desync ? 'DESYNC detected' : net?.stalled && state.frame > 10 ? 'waiting for opponent…' : '');
    renderer.draw(state, b, link);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  music(stage);
  (globalThis as any).__net = () => ({ net, link, frame: state.frame }); // debug/test hook

  return {
    attach(n: Netplay, label: string) { net = n; link = label; },
    setBanner(t: string) { banner = t; },
    stop() { cancelAnimationFrame(raf); renderer.destroy(); music(null); },
  };
}

export function startLocal(canvas: HTMLCanvasElement, players: [Player, Player], stage: StageId, hooks: Hooks = {}) {
  hooks.started?.(players, -1);
  return loop(canvas, players, -1, stage, hooks);
}

// Free-tier hosts sleep when idle and refuse the first connections while waking (~30-60 s), so retry for ~75 s.
// The host's arena wins; the guest's choice is ignored.
export function startOnline(canvas: HTMLCanvasElement, first: { t: 'host' } | { t: 'join'; code: string }, me: Player, stage: StageId, hooks: Hooks = {}) {
  let ws: WebSocket | null = null;
  let peer: ReturnType<typeof linkPeer> | null = null;
  let game: ReturnType<typeof loop> | null = null;
  let stopped = false;
  const say = (t: string) => hooks.status?.(t);

  function connect(tries: number) {
    if (stopped) return;
    if (!tries) say('Connecting…');
    const sock = new WebSocket(SERVER);
    ws = sock;
    let opened = false;
    let seat = -1, delay = 4;
    let net: Netplay | null = null;
    let theirStage: StageId = 'ember';
    let theirs: Player | null = null, ready: { send: any; delay: number; label: string } | null = null;

    // Fight starts once we know the opponent's monster AND the input channel is up.
    const maybeStart = () => {
      if (!theirs || !ready || game) return;
      const players = seat === 0 ? [me, theirs] : [theirs, me];
      game = loop(canvas, players, seat, seat === 0 ? stage : theirStage, hooks);
      net = new Netplay(ready.send, seat, ready.delay);
      game.attach(net, `${ready.label} · ${ready.delay}f delay`);
      hooks.started?.(players, seat);
    };

    sock.onopen = () => { opened = true; sock.send(JSON.stringify(first)); };
    sock.onerror = () => {
      if (opened || ws !== sock || stopped) return;
      if (tries >= 30) return say(`Can't reach server ${SERVER}`);
      say('Waking up server… (can take up to a minute)');
      setTimeout(() => ws === sock && connect(tries + 1), 2500);
    };
    sock.onclose = () => { if (game) game.setBanner('Connection closed'); };
    sock.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'ping') sock.send('{"t":"pong"}');
      else if (m.t === 'room') say(`Room ${m.code} — share this code. Waiting for opponent…`);
      else if (m.t === 'error') say(m.msg);
      else if (m.t === 'start') {
        seat = m.seat; delay = m.delay;
        say('Opponent found — connecting…');
        sock.send(JSON.stringify({ t: 'pick', name: me.name.slice(0, 24), dna: me.dna, stage }));
        peer = linkPeer(sock, seat, delay, FORCE_RELAY, (d) => net?.onMessage(d), (send, d, label) => { ready = { send, delay: d, label }; maybeStart(); });
      } else if (m.t === 'pick') {
        theirs = { name: String(m.name ?? 'Rival').slice(0, 24) || 'Rival', dna: sanitize(m.dna) };
        theirStage = STAGE_IDS.includes(m.stage) ? m.stage : 'ember';
        maybeStart();
      } else if (m.t === 'sdp' || m.t === 'ice' || m.t === 'go') peer?.signal(m);
      else if (m.t === 'left') game?.setBanner('Opponent left');
      else net?.onMessage(m);
    };
  }

  connect(0);
  return { stop() { stopped = true; ws?.close(); peer?.close(); game?.stop(); } };
}
