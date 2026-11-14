import { IN, type GameState } from './sim/sim.ts';
import { randomDna, nameFor } from './genes.ts';
import type { FeedItem, LotView, MatchView, PositionView, TournamentView } from './near.ts';
import type { HistoryEntry, MonstersApi, NftMonster } from './nft.ts';
import { breedPair, monsters as storeMonsters } from './store.ts';
import { Market, ONE } from './market.ts';

export const DEMO = new URLSearchParams(location.search).has('demo');
export const DEMO_ACCOUNT = 'demo-player.testnet';
export const DEMO_BALANCE = (25n * 10n ** 24n).toString(); // 25 NEAR
const NEAR = (n: number) => (BigInt(Math.round(n * 1000)) * 10n ** 21n).toString();
const mon = (seed: number) => ({ name: nameFor(seed), dna: randomDna(seed), account: `${nameFor(seed).toLowerCase()}.testnet` });

export const DEMO_ROOMS = [
  { code: 'LIVE', pub: true, status: 'live', stage: 'ember', bettable: true, matchId: 1, stake: NEAR(0.5), winner: null, watchers: 14, players: [mon(11), mon(12)] },
  { code: 'GROV', pub: false, status: 'live', stage: 'grove', bettable: true, matchId: 2, stake: NEAR(2), winner: null, watchers: 3, players: [mon(21), mon(22)] },
  { code: 'OPEN', pub: true, status: 'waiting', stage: 'docks', bettable: true, matchId: 3, stake: NEAR(0.1), winner: null, watchers: 0, players: [mon(31)] },
  { code: 'FREE', pub: true, status: 'waiting', stage: 'ember', bettable: false, matchId: null, stake: '0', winner: null, watchers: 1, players: [mon(41)] },
] as const;

// Canned chat for the room lobby / watch demos.
export const demoChat = (a: string, b: string) => [
  [a, 0, 'gl hf!'], [b, 1, 'you too. no heavy spam pls'], ['fan-ana.testnet', -1, 'backing the blue one'], [a, 0, 'arena ok?'], [b, 1, 'docks plz'], ['Spectator', -1, 'this is gonna be close'],
].map(([from, seat, text], i, l) => ({ from: from as string, seat: seat as number, text: text as string, ts: Date.now() - (l.length - i) * 25_000 }));

