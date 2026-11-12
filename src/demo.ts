// Demo mode (?demo in the URL): every screen renders with fake data, no wallet, no server, no opponent.
import { IN, type GameState } from './sim/sim.ts';
import { randomDna, nameFor } from './genes.ts';
import type { MatchView, BetView } from './near.ts';

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

const match = (id: number, status: MatchView['status'], pool: [number, number], kos = 1): MatchView => ({
  id, host: DEMO_ROOMS[0].players[0].account, guest: DEMO_ROOMS[0].players[1].account, stake: NEAR(0.5), bettable: true,
  status, winner: status === 'settled' ? 0 : null, kos, pool: [NEAR(pool[0]), NEAR(pool[1])], created_ms: Date.now() - 600_000, started_ms: Date.now() - 300_000,
});
const MATCHES: MatchView[] = [
  match(1, 'live', [3.2, 1.4]),
  match(4, 'settled', [1, 2]), match(5, 'refund', [0.3, 0]),
  { ...match(6, 'open', [0, 0], 0), host: DEMO_ACCOUNT },
  { ...match(7, 'live', [0, 0], 0), started_ms: Date.now() - 3 * 3600_000, host: DEMO_ACCOUNT },
];
const wait = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 400));
const sent = (what: string) => { alert(`Demo: ${what}. In the real app your wallet asks you to confirm.`); return wait(null); };

// Same shape as useArena(): views return canned data, calls just announce themselves.
export const demoArena = {
  ready: true, account: DEMO_ACCOUNT, signIn: async () => {},
  createMatch: async () => { await sent('match created and stake escrowed'); return 99; },
  joinMatch: () => sent('stake matched, joining'),
  cancelMatch: () => sent('match cancelled, stake refunded'),
  placeBet: () => sent('bet placed'),
  claim: () => sent('winnings sent to your wallet'),
  expire: () => sent('match released for refund'),
  getMatch: (id: number) => wait(MATCHES.find((m) => m.id === id) ?? match(id, 'live', [3.2, 1.4])),
  getBet: (id: number): Promise<BetView | null> => wait(id === 4 ? { side: 0, amount: NEAR(1), weight: NEAR(1), claimed: false } : null),
  claimable: (id: number) => wait(id === 4 ? NEAR(2.998) : id === 5 ? NEAR(0.3) : '0'),
  listMatches: () => wait(MATCHES),
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
