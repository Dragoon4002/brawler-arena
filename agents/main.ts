// AI bettors + commentator for Brawler Arena. Watches live rooms, replays the input tape with the client sim,
// asks NEAR AI Cloud (or a heuristic) for trades/commentary, buys on-chain, chats rationale into the room.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { Account, JsonRpcProvider, nearToYocto, yoctoToNear } from 'near-api-js';
import { newGame, step, type GameState } from '../games/brawler/client/src/lib/sim/sim.ts';
import { sanitize, statsOf } from '../games/brawler/client/src/lib/genes.ts';
import { STAGE_IDS } from '../games/brawler/client/src/lib/stages.ts';
import { PERSONAS, commentPrompt, heuristic, parseJson, prompt, template, validate, type Budget, type Decision, type Moment, type Persona, type View } from './brain.ts';
import { LLM_ON, MODEL, chat } from './llm.ts';

const env = process.env;
const SERVER = env.SERVER_URL ?? 'wss://65-0-237-185.sslip.io';
const CONTRACT = env.CONTRACT_ID ?? 'brawler-platform-5c8e2b.testnet';
const DRY = env.DRY_RUN === '1';
const EXPOSURE = Number(env.MAX_EXPOSURE ?? 0.3); // NEAR per agent per match
const MAX_BET = Number(env.MAX_BET ?? 0.1);
const TRADE_GAP = Number(env.TRADE_GAP_S ?? 15) * 1000;
const SAY_GAP = 6000;
const CASTER = env.COMMENTATOR_NAME ?? 'AI Commentator';
const CREDS = env.CREDENTIALS_DIR ?? `${homedir()}/.near-credentials/testnet`;
const GAS = 30_000_000_000_000n;

const rpc = new JsonRpcProvider({ url: env.NEAR_RPC ?? 'https://test.rpc.fastnear.com' });
const view = <T>(method: string, args: object) => rpc.callFunction({ contractId: CONTRACT, method, args: args as Record<string, unknown> }) as Promise<T>;
const near = (yocto: string | bigint) => Number(yoctoToNear(BigInt(yocto)));
const yocto = (n: number) => nearToYocto(n.toFixed(4) as `${number}`);
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---------- agents ---------- */

interface Bettor { persona: Persona; id: string; acct: Account | null }
const spec: Record<string, string | { account: string; key?: string }> = env.AGENT_ACCOUNTS
  ? JSON.parse(env.AGENT_ACCOUNTS)
  : Object.fromEntries(Object.keys(PERSONAS).map((p) => [p, `ai-${p.toLowerCase()}.${CONTRACT}`]));
const keyOf = (id: string) => { try { return JSON.parse(readFileSync(`${CREDS}/${id}.json`, 'utf8')).private_key as string; } catch { return null; } };
const bettors: Bettor[] = Object.entries(spec).filter(([p]) => p in PERSONAS).map(([p, s]) => {
  const id = typeof s === 'string' ? s : s.account;
  const key = (typeof s === 'string' ? null : s.key) ?? keyOf(id);
  if (!key && !DRY) log(`[${p}] no key for ${id}, disabled (dry-run only)`);
  return { persona: p as Persona, id, acct: key ? new Account(id, rpc, key as `ed25519:${string}`) : null };
});
let minBet = 0.01;

/* ---------- rooms ---------- */

interface Room {
  code: string; matchId: number | null; bettable: boolean; names: [string, string];
  game: GameState | null; price0: number; done: boolean;
  socks: WebSocket[]; say: Map<string, (t: string) => void>;
  stake: Map<string, { spent: number; last: number; busy: boolean; next: number }>;
  lastSay: number; priceAt: number; ticks: number; pending: Moment | null; dmgMark: [number, number]; behind: [boolean, boolean];
  timer?: ReturnType<typeof setInterval>;
}
const rooms = new Map<string, Room>();

function sock(code: string, account: string, onMsg?: (m: any) => void) {
  const ws = new WebSocket(SERVER);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'watch', code, account }));
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.t === 'ping') ws.send('{"t":"pong"}');
    else if (m.t === 'error') log(`[${code}] ${account}: ${m.msg}`);
    else onMsg?.(m);
  };
  return { ws, say: (text: string) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: 'chat', text })) };
}

