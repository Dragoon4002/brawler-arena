// Arena contract client (testnet). Thin wrapper over near-connect-hooks.
import { useNearWallet } from 'near-connect-hooks';
import { nearToYocto, yoctoToNear } from 'near-api-js';
import { DEMO, DEMO_ACCOUNT, demoArena } from './demo.ts';

export const CONTRACT_ID: string = import.meta.env?.VITE_CONTRACT_ID ?? 'brawler-arena-v2-ed5da3.testnet'; // testnet deploy
const GAS = '30000000000000';
const GAS_X = '100000000000000'; // cross-contract (monster lock) calls
const GAS_T = '150000000000000'; // enter_tournament (contract requires 150 Tgas)

export interface MatchView {
  id: number; host: string; guest: string | null; stake: string; bettable: boolean;
  status: 'open' | 'live' | 'settled' | 'refund'; winner: number | null; kos: number;
  amm: [string, string]; price_bps: number; collateral: string; // price_bps = fighter 0's price, 0..10000
  created_ms: number; started_ms: number;
  monsters: [string | null, string | null]; tournament: number | null;
}
export interface TournamentView {
  id: number; size: number; entry_fee: string; pot: string; bettable: boolean; status: 'open' | 'live' | 'done' | 'cancelled';
  entrants: { account: string; monster: string }[]; rounds: (number | null)[][]; // match ids per round, null = not created yet
  champion: string | null; created_ms: number;
  claimed?: boolean[]; // per entrant: prize/refund already taken
}
export interface PositionView { shares: [string, string]; paid: string; claimed: boolean }
interface BetView { id: number; who: string; side: number; amount: string; shares: string; ms: number }
export interface LotView { id: number; side: number; card: number; dir: 'long' | 'short'; shares: string; cost: string }
export interface FeedItem { id: number; who: string; kind: 'buy' | 'payout' | 'refund'; side?: number; near: string }
export interface Limits { owner: string; min_bet: string; max_bet: string; seed: string }

export const toYocto = (near: string | number) => nearToYocto(String(near) as `${number}`).toString();
export const fmt = (yocto: string | bigint | undefined) => {
  if (yocto === undefined) return '0';
  const n = Number(yoctoToNear(BigInt(yocto)));
  return n === 0 ? '0' : n < 0.01 ? n.toPrecision(2) : n.toFixed(n < 10 ? 3 : 2).replace(/\.?0+$/, '');
};
// Quotes come from the contract; accept up to 3% worse by the time the tx lands.
export const slip = (yocto: string) => ((BigInt(yocto) * 97n) / 100n).toString();

export function useArena() {
  const w = useNearWallet();
  if (DEMO) return demoArena;
  const call = (method: string, args: Record<string, unknown>, deposit = '0', gas = GAS) =>
    w.callFunction({ contractId: CONTRACT_ID, method, args, gas, deposit });
  const view = <T,>(method: string, args: Record<string, unknown> = {}) =>
    w.viewFunction({ contractId: CONTRACT_ID, method, args }) as Promise<T>;
  return {
    ready: !!CONTRACT_ID,
    account: w.signedAccountId,
    signIn: w.signIn,
    // null = monster lock failed, deposit refunded
    createMatch: async (bettable: boolean, stakeYocto: string, monsterId?: string): Promise<number | null> => {
      const r = await call('create_match', { bettable, monster_id: monsterId ?? null }, stakeYocto, monsterId ? GAS_X : GAS);
      return r == null ? null : Number(r);
    },
    joinMatch: (id: number, stakeYocto: string, monsterId?: string) =>
      call('join_match', { match_id: id, monster_id: monsterId ?? null }, stakeYocto, monsterId ? GAS_X : GAS),
    listTournaments: (from = 0, limit = 30) => view<TournamentView[]>('list_tournaments', { from, limit }),
    getTournament: (id: number) => view<TournamentView | null>('get_tournament', { id }),
    createTournament: async (size: number, feeYocto: string, bettable: boolean) =>
      Number(await call('create_tournament', { size, entry_fee: feeYocto, bettable }, '1')),
    enterTournament: (id: number, monsterId: string, feeYocto: string) => call('enter_tournament', { id, monster_id: monsterId }, feeYocto, GAS_T),
    claimTournament: (id: number) => call('claim_tournament', { id }),
    cancelTournament: (id: number) => call('cancel_tournament', { id }),
    cancelMatch: (id: number) => call('cancel_match', { match_id: id }),
    buy: (id: number, side: number, yocto: string, minOut: string, _meta?: { card: number; dir: 'long' | 'short' }) => call('buy', { match_id: id, side, min_out: minOut }, yocto),
    // Every bet you placed on this match, oldest first (each one is its own row; all settle together).
    getLots: async (id: number, account: string): Promise<LotView[]> =>
      (await view<BetView[]>('get_bets_of', { match_id: id, account_id: account })).map((b) => ({ id: b.id, side: b.side, card: b.side, dir: 'long' as const, shares: b.shares, cost: b.amount })),
    claim: (id: number) => call('claim', { match_id: id }),
    expire: (id: number) => call('expire', { match_id: id }),
    getMatch: (id: number) => view<MatchView | null>('get_match', { match_id: id }),
    getPosition: (id: number, account: string) => view<PositionView | null>('get_position', { match_id: id, account_id: account }),
    getPrices: (id: number) => view<[number, number][]>('get_prices', { match_id: id }),
    quoteBuy: (id: number, side: number, yocto: string) => view<string>('quote_buy', { match_id: id, side, amount: yocto }),
    config: () => view<Limits>('config'),
    getFeed: async (id: number): Promise<FeedItem[]> =>
      (await view<BetView[]>('get_recent_bets', { match_id: id, limit: 6 })).map((b) => ({ id: b.id, who: b.who, kind: 'buy' as const, side: b.side, near: b.amount })),
    claimable: (id: number, account: string) => view<string>('claimable', { match_id: id, account_id: account }),
    listMatches: (from = 0, limit = 50) => view<MatchView[]>('list_matches', { from, limit }),
  };
}

// NEP-413 proof of account for the relay's on-chain seats (see server/relay.ts). undefined in demo: no signing.
export type MatchAuth = { publicKey: string; signature: string };
export type SignMatch = (matchId: number, nonce: string) => Promise<MatchAuth>;
export function useSignMatch(): SignMatch | undefined {
  const w = useNearWallet();
  if (DEMO) return undefined;
  return async (matchId, nonce) => {
    const s = await w.signNEP413Message({ message: `brawler-arena:${matchId}`, recipient: CONTRACT_ID, nonce: Uint8Array.from(atob(nonce), (c) => c.charCodeAt(0)) });
    return { publicKey: String(s.publicKey), signature: String(s.signature) };
  };
}

// Wallet state for screens; demo mode pretends a testnet account is connected.
export function useWallet() {
  const w = useNearWallet();
  if (!DEMO) return w;
  return { ...w, loading: false, signedAccountId: DEMO_ACCOUNT, network: 'testnet', getBalance: async () => 12_345n * 10n ** 21n, signIn: async () => {}, signOut: async () => alert('Demo: wallet disconnected') };
}
