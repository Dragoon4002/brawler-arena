// Demo mode (?demo in the URL): every screen renders with fake data, no wallet, no server, no opponent.
import { IN, type GameState } from './sim/sim.ts';
import { randomDna, nameFor } from './genes.ts';
import type { FeedItem, LotView, MatchView, PositionView } from './near.ts';
import { Market, ONE } from './market.ts';

export const DEMO = new URLSearchParams(location.search).has('demo');
export const DEMO_ACCOUNT = 'demo-player.testnet';
const NEAR = (n: number) => (BigInt(Math.round(n * 1000)) * 10n ** 21n).toString();
const mon = (seed: number) => ({ name: nameFor(seed), dna: randomDna(seed), account: `${nameFor(seed).toLowerCase()}.testnet` });

export const DEMO_ROOMS = [
  { code: 'LIVE', pub: true, status: 'live', stage: 'ember', bettable: true, matchId: 1, stake: NEAR(0.5), winner: null, watchers: 14, players: [mon(11), mon(12)] },
  { code: 'GROV', pub: false, status: 'live', stage: 'grove', bettable: true, matchId: 2, stake: NEAR(2), winner: null, watchers: 3, players: [mon(21), mon(22)] },
  { code: 'OPEN', pub: true, status: 'waiting', stage: 'docks', bettable: true, matchId: 3, stake: NEAR(0.1), winner: null, watchers: 0, players: [mon(31)] },
  { code: 'FREE', pub: true, status: 'waiting', stage: 'ember', bettable: false, matchId: null, stake: '0', winner: null, watchers: 1, players: [mon(41)] },
] as const;

// amm = pool's [A, B] shares; fighter 0's price = b / (a + b).
const match = (id: number, status: MatchView['status'], amm: [number, number], kos = 1): MatchView => ({
  id, host: DEMO_ROOMS[0].players[0].account, guest: DEMO_ROOMS[0].players[1].account, stake: NEAR(0.5), bettable: true,
  status, winner: status === 'settled' ? 0 : null, kos, amm: [NEAR(amm[0]), NEAR(amm[1])], price_bps: amm[0] + amm[1] ? Math.round((amm[1] / (amm[0] + amm[1])) * 1e4) : 5000,
  collateral: NEAR(Math.max(...amm)), created_ms: Date.now() - 600_000, started_ms: Date.now() - 300_000,
});
const MATCHES: MatchView[] = [
  match(1, 'live', [4.1, 6.2]),
  match(4, 'settled', [3, 8]), match(5, 'refund', [5, 5]),
  { ...match(6, 'open', [0, 0], 0), host: DEMO_ACCOUNT },
  { ...match(7, 'live', [0, 0], 0), started_ms: Date.now() - 3 * 3600_000, host: DEMO_ACCOUNT },
];
const wait = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 400));
const sent = (what: string) => { alert(`Demo: ${what}. In the real app your wallet asks you to confirm.`); return wait(null); };
// Match 1 (room LIVE) is a real market run in the browser with the contract's math: bots trade every few
// seconds, your Long/Short/Close move the price, and the demo fight's result settles it.
export const LIVE = new Market(5n * ONE);
const BOTS = ['fan-ana.testnet', 'fan-bo.testnet', 'fan-cy.testnet', 'fan-dee.testnet', 'fan-eli.testnet'];
let lead = 0.3;
const botTrade = (t: number) => {
  lead += (Math.random() - 0.5) * 0.5;
  const who = BOTS[Math.floor(Math.random() * BOTS.length)];
  try {
    LIVE.buy(who, Math.random() < 1 / (1 + Math.exp(-lead * 2)) ? 0 : 1, BigInt(Math.round((0.05 + Math.random() ** 2 * 1.5) * 1000)) * (ONE / 1000n), 0n, t);
  } catch { /* skipped */ }
};
if (DEMO) {
  for (let i = 0; i < 30; i++) botTrade(Date.now() - (30 - i) * 8000); // the last 4 minutes of trading
  LIVE.buy(DEMO_ACCOUNT, 0, ONE, 0n, Date.now() - 60_000); // you already hold some fighter-1 shares
  setInterval(() => LIVE.status === 'live' && botTrade(Date.now()), 3000);
}
const liveView = (): MatchView => ({
  ...match(1, LIVE.status, [0, 0]), winner: LIVE.winner, amm: [LIVE.amm[0].toString(), LIVE.amm[1].toString()], price_bps: LIVE.price, collateral: LIVE.collateral.toString(),
});
const posView = (p = LIVE.pos(DEMO_ACCOUNT)): PositionView | null => p ? { shares: [p.shares[0].toString(), p.shares[1].toString()], paid: p.paid.toString(), claimed: p.claimed } : null;
/** Demo fight ended: settle the market (null = void). */
export const demoSettle = (id: number | null, winner: number | null) => { if (id === 1 && LIVE.status === 'live') LIVE.finish(winner); };
const POS: Record<number, PositionView> = {
  4: { shares: [NEAR(3), '0'], paid: NEAR(1), claimed: false },
};
const tx = <T,>(f: () => T) => wait(null).then(f); // wallet round trip, then the call