// amm = pool's [A, B] shares; fighter 0's price = b / (a + b).
const match = (id: number, status: MatchView['status'], amm: [number, number], kos = 1): MatchView => ({
  id, game: 'brawler', host: DEMO_ROOMS[0].players[0].account, guest: DEMO_ROOMS[0].players[1].account, stake: NEAR(0.5), bettable: true,
  status, winner: status === 'settled' ? 0 : null, kos, amm: [NEAR(amm[0]), NEAR(amm[1])], price_bps: amm[0] + amm[1] ? Math.round((amm[1] / (amm[0] + amm[1])) * 1e4) : 5000,
  collateral: NEAR(Math.max(...amm)), created_ms: Date.now() - 600_000, started_ms: Date.now() - 300_000,
  monsters: [null, null], tournament: null,
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

// In-memory NFTs, seeded from the localStorage collection so Collection shows your demo monsters.
const HOUR = 3600_000, DAY = 24 * HOUR;
const fake = (seed: number, owner: string, extra: Partial<NftMonster> = {}): NftMonster => ({
  id: `d${seed}`, name: nameFor(seed), gen: seed % 3, parents: null, born: Date.now() - (seed % 9 + 1) * DAY,
  record: { w: seed % 7, l: seed % 4, ko: seed % 5 }, dna: randomDna(seed), owner, breeder: owner, titles: [],
  lockedUntil: 0, cooldownUntil: 0, ...extra,
});
const OTHERS = [61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72].map((n) => fake(n, `${nameFor(n).toLowerCase()}.testnet`));
const NFTS: NftMonster[] = [];
const seasonEnd = Date.now() + 5 * DAY;
if (DEMO) {
  storeMonsters().forEach((m, i) => NFTS.push({
    ...m, owner: DEMO_ACCOUNT, breeder: DEMO_ACCOUNT, titles: i === 0 ? ['Season 1 Runner-up', 'Tournament #3 Champion'] : [], lockedUntil: 0, cooldownUntil: 0,
  }));
  NFTS.push(
    ...OTHERS.slice(0, 4).map((m, i) => ({ ...m, price: NEAR([0.5, 1, 2.5, 4][i]) })), // for sale
    ...OTHERS.slice(4, 7).map((m, i) => ({ ...m, rentOffer: { pricePerDay: NEAR([0.05, 0.1, 0.2][i]), maxDays: [3, 7, 14][i] } })), // for rent
    ...OTHERS.slice(7),
  );
}
const find = (id: string) => NFTS.find((m) => m.id === id) ?? null;
const patch = (id: string, p: Partial<NftMonster>) => { const m = find(id); if (m) Object.assign(m, { ...p }); };
const mineNow = () => NFTS.filter((m) => m.owner === DEMO_ACCOUNT || (m.rental && m.rental.renter === DEMO_ACCOUNT && m.rental.untilMs > Date.now()));
const HIST: Record<string, HistoryEntry[]> = {};
const histOf = (id: string): HistoryEntry[] => HIST[id] ??= [3, 2, 1, 0].map((n) => ({
  match_id: 40 + n, vs: OTHERS[(n + id.length) % OTHERS.length].id, won: n === 2 ? false : n === 0 ? null : true, kos: n === 2 ? 0 : 1 + (n % 2),
  ms: Date.now() - (n + 1) * 5 * HOUR, tournament: n === 3 ? 3 : null,
}));
const season = () => ({ id: 1, name: 'Season 1', ends_ms: seasonEnd, active: true });
let claimed = false;
const mutate = (what: string, f: () => void) => wait(null).then(() => { f(); alert(`Demo: ${what}. In the real app your wallet asks you to confirm.`); return null; });

export const demoMonsters: MonstersApi = {
  mine: () => wait(mineNow().map((m) => ({ ...m }))),
  get: (id) => wait(find(id) ? { ...find(id)! } : null),
  history: (id) => wait(histOf(id)),
  hatchStarters: () => mutate('3 starter monsters hatched', () => { claimed = true; }),
  startersClaimed: () => wait(claimed || NFTS.some((m) => m.owner === DEMO_ACCOUNT)),
  breed: async (a, b) => {
    const [ma, mb] = [find(a), find(b)];
    if (!ma || !mb) return null;
    await sent('breeding fee paid, new monster born');
    const { child } = breedPair(ma, mb); // also lands in the localStorage collection
    const c: NftMonster = { ...child, owner: DEMO_ACCOUNT, breeder: DEMO_ACCOUNT, titles: [], lockedUntil: 0, cooldownUntil: 0 };
    NFTS.push(c);
    patch(a, { cooldownUntil: Date.now() + HOUR }); patch(b, { cooldownUntil: Date.now() + HOUR });
    return { ...c };
  },
  list: (id, y) => mutate('monster listed for sale', () => patch(id, { price: y })),
  delist: (id) => mutate('listing removed', () => patch(id, { price: undefined })),
  buy: (id, y) => mutate(`monster bought for ${fmtN(y)} NEAR`, () => patch(id, { owner: DEMO_ACCOUNT, price: undefined, rentOffer: undefined })),
  offerRent: (id, p, d) => mutate('rent offer published', () => patch(id, { rentOffer: { pricePerDay: p, maxDays: d } })),
  cancelRent: (id) => mutate('rent offer cancelled', () => patch(id, { rentOffer: undefined })),
  rent: (id, days) => mutate(`monster rented for ${days} day(s)`, () => patch(id, { rental: { renter: DEMO_ACCOUNT, untilMs: Date.now() + days * DAY } })),
  listings: () => wait(NFTS.filter((m) => m.price).map((m) => ({ ...m }))),
  rentOffers: () => wait(NFTS.filter((m) => m.rentOffer).map((m) => ({ ...m }))),
  season: () => wait(season()),
  owed: () => wait('0'),
  withdrawOwed: () => sent('owed NEAR sent to your wallet'),
  leaderboard: () => wait(NFTS.slice().sort((x, y) => y.record.w - x.record.w).slice(0, 10).map((m): [string, number] => [m.id, m.record.w])),
  config: () => wait({ owner: 'admin.testnet', arena: 'arena.testnet', treasury: NEAR(3), breed_fee: NEAR(0.1), market_fee_bps: 250, royalty_bps: 500, rent_fee_bps: 250 }),
};
const fmtN = (y: string) => Number(BigInt(y) / 10n ** 21n) / 1000;

const mm = (id: number, host: string, guest: string, mh: string, mg: string, status: MatchView['status'], tournament: number, winner: number | null = null): MatchView => ({
  ...match(id, status, [0, 0], 0), host, guest, stake: '0', winner, monsters: [mh, mg], tournament, started_ms: Date.now() - 2 * HOUR,
});
const ent = (n: number) => ({ account: OTHERS[n].owner, monster: OTHERS[n].id });
const me = (): { account: string; monster: string } => ({ account: DEMO_ACCOUNT, monster: mineNow()[0]?.id ?? OTHERS[0].id });
const TOURNAMENTS: TournamentView[] = [
  { id: 1, game: 'brawler', size: 4, entry_fee: NEAR(0.2), pot: NEAR(0.4), bettable: true, status: 'open', entrants: [ent(0), ent(1)], rounds: [[null, null], [null]], champion: null, created_ms: Date.now() - 3 * HOUR },
  { id: 2, game: 'brawler', size: 8, entry_fee: NEAR(0.5), pot: NEAR(4), bettable: true, status: 'live', entrants: [me(), ent(1), ent(2), ent(3), ent(4), ent(5), ent(6), ent(7)],
    rounds: [[101, 102, 103, 104], [null, 105], [null]], champion: null, created_ms: Date.now() - 6 * HOUR },
  { id: 3, game: 'brawler', size: 4, entry_fee: NEAR(0.1), pot: NEAR(0.4), bettable: false, status: 'done', entrants: [ent(8), ent(9), ent(10), ent(11)],
    rounds: [[201, 202], [203]], champion: OTHERS[8].owner, created_ms: Date.now() - 2 * DAY },
];
{
  const t2 = TOURNAMENTS[1].entrants, t3 = TOURNAMENTS[2].entrants;
  const m = (id: number, t: TournamentView['entrants'], a: number, b: number, st: MatchView['status'], tn: number, w: number | null = null) =>
    mm(id, t[a].account, t[b].account, t[a].monster, t[b].monster, st, tn, w);
  MATCHES.push(
    m(101, t2, 0, 1, 'live', 2), m(102, t2, 2, 3, 'settled', 2, 0), m(103, t2, 4, 5, 'settled', 2, 1), m(104, t2, 6, 7, 'settled', 2, 0), m(105, t2, 5, 6, 'live', 2),
    m(201, t3, 0, 1, 'settled', 3, 0), m(202, t3, 2, 3, 'settled', 3, 1), m(203, t3, 0, 3, 'settled', 3, 0),
  );
}

// Same shape as useArena(): views return canned data, calls just announce themselves.
export const demoArena = {
  ready: true, account: DEMO_ACCOUNT, signIn: async () => {},
  createMatch: async (_bettable?: boolean, _stake?: string, _monsterId?: string) => { await sent('match created and stake escrowed'); return 99; },
  joinMatch: (_id?: number, _stake?: string, _monsterId?: string) => sent('stake matched, joining'),
  listTournaments: (): Promise<TournamentView[]> => wait([...TOURNAMENTS].reverse()),
  getTournament: (id: number): Promise<TournamentView | null> => wait(TOURNAMENTS.find((t) => t.id === id) ?? null),
  createTournament: async (size: number, feeYocto: string, bettable: boolean) => {
    await sent('tournament created');
    const id = TOURNAMENTS.length + 1;
    TOURNAMENTS.push({ id, game: 'brawler', size, entry_fee: feeYocto, pot: '0', bettable, status: 'open', entrants: [], rounds: size === 8 ? [[null, null, null, null], [null, null], [null]] : [[null, null], [null]], champion: null, created_ms: Date.now() });
    return id;
  },
  enterTournament: (id: number, monsterId: string, feeYocto: string) => tx(() => {
    const t = TOURNAMENTS.find((x) => x.id === id);
    if (!t || t.status !== 'open' || t.entrants.length >= t.size) throw new Error('Tournament is not open');
    t.entrants.push({ account: DEMO_ACCOUNT, monster: monsterId });
    t.pot = (BigInt(t.pot) + BigInt(feeYocto)).toString();
    alert('Demo: entered tournament. In the real app your wallet asks you to confirm.');
    return null;
  }),
  claimTournament: () => sent('prize added to your balance'),
  cancelTournament: () => sent('tournament cancelled, entry fees refundable'),
  cancelMatch: () => sent('match cancelled, stake refunded'),
  buy: (id: number, side: number, yocto: string, minOut: string, meta?: { card: number; dir: 'long' | 'short' }) => id === 1 ? tx(() => LIVE.buy(DEMO_ACCOUNT, side, BigInt(yocto), BigInt(minOut), Date.now(), meta)) : sent('position opened'),
  getLots: (id: number): Promise<LotView[]> => wait(id !== 1 ? [] : (LIVE.lots.get(DEMO_ACCOUNT) ?? []).map((l) => ({ ...l, shares: l.shares.toString(), cost: l.cost.toString() }))),
  claim: (id: number) => id === 1 ? tx(() => LIVE.claim(DEMO_ACCOUNT)) : sent('winnings added to your balance'),
  expire: () => sent('match released for refund'),
  getMatch: (id: number) => wait(id === 1 ? liveView() : MATCHES.find((m) => m.id === id) ?? match(id, 'live', [5, 5])),
  getPosition: (id: number): Promise<PositionView | null> => wait(id === 1 ? posView() : POS[id] ?? null),
  getPrices: (id: number): Promise<[number, number][]> => wait(id === 1 ? LIVE.history.map(([t, b]) => [t, b]) : [[Date.now() - 60_000, 5000], [Date.now(), MATCHES.find((m) => m.id === id)?.price_bps ?? 5000]]),
  quoteBuy: (id: number, side: number, yocto: string) => wait((id === 1 ? LIVE : new Market(5n * ONE)).quoteBuy(side, BigInt(yocto)).toString()),
  config: () => wait({ owner: DEMO_ACCOUNT, min_bet: NEAR(0.01), max_bet: NEAR(100), seed: NEAR(5) }),
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
