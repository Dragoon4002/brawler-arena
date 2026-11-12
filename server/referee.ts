// Server referee: replays a match's input tape with the same deterministic sim the players run,
// and reports KOs + the winner to the arena contract. Disabled (log only) when env isn't set.
import { Account, JsonRpcProvider, type KeyPairString } from 'near-api-js';
import { newGame, step, type GameState } from '../src/sim/sim.ts';
import { statsOf, type Dna } from '../src/genes.ts';
import type { StageId } from '../src/stages.ts';

const NETWORK_RPC = process.env.NEAR_RPC ?? 'https://test.rpc.fastnear.com';
export const CONTRACT_ID = process.env.CONTRACT_ID ?? '';
const REFEREE_ID = process.env.REFEREE_ID ?? '';
const REFEREE_KEY = process.env.REFEREE_KEY ?? ''; // function-call key limited to report_kos / report_result

const provider = new JsonRpcProvider({ url: NETWORK_RPC });
const account = CONTRACT_ID && REFEREE_ID && REFEREE_KEY ? new Account(REFEREE_ID, provider, REFEREE_KEY as KeyPairString) : null;
if (!account) console.log('referee: CONTRACT_ID/REFEREE_ID/REFEREE_KEY not set — on-chain reporting disabled');

export async function view<T>(method: string, args: Record<string, unknown>): Promise<T | null> {
  if (!CONTRACT_ID) return null;
  try { return (await provider.callFunction({ contractId: CONTRACT_ID, method, args })) as T; }
  catch (e) { console.warn('view', method, (e as Error).message); return null; }
}

// Calls are queued per match so KO reports land before the result.
const queues = new Map<number, Promise<unknown>>();
function call(matchId: number, methodName: string, args: object) {
  if (!account) return;
  const prev = queues.get(matchId) ?? Promise.resolve();
  const next = prev.then(() => account.callFunction({ contractId: CONTRACT_ID, methodName, args, gas: 30_000_000_000_000n }))
    .catch((e) => console.warn('referee', methodName, matchId, (e as Error).message));
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
    if (this.matchId !== null) call(this.matchId, 'report_result', { match_id: this.matchId, winner });
  }
}