const snapshot = (r: Room): View | null => r.game && {
  fighters: r.game.fighters.map((f, i) => ({ name: r.names[i], stocks: f.stocks, damage: f.damage })) as View['fighters'],
  secs: r.game.frame / 60, price0: r.price0,
};

const PRIO = { start: 1, swing: 2, ko: 3, comeback: 4, over: 5 }; // comeback = KO that levels the score
const queue = (r: Room, kind: Moment['kind'], who = 0, winner?: number | null) => {
  const v = snapshot(r);
  if (v && (!r.pending || PRIO[kind] >= PRIO[r.pending.kind])) r.pending = { kind, who, v, winner };
};

function watch(code: string, row: any) {
  const r: Room = {
    code, matchId: row.matchId ?? null, bettable: !!row.bettable, names: ['P1', 'P2'], game: null, price0: 0.5, done: false,
    socks: [], say: new Map(), stake: new Map(), lastSay: 0, priceAt: 0, ticks: 0, pending: null, dmgMark: [0, 0], behind: [false, false],
  };
  rooms.set(code, r);
  const tradable = r.bettable && r.matchId != null;
  log(`[${code}] watching (match ${r.matchId ?? '-'}, ${tradable ? 'bettable' : 'free'})`);
  const caster = sock(code, CASTER, (m) => {
    if (m.t === 'spec') {
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
      speak(r).finally(() => setTimeout(() => close(r), 2000));
      settle(r);
    }
  });
  r.socks.push(caster.ws);
  r.say.set(CASTER, caster.say);
  caster.ws.onclose = () => close(r);
  if (tradable || DRY) for (const b of bettors) {
    if (!b.acct && !DRY) continue;
    const s = sock(code, b.id);
    r.socks.push(s.ws);
    r.say.set(b.id, s.say);
    r.stake.set(b.id, { spent: 0, last: 0, busy: false, next: Date.now() + 5000 + Math.random() * 10_000 });
  }
  r.timer = setInterval(() => tick(r).catch((e) => log(`[${code}] tick`, e.message)), 1000);
}

function close(r: Room) {
  if (!rooms.has(r.code)) return;
  clearInterval(r.timer);
  r.socks.forEach((s) => s.close());
  rooms.delete(r.code);
  log(`[${r.code}] closed`);
}

async function tick(r: Room) {
  if (!r.game || r.done) return;
  const now = Date.now();
  const f = r.game.fighters;
  if (now - r.priceAt > 4000 && r.matchId != null) {
    r.priceAt = now;
    const m = await view<{ price_bps: number } | null>('get_match', { match_id: r.matchId }).catch(() => null);
    if (m) r.price0 = m.price_bps / 10000;
  }
  if (r.ticks++ % 3 === 0) { // every 3 s: damage swing check
    f.forEach((x, i) => { if (x.damage - r.dmgMark[i] >= 40) queue(r, 'swing', i); r.dmgMark[i] = x.damage; });
  }
  speak(r);
  for (const b of bettors) {
    const st = r.stake.get(b.id);
    if (st && !st.busy && now >= st.next) { st.busy = true; trade(r, b).finally(() => { st.busy = false; st.next = Date.now() + TRADE_GAP + Math.random() * 5000; }); }
  }
}

