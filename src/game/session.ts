// One fight on one canvas: local hot-seat or online (relay signaling + P2P/relay lockstep).
// The React <ArenaView> starts a session and calls stop() on unmount.
import { newGame, step, hash, IN, type GameState } from '../sim/sim.ts';
import { createRenderer } from '../render/draw.ts';
import { localInputs, soloInput } from '../input.ts';
import { Netplay, linkPeer } from '../net.ts';
import { lookOf, sanitize, statsOf, type Dna } from '../genes.ts';
import { STAGE_IDS, type StageId } from '../stages.ts';
import { music, playEvents } from '../audio.ts';
import { bot } from '../demo.ts';
import type { SignMatch } from '../near.ts';

export interface Player { name: string; dna: Dna }
export interface Hooks {
  status?: (text: string) => void; // lobby text (room code, connecting…)
  started?: (players: Player[], seat: number) => void;
  result?: (winnerSeat: number, kos: number[], seat: number) => void; // once per finished game; kos[i] = stocks player i took
  over?: (winner: number | null, reason: string) => void; // server referee verdict (online / spectate)
  room?: (info: { code: string; matchId: number | null; bettable: boolean; seat: number }) => void;
}
export interface HostOpts { pub: boolean; view: boolean; bettable: boolean; matchId: number | null; stake: string; account: string }

const params = new URLSearchParams(location.search);
const FORCE_RELAY = params.has('relay'); // ?relay -> skip P2P (debug fallback path)
export const SERVER = params.get('server') ?? import.meta.env.VITE_SERVER_URL ??
  (import.meta.env.DEV ? `ws://${location.hostname}:8787` : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);

