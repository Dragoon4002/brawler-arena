// Server referee: replays a match's input tape with the same deterministic sim the players run,
// and reports KOs + the winner to the arena contract. Disabled (log only) when env isn't set.
import { Account, JsonRpcProvider, type KeyPairString, type Provider } from 'near-api-js';
import { verifyMessage } from 'near-api-js/nep413';
import { newGame, step, type GameState } from '../client/src/sim/sim.ts';
import { sanitize, statsOf, type Dna } from '../client/src/genes.ts';
import type { StageId } from '../client/src/stages.ts';

const NETWORK_RPC = process.env.NEAR_RPC ?? 'https://test.rpc.fastnear.com';
export const CONTRACT_ID = process.env.CONTRACT_ID ?? '';
export const MONSTERS_ID = process.env.MONSTERS_ID ?? '';
const REFEREE_ID = process.env.REFEREE_ID ?? '';
const REFEREE_KEY = process.env.REFEREE_KEY ?? ''; // function-call key limited to report_kos / report_result

const provider = new JsonRpcProvider({ url: NETWORK_RPC });
const account = CONTRACT_ID && REFEREE_ID && REFEREE_KEY ? new Account(REFEREE_ID, provider, REFEREE_KEY as KeyPairString) : null;
if (!account) console.log('referee: CONTRACT_ID/REFEREE_ID/REFEREE_KEY not set — on-chain reporting disabled');

export async function view<T>(method: string, args: Record<string, unknown>, contractId = CONTRACT_ID): Promise<T | null> {
  if (!contractId) return null;
  try { return (await provider.callFunction({ contractId, method, args })) as T; }
  catch (e) { console.warn('view', method, (e as Error).message); return null; }
}

// NEP-413 proof that the socket controls `accountId`: wallet signed `brawler-arena:<matchId>` for recipient CONTRACT_ID
// with this connection's server nonce. verifyMessage checks the ed25519 sig over the borsh payload hash AND that the key
// is a FullAccess key of the account (RPC view_access_key). auth = { publicKey: 'ed25519:…', signature: base64 }.
export async function verifyAuth(auth: unknown, accountId: string, matchId: number, nonce: Uint8Array, rpc: Pick<Provider, 'viewAccessKey'> = provider): Promise<boolean> {
  const a = auth as { publicKey?: unknown; signature?: unknown } | null;
  if (!accountId || typeof a?.publicKey !== 'string' || typeof a.signature !== 'string') return false;
  try {
    await verifyMessage({
      signerAccountId: accountId, signerPublicKey: a.publicKey, signature: Buffer.from(a.signature, 'base64'),
      payload: { message: `brawler-arena:${matchId}`, recipient: CONTRACT_ID, nonce }, provider: rpc as Provider,
    });
    return true;
  } catch { return false; } // bad key/sig, not FullAccess, unknown account, RPC down
}

// On-chain DNA of a monster token (sanitized), or null when unset/unknown/unreachable.
export async function monsterDna(tokenId: string): Promise<Dna | null> {
  const m = await view<{ dna: unknown } | null>('get_monster', { token_id: tokenId }, MONSTERS_ID);
  return m?.dna ? sanitize(m.dna) : null;
}

// Calls are queued per match so KO reports land before the result.
const queues = new Map<number, Promise<unknown>>();
function call(matchId: number, methodName: string, args: object, gas = 30_000_000_000_000n) {
  if (!account) return;
  const prev = queues.get(matchId) ?? Promise.resolve();
  const once = () => account.callFunction({ contractId: CONTRACT_ID, methodName, args, gas });
  const retry = async () => {
    for (let i = 0; ; i++) {
      try { return await once(); }
      catch (e) {
        if (i >= 4) return console.warn('referee gave up', methodName, matchId, (e as Error).message); // 2 h expiry refunds
        await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
      }
    }
  };
  const next = prev.then(retry);
  queues.set(matchId, next);
}

export class Referee {
  state: GameState;
  frame = 0;
  private kos = 0;
  private matchId: number | null;
  constructor(matchId: number | null, dna: [Dna, Dna], stage: StageId) {
    this.matchId = matchId;
    this.state = newGame(dna.map(statsOf), stage);
  }
  // Step one confirmed frame. Returns winner seat once the match is decided.
  step(inputs: [number, number]): number {
    if (this.state.winner >= 0) return this.state.winner;
    step(this.state, inputs);
    this.frame++;
    const kos = 6 - this.state.fighters.reduce((s, f) => s + f.stocks, 0);
    if (kos > this.kos) { this.kos = kos; if (this.matchId !== null) call(this.matchId, 'report_kos', { match_id: this.matchId, kos }); }
    if (this.state.winner >= 0) this.result(this.state.winner);
    return this.state.winner;
  }
  result(winner: number | null) {
    if (this.matchId === null) return;
    const [a, b] = this.state.fighters; // kos[i] = KOs scored BY seat i = 3 - opponent's stocks
    call(this.matchId, 'report_result', { match_id: this.matchId, winner, kos: [3 - b.stocks, 3 - a.stocks] }, 100_000_000_000_000n);
  }
}
