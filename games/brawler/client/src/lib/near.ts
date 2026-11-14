import { useNearWallet } from 'near-connect-hooks';
import { fmt, MARKET_URL, PLATFORM_ID, toYocto, useBalance, usePlatform } from '@xyz/platform';
import { DEMO, DEMO_ACCOUNT, DEMO_BALANCE, demoArena } from './demo.ts';

export { fmt, toYocto, MARKET_URL };
export const CONTRACT_ID = PLATFORM_ID;
export const GAME = 'brawler';
const GAS = '30000000000000';
const GAS_X = '100000000000000'; // monster lock xcc
const GAS_T = '150000000000000'; // enter_tournament needs 150 Tgas
const ONE_YOCTO = '1'; // spend calls need full-access key -> wallet confirm

export interface MatchView {
  id: number; game: string; host: string; guest: string | null; stake: string; bettable: boolean;
  status: 'open' | 'live' | 'settled' | 'refund'; winner: number | null; kos: number;
  amm: [string, string]; price_bps: number; collateral: string; // price_bps = fighter 0's price, 0..10000
  created_ms: number; started_ms: number;
  monsters: [string | null, string | null]; tournament: number | null;
}
export interface TournamentView {
  id: number; game: string; size: number; entry_fee: string; pot: string; bettable: boolean; status: 'open' | 'live' | 'done' | 'cancelled';
  entrants: { account: string; monster: string }[]; rounds: (number | null)[][]; // match ids per round, null = not created yet
  champion: string | null; created_ms: number;
  claimed?: boolean[]; // per entrant: prize/refund already taken
}
export interface PositionView { shares: [string, string]; paid: string; claimed: boolean }
interface BetView { id: number; who: string; side: number; amount: string; shares: string; ms: number }
export interface LotView { id: number; side: number; card: number; dir: 'long' | 'short'; shares: string; cost: string }
export interface FeedItem { id: number; who: string; kind: 'buy' | 'payout' | 'refund'; side?: number; near: string }
export interface Limits { owner: string; min_bet: string; max_bet: string; seed: string }

// accept 3% worse quote by tx landing
export const slip = (yocto: string) => ((BigInt(yocto) * 97n) / 100n).toString();

export const lowBalance = (have: string | null, need: string) =>
  `Not enough balance (${fmt(have ?? '0')} of ${fmt(need)} NEAR). Top up at ${MARKET_URL}`;

export function useArena() {
  const p = usePlatform();
  if (DEMO) return demoArena;
  const { call, view } = p;
  const account = p.w.signedAccountId;
  // throw before wallet opens if balance short
  const need = async (yocto: string) => {
    if (BigInt(yocto) === 0n || !account) return;
    const have = await p.balanceOf(account);
    if (BigInt(have) < BigInt(yocto)) throw new Error(lowBalance(have, yocto));
  };
  return {
    ready: !!CONTRACT_ID,
    account,
    signIn: p.w.signIn,
    // null = monster lock failed, stake refunded
    createMatch: async (bettable: boolean, stakeYocto: string, monsterId?: string): Promise<number | null> => {
      await need(stakeYocto);
      const r = await call('create_match', { game: GAME, stake: stakeYocto, bettable, monster_id: monsterId ?? null }, ONE_YOCTO, monsterId ? GAS_X : GAS);
      return r == null ? null : Number(r);
    },
    joinMatch: async (id: number, stakeYocto: string, monsterId?: string) => {
      await need(stakeYocto);
      return call('join_match', { match_id: id, monster_id: monsterId ?? null }, ONE_YOCTO, monsterId ? GAS_X : GAS);
    },
    listTournaments: (from = 0, limit = 30) => view<TournamentView[]>('list_tournaments', { from, limit, game: GAME }),
    getTournament: (id: number) => view<TournamentView | null>('get_tournament', { id }),
    createTournament: async (size: number, feeYocto: string, bettable: boolean) =>
      Number(await call('create_tournament', { game: GAME, size, entry_fee: feeYocto, bettable }, '1')),
    enterTournament: async (id: number, monsterId: string, feeYocto: string) => { await need(feeYocto); return call('enter_tournament', { id, monster_id: monsterId }, ONE_YOCTO, GAS_T); },
    claimTournament: (id: number) => call('claim_tournament', { id }),
    cancelTournament: (id: number) => call('cancel_tournament', { id }),
    cancelMatch: (id: number) => call('cancel_match', { match_id: id }),
    buy: async (id: number, side: number, yocto: string, minOut: string, _meta?: { card: number; dir: 'long' | 'short' }) => { await need(yocto); return call('buy', { match_id: id, side, amount: yocto, min_out: minOut }, ONE_YOCTO); },
    // my bets on match, oldest first
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
    listMatches: (from = 0, limit = 50) => view<MatchView[]>('list_matches', { from, limit, game: GAME }),
  };
}

// NEP-413 seat proof for game server. undefined in demo.
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

export function useWallet() {
  const w = useNearWallet();
  if (!DEMO) return w;
  return { ...w, loading: false, signedAccountId: DEMO_ACCOUNT, network: 'testnet', getBalance: async () => 12_345n * 10n ** 21n, signIn: async () => {}, signOut: async () => alert('Demo: wallet disconnected') };
}

export function useUnifiedBalance() {
  const b = useBalance();
  return DEMO ? { balance: DEMO_BALANCE, refresh: () => {} } : b;
}