function loop(canvas: HTMLCanvasElement, players: Player[], seat: number, stage: StageId, hooks: Hooks, tap?: (inputs: number[]) => void) {
  const renderer = createRenderer(canvas);
  let state: GameState = newGame(players.map((p) => statsOf(p.dna)), stage);
  let overFrames = 0, reported = false, raf = 0;
  let net: Netplay | null = null;
  let banner = '', link = '';
  let spectate: ((advance: (inputs: number[]) => void, s: GameState) => void) | null = null;
  renderer.setPlayers(players.map((p, i) => (seat < 0 ? p.name : i === seat ? `${p.name} (you)` : p.name)), players.map((p) => lookOf(p.dna)));

  // Shared by local + online so rematch is deterministic too.
  function advance(inputs: number[]) {
    if (seat === -1 && state.winner >= 0 && ++overFrames > 90 && inputs.every((b) => b & IN.JUMP)) { // rematch: local only
      state = newGame(players.map((p) => statsOf(p.dna)), stage); overFrames = 0; reported = false;
    }
    if (state.winner >= 0 && seat !== -1) return; // online/spectated match is over; server verdict decides
    tap?.(inputs);
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
      if (seat === -1) advance(localInputs()); // -1 local hot-seat, -2 spectator
      else if (net && !banner) net.tick(soloInput, advance, () => hash(state));
      else if (spectate) spectate(advance, state);
    }
    const b = banner || (seat !== -1 && state.winner >= 0 ? `${players[state.winner].name} wins` : net?.desync ? 'DESYNC detected' : net?.lagging ? 'waiting for opponent…' : '');
    renderer.draw(state, b, link);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  music(stage);
  (globalThis as any).__net = () => ({ net, link, frame: state.frame }); // debug/test hook

  return {
    attach(n: Netplay, label: string) { net = n; link = label; },
    feed(fn: (advance: (inputs: number[]) => void, s: GameState) => void) { spectate = fn; },
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
export function startOnline(canvas: HTMLCanvasElement, first: ({ t: 'host' } & HostOpts) | { t: 'join'; code: string; account: string; matchId: number | null } | { t: 'match'; matchId: number; account: string }, me: Player, stage: StageId, hooks: Hooks = {}, sign?: SignMatch) {
  let ws: WebSocket | null = null;
  let peer: ReturnType<typeof linkPeer> | null = null;
  let game: ReturnType<typeof loop> | null = null;
  let stopped = false;
  let hb: ReturnType<typeof setInterval> | undefined;
  const say = (t: string) => hooks.status?.(t);

  function connect(tries: number) {
    if (stopped) return;
    if (!tries) say('Connecting…');
    const sock = new WebSocket(SERVER);
    ws = sock;
    let opened = false;
    let code = '';
    let seat = -1, delay = 4;
    let net: Netplay | null = null;
    let theirStage: StageId = 'ember';
    let chain: Player[] | null = null; // server-sent seats (chain DNA); must win so our sim matches the referee's
    let theirs: Player | null = null, ready: { send: any; delay: number; label: string } | null = null;

    // Fight starts once we know the opponent's monster AND the input channel is up.
    const maybeStart = () => {
      if (!theirs || !ready || game) return;
      const players = chain ?? (seat === 0 ? [me, theirs] : [theirs, me]);
      // Mirror confirmed inputs to the server referee (packed host<<8|guest, 6-frame batches) + 1 s heartbeat.
      let batch: number[] = [], f0 = 0;
      const tap = (ins: number[]) => {
        batch.push((ins[0] << 8) | ins[1]);
        if (batch.length >= 6) { sock.send(JSON.stringify({ t: 'tape', f0, ins: batch })); f0 += batch.length; batch = []; }
      };
      hb = setInterval(() => sock.readyState === WebSocket.OPEN && sock.send('{"t":"hb"}'), 1000);
      game = loop(canvas, players, seat, seat === 0 ? stage : theirStage, hooks, tap);
      net = new Netplay(ready.send, seat, ready.delay);
      game.attach(net, `${ready.label} · ${ready.delay}f delay`);
      hooks.started?.(players, seat);
    };

    sock.onopen = () => { opened = true; };
    sock.onerror = () => {
      if (opened || ws !== sock || stopped) return;
      if (tries >= 30) return say(`Can't reach server ${SERVER}`);
      say('Waking up server… (can take up to a minute)');
      setTimeout(() => ws === sock && connect(tries + 1), 2500);
    };
    sock.onclose = () => { if (game) game.setBanner('Connection closed'); };
    sock.onmessage = async (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'ping') sock.send('{"t":"pong"}');
      else if (m.t === 'hello') { // on-chain seats prove the account: wallet signs the server's nonce (NEP-413)
        let auth;
        if (first.matchId != null && sign) {
          say('Sign the login message in your wallet…');
          try { auth = await sign(first.matchId, m.nonce); } catch { return say('Wallet signature needed to take your seat.'); }
        }
        sock.send(JSON.stringify({ ...first, name: me.name, dna: me.dna, stage, auth }));
      } else if (m.t === 'room') { code = m.code; seat = m.seat ?? 0; say(`Room ${m.code} — share this code. Waiting for opponent…`); hooks.room?.({ code: m.code, matchId: first.t === 'join' ? null : first.matchId, bettable: first.t === 'host' && first.bettable, seat }); }
      else if (m.t === 'error') say(m.msg);
      else if (m.t === 'start') {
        seat = m.seat; delay = m.delay;
        if (Array.isArray(m.players) && m.players.length === 2) chain = m.players.map((p: any) => ({ name: String(p.name ?? 'Rival').slice(0, 24) || 'Rival', dna: sanitize(p.dna) }));
        if (seat === 1 || first.t === 'match') hooks.room?.({ code: first.t === 'join' ? first.code : code, matchId: m.matchId ?? null, bettable: !!m.bettable, seat });
        say('Opponent found — connecting…');
        sock.send(JSON.stringify({ t: 'pick', name: me.name.slice(0, 24), dna: me.dna, stage }));
        peer = linkPeer(sock, seat, delay, FORCE_RELAY, (d) => net?.onMessage(d), (send, d, label) => { ready = { send, delay: d, label }; maybeStart(); });
      } else if (m.t === 'pick') {
        theirs = { name: String(m.name ?? 'Rival').slice(0, 24) || 'Rival', dna: sanitize(m.dna) };
        theirStage = STAGE_IDS.includes(m.stage) ? m.stage : 'ember';
        maybeStart();
      } else if (m.t === 'sdp' || m.t === 'ice' || m.t === 'go') peer?.signal(m);
      else if (m.t === 'left') game?.setBanner('Opponent left. They forfeit after 30 s.');
      else if (m.t === 'over') { hooks.over?.(m.winner, m.reason); if (m.reason !== 'ko') game?.setBanner(verdict(m.winner, m.reason, seat)); }
      else net?.onMessage(m);
    };
  }

  connect(0);
  return { stop() { stopped = true; clearInterval(hb); ws?.close(); peer?.close(); game?.stop(); } };
}

const verdict = (winner: number | null, reason: string, seat: number) =>
  winner === null ? `Match void (${reason}). Stakes and bets refunded.` : winner === seat ? `You win (${reason})` : `You lose (${reason})`;

// Watch a live fight: replay the server's confirmed input tape with the same sim. Small jitter buffer.
export function startSpectate(canvas: HTMLCanvasElement, code: string, hooks: Hooks & { info?: (spec: any) => void } = {}) {
  const sock = new WebSocket(SERVER);
  let game: ReturnType<typeof loop> | null = null;
  const queue: number[][] = [];
  let buffering = true;
  sock.onopen = () => sock.send(JSON.stringify({ t: 'watch', code }));
  sock.onerror = () => hooks.status?.(`Can't reach server ${SERVER}`);
  sock.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'error') hooks.status?.(m.msg);
    else if (m.t === 'spec') {
      hooks.info?.(m);
      game?.stop(); queue.length = 0; buffering = true; // fresh spec (room went live with final DNA): rebuild
      const players = m.players.map((p: any) => ({ name: p.name, dna: sanitize(p.dna) }));
      if (players.length < 2) { hooks.status?.('Waiting for a challenger…'); players.push({ name: '???', dna: players[0].dna }); }
      game = loop(canvas, players, -2, STAGE_IDS.includes(m.stage) ? m.stage : 'ember', hooks);
      // Catch up instantly on everything played so far, then stream.
      queue.push(...m.frames);
      game.feed((advance) => {
        if (buffering && queue.length < 12 && m.status === 'live') return; // ~200 ms cushion
        buffering = false;
        const n = queue.length > 60 ? queue.length - 30 : queue.length > 20 ? 2 : queue.length ? 1 : 0;
        for (let i = 0; i < n; i++) advance(queue.shift()!);
        if (!queue.length) buffering = true;
      });
      hooks.started?.(players, -2);
    } else if (m.t === 'frames') queue.push(...m.ins);
    else if (m.t === 'over') { hooks.over?.(m.winner, m.reason); if (m.reason !== 'ko') game?.setBanner(m.winner === null ? 'Match void, bets refunded' : `Winner by ${m.reason}`); }
  };
  return { stop() { sock.close(); game?.stop(); } };
}

// Demo: two scripted bots fight on their own (no input, no network).
export function startBotFight(canvas: HTMLCanvasElement, players: Player[], stage: StageId, hooks: Hooks = {}) {
  const game = loop(canvas, players, -2, stage, hooks);
  game.feed((advance, s) => advance([bot(s, 0), bot(s, 1)]));
  hooks.started?.(players, -2);
  return game;
}