async function speak(r: Room) {
  const m = r.pending, now = Date.now();
  if (!m || (now - r.lastSay < SAY_GAP && m.kind !== 'over')) return;
  r.pending = null;
  r.lastSay = now;
  const line = (await chat(commentPrompt(m)))?.replace(/^["']|["']$/g, '').slice(0, 180) || template(m);
  log(`[${r.code}] ${CASTER}: ${line}`);
  r.say.get(CASTER)?.(line);
}

async function trade(r: Room, b: Bettor) {
  const v = snapshot(r), st = r.stake.get(b.id)!;
  if (!v || Date.now() - st.last < TRADE_GAP) return;
  const budget: Budget = { minBet, maxBet: MAX_BET, left: EXPOSURE - st.spent };
  if (budget.left < minBet) return;
  const raw = await chat(prompt(b.persona, v, budget), true);
  const d: Decision = (raw && validate(parseJson(raw), budget)) || heuristic(b.persona, v, budget);
  const src = raw ? 'llm' : 'heuristic';
  if (d.action === 'hold') return log(`[${r.code}] ${b.persona} holds (${src}): ${d.reason}`);
  const side = r.names[d.side];
  let ok = DRY;
  if (!DRY && b.acct && r.matchId != null) {
    try {
      const amt = yocto(d.amount);
      const bal = BigInt(await view<string>('balance_of', { account_id: b.id }));
      if (bal < amt) return log(`[${r.code}] ${b.persona} balance too low (${near(bal)} NEAR)`);
      const q = await view<string>('quote_buy', { match_id: r.matchId, side: d.side, amount: amt.toString() });
      const minOut = (BigInt(q) * 97n / 100n).toString();
      await b.acct.callFunction({ contractId: CONTRACT, methodName: 'buy', args: { match_id: r.matchId, side: d.side, amount: amt.toString(), min_out: minOut }, deposit: 1n, gas: GAS });
      ok = true;
    } catch (e) { log(`[${r.code}] ${b.persona} buy failed: ${(e as Error).message.slice(0, 160)}`); }
  }
  if (!ok) return;
  st.spent += d.amount;
  st.last = Date.now();
  log(`[${r.code}] ${b.persona} ${DRY ? 'WOULD BUY' : 'bought'} ${d.amount} NEAR on ${side} (${src}): ${d.reason}`);
  r.say.get(b.id)?.(`${DRY ? '(dry-run) ' : ''}[${b.persona} AI] ${d.amount} NEAR on ${side}: ${d.reason}`);
}

// Referee settles on-chain shortly after `over`; poll claimable a few times.
function settle(r: Room) {
  if (DRY || r.matchId == null) return;
  for (const b of bettors) {
    if (!b.acct || !r.stake.get(b.id)?.spent) continue;
    const id = r.matchId;
    const attempt = async (n: number) => {
      const due = BigInt(await view<string>('claimable', { match_id: id, account_id: b.id }).catch(() => '0'));
      if (due > 0n) {
        await b.acct!.callFunction({ contractId: CONTRACT, methodName: 'claim', args: { match_id: id }, gas: GAS })
          .then(() => log(`[match ${id}] ${b.persona} claimed ${near(due)} NEAR`), (e) => log(`[match ${id}] ${b.persona} claim failed: ${e.message}`));
      } else if (n < 6) setTimeout(() => attempt(n + 1), 20_000 * (n + 1));
      else log(`[match ${id}] ${b.persona} nothing to claim`);
    };
    setTimeout(() => attempt(0), 10_000);
  }
}

/* ---------- lobby ---------- */

function lobby() {
  const ws = new WebSocket(SERVER);
  ws.onopen = () => { log(`lobby connected ${SERVER}`); ws.send('{"t":"lobby"}'); };
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.t === 'ping') return ws.send('{"t":"pong"}');
    if (m.t !== 'lobby') return;
    log(`lobby: ${m.rooms.length} room(s) ${m.rooms.map((x: any) => `${x.code}:${x.status}${x.bettable ? '$' : ''}`).join(' ')}`);
    for (const row of m.rooms) if (row.status === 'live' && !rooms.has(row.code)) watch(row.code, row);
  };
  ws.onclose = () => { log('lobby closed, reconnecting'); setTimeout(lobby, 3000); };
  ws.onerror = () => {};
}

log(`agents up: ${LLM_ON ? `NEAR AI Cloud model ${MODEL}` : 'HEURISTIC mode (no NEAR_AI_API_KEY)'}${DRY ? ', DRY_RUN' : ''}, contract ${CONTRACT}`);
log('bettors:', bettors.map((b) => `${b.persona}=${b.id}${b.acct ? '' : ' (no key)'}`).join(', '));
view<{ min_bet: string }>('config', {}).then((c) => { minBet = near(c.min_bet); }, () => {});
lobby();