// Same shape as useArena(): views return canned data, calls just announce themselves.
export const demoArena = {
  ready: true, account: DEMO_ACCOUNT, signIn: async () => {},
  createMatch: async () => { await sent('match created and stake escrowed'); return 99; },
  joinMatch: () => sent('stake matched, joining'),
  cancelMatch: () => sent('match cancelled, stake refunded'),
  buy: (id: number, side: number, yocto: string, minOut: string, meta?: { card: number; dir: 'long' | 'short' }) => id === 1 ? tx(() => LIVE.buy(DEMO_ACCOUNT, side, BigInt(yocto), BigInt(minOut), Date.now(), meta)) : sent('position opened'),
  getLots: (id: number): Promise<LotView[]> => wait(id !== 1 ? [] : (LIVE.lots.get(DEMO_ACCOUNT) ?? []).map((l) => ({ ...l, shares: l.shares.toString(), cost: l.cost.toString() }))),
  claim: (id: number) => id === 1 ? tx(() => LIVE.claim(DEMO_ACCOUNT)) : sent('winnings sent to your wallet'),
  expire: () => sent('match released for refund'),
  getMatch: (id: number) => wait(id === 1 ? liveView() : MATCHES.find((m) => m.id === id) ?? match(id, 'live', [5, 5])),
  getPosition: (id: number): Promise<PositionView | null> => wait(id === 1 ? posView() : POS[id] ?? null),
  getPrices: (id: number): Promise<[number, number][]> => wait(id === 1 ? LIVE.history.map(([t, b]) => [t, b]) : [[Date.now() - 60_000, 5000], [Date.now(), MATCHES.find((m) => m.id === id)?.price_bps ?? 5000]]),
  quoteBuy: (id: number, side: number, yocto: string) => wait((id === 1 ? LIVE : new Market(5n * ONE)).quoteBuy(side, BigInt(yocto)).toString()),
  config: () => wait({ min_bet: NEAR(0.01), max_bet: NEAR(100), seed: NEAR(5) }),
  getFeed: (id: number): Promise<FeedItem[]> => wait(id !== 1 ? [] : LIVE.ledger.map((e, i) => ({ e, i })).filter(({ e }) => e.kind === 'buy' || e.kind === 'payout' || e.kind === 'refund')
    .slice(-6).reverse().map(({ e, i }) => ({ id: i, who: e.who, kind: e.kind as FeedItem['kind'], side: e.side, near: e.near.toString() }))),
  claimable: (id: number) => wait(id === 1 ? LIVE.due(DEMO_ACCOUNT).toString() : id === 4 ? NEAR(3) : id === 5 ? NEAR(0.3) : '0'),
  listMatches: () => wait(MATCHES.map((m) => (m.id === 1 ? liveView() : m))),
};

// Tiny scripted fighter so demo fights move on their own: walk at the rival, swing when close, jump now and then.
export function bot(s: GameState, me: number) {
  const f = s.fighters[me], o = s.fighters[1 - me], dx = o.x - f.x, t = s.frame + me * 37;
  let b = Math.abs(dx) > 70 ? (dx > 0 ? IN.RIGHT : IN.LEFT) : 0;
  if (Math.abs(dx) < 90 && t % 24 < 2) b |= t % 96 < 24 ? IN.HEAVY : IN.LIGHT;
  if (o.y < f.y - 80 && t % 30 === 0) b |= IN.JUMP;
  if (f.x < 450 || f.x > 1150) b = (f.x < 800 ? IN.RIGHT : IN.LEFT) | (t % 20 === 0 ? IN.JUMP : 0); // stay on stage
  return b;
}
