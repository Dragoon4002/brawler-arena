// Arena contract client (testnet). Thin wrapper over near-connect-hooks.
import { useNearWallet } from 'near-connect-hooks';
import { nearToYocto, yoctoToNear } from 'near-api-js';

export const CONTRACT_ID: string = import.meta.env.VITE_CONTRACT_ID ?? '';
const GAS = '30000000000000';

export interface MatchView {
  id: number; host: string; guest: string | null; stake: string; bettable: boolean;
  status: 'open' | 'live' | 'settled' | 'refund'; winner: number | null; kos: number; pool: [string, string];
  created_ms: number; started_ms: number;
}
export interface BetView { side: number; amount: string; weight: string; claimed: boolean }

export const toYocto = (near: string | number) => nearToYocto(String(near) as `${number}`).toString();
export const fmt = (yocto: string | bigint | undefined) => {
  if (yocto === undefined) return '0';
  const n = Number(yoctoToNear(BigInt(yocto)));
  return n === 0 ? '0' : n < 0.01 ? n.toPrecision(2) : n.toFixed(n < 10 ? 3 : 2).replace(/\.?0+$/, '');
};
// Same weighting as the contract: later bets (more KOs) count for less.
export const betWeightPct = (kos: number) => Math.max(10, 100 - 30 * kos);

export function useArena() {
  const w = useNearWallet();
  const call = (method: string, args: Record<string, unknown>, deposit = '0') =>
    w.callFunction({ contractId: CONTRACT_ID, method, args, gas: GAS, deposit });
  const view = <T,>(method: string, args: Record<string, unknown> = {}) =>
    w.viewFunction({ contractId: CONTRACT_ID, method, args }) as Promise<T>;
  return {
    ready: !!CONTRACT_ID,
    account: w.signedAccountId,
    signIn: w.signIn,
    createMatch: async (bettable: boolean, stakeYocto: string) => Number(await call('create_match', { bettable }, stakeYocto)),
    joinMatch: (id: number, stakeYocto: string) => call('join_match', { match_id: id }, stakeYocto),
    cancelMatch: (id: number) => call('cancel_match', { match_id: id }),
    placeBet: (id: number, side: number, yocto: string) => call('place_bet', { match_id: id, side }, yocto),
    claim: (id: number) => call('claim', { match_id: id }),
    expire: (id: number) => call('expire', { match_id: id }),
    getMatch: (id: number) => view<MatchView | null>('get_match', { match_id: id }),
    getBet: (id: number, account: string) => view<BetView | null>('get_bet', { match_id: id, account_id: account }),
    claimable: (id: number, account: string) => view<string>('claimable', { match_id: id, account_id: account }),
    listMatches: (from = 0, limit = 50) => view<MatchView[]>('list_matches', { from, limit }),
  };
}
