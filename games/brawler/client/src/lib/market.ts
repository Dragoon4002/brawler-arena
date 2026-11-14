// Must match the contract's AMM math, rounding and error messages exactly (contracts/platform).

export const ONE = 10n ** 24n; // 1 NEAR in yocto
const BPS = 10_000n;

export interface Pos { shares: [bigint, bigint]; paid: bigint; claimed: boolean }
// One Long/Short trade. `card` = fighter it was placed on; `side` = whose shares it bought (Short X buys the rival's).
export interface Lot { id: number; side: number; card: number; dir: 'long' | 'short'; shares: bigint; cost: bigint }
export type Kind = 'seed' | 'buy' | 'fee' | 'payout' | 'refund' | 'house';
// One NEAR movement. `near` is what moved for `kind`; shares/price are after the trade.
export interface Entry { step: number; who: string; kind: Kind; side?: number; near: bigint; shares?: bigint; price: number }


/** Deposit x for `side` shares: mint x pairs, keep a*b. Returns [shares out, new reserves]. */
export function ammBuy(r: [bigint, bigint], side: number, x: bigint): [bigint, [bigint, bigint]] {
  const o = 1 - side, k = r[0] * r[1], ro = r[o] + x;
  const keep = (k + ro - 1n) / ro; // ceil
  const n: [bigint, bigint] = [...r];
  n[o] = ro; n[side] = keep;
  return [r[side] + x - keep, n];
}

export const priceBps = (r: [bigint, bigint]) => (r[0] + r[1] === 0n ? 5000 : Number((r[1] * BPS) / (r[0] + r[1])));

export class Market {
  amm: [bigint, bigint];
  collateral: bigint;
  status: 'live' | 'settled' | 'refund' = 'live';
  winner: number | null = null;
  positions = new Map<string, Pos>();
  lots = new Map<string, Lot[]>(); // per-trade positions; `positions` holds the totals that settle
  history: [number, number][] = [];
  ledger: Entry[] = [];
  step = 0;

  seed: bigint; feeBps: bigint; minBet: bigint; maxBet: bigint;

  constructor(seed: bigint, feeBps = 10n, minBet = ONE / 100n, maxBet = 100n * ONE) {
    this.seed = seed; this.feeBps = feeBps; this.minBet = minBet; this.maxBet = maxBet;
    this.amm = [seed, seed];
    this.collateral = seed;
    this.log('house', 'seed', seed);
    this.history.push([0, 5000]);
  }

  get price() { return priceBps(this.amm); }
  pos(who: string) { return this.positions.get(who); }

  quoteBuy(side: number, amount: bigint) { return ammBuy(this.amm, side, amount - (amount * this.feeBps) / BPS)[0]; }

  buy(who: string, side: number, amount: bigint, minOut = 0n, t = this.step, meta?: { card: number; dir: 'long' | 'short' }) {
    if (amount < this.minBet) throw new Error('Bet below minimum');
    if (amount > this.maxBet) throw new Error('Bet above maximum');
    if (this.status !== 'live') throw new Error('Betting closed');
    const fee = (amount * this.feeBps) / BPS, x = amount - fee;
    const [out, amm] = ammBuy(this.amm, side, x);
    if (out < minOut) throw new Error('Price moved, try again');
    const p = this.positions.get(who) ?? { shares: [0n, 0n], paid: 0n, claimed: false };
    p.shares[side] += out; p.paid += x;
    this.positions.set(who, p);
    this.amm = amm; this.collateral += x;
    this.step++;
    this.history.push([t, this.price]);
    const lots = this.lots.get(who) ?? [];
    lots.push({ id: lots.length, side, card: meta?.card ?? side, dir: meta?.dir ?? 'long', shares: out, cost: amount });
    this.lots.set(who, lots);
    this.log(who, 'buy', amount, side, out);
    this.log('house', 'fee', fee);
    return out;
  }

  /** End the match. winner null = void: everyone gets their stake back (after fee), house gets its seed. */
  finish(winner: number | null) {
    if (this.status !== 'live') throw new Error('Match not live');
    this.winner = winner;
    if (winner === null) {
      this.status = 'refund';
      this.log('house', 'house', this.seed);
    } else {
      this.status = 'settled';
      this.log('house', 'house', this.amm[winner]);
    }
  }

  /** What `who` can claim now. */
  due(who: string) {
    const p = this.positions.get(who);
    if (!p || p.claimed) return 0n;
    if (this.status === 'settled') return p.shares[this.winner!];
    if (this.status === 'refund') return p.paid;
    return 0n;
  }

  claim(who: string) {
    const amt = this.due(who);
    if (amt <= 0n) throw new Error('Nothing to claim');
    this.positions.get(who)!.claimed = true;
    this.log(who, this.status === 'refund' ? 'refund' : 'payout', amt);
    return amt;
  }

  /** Everyone claims, then the books: in = seed + deposits, out = payouts + fees + house return. */
  audit() {
    let deposits = 0n, payouts = 0n, fees = 0n, house = 0n;
    for (const e of this.ledger) {
      if (e.kind === 'buy') deposits += e.near;
      else if (e.kind === 'payout' || e.kind === 'refund') payouts += e.near;
      else if (e.kind === 'fee') fees += e.near;
      else if (e.kind === 'house') house += e.near;
    }
    const inn = this.seed + deposits, out = payouts + fees + house;
    return { seed: this.seed, deposits, payouts, fees, house, houseNet: house + fees - this.seed, in: inn, out, dust: inn - out };
  }

  private log(who: string, kind: Kind, near: bigint, side?: number, shares?: bigint) {
    this.ledger.push({ step: this.step, who, kind, side, near, shares, price: this.price });
  }
}

/** Seeded random market: traders follow a hidden momentum walk (who's ahead in the fight). */
export function simulate({ seed = 5n * ONE, traders = 8, trades = 60, winner = 'auto' as number | null | 'auto', run = 1 }) {
  let r = run * 7919 + 13;
  const rnd = () => ((r = (r * 48271) % 2147483647) / 2147483647);
  const m = new Market(seed);
  const names = Array.from({ length: traders }, (_, i) => `fan-${String.fromCharCode(97 + (i % 26))}${i >= 26 ? i : ''}.testnet`);
  let lead = 0; // >0: fighter 0 ahead
  for (let i = 0; i < trades; i++) {
    lead += (rnd() - 0.5) * 0.6;
    const who = names[Math.floor(rnd() * traders)];
    const side = rnd() < 1 / (1 + Math.exp(-lead * 2)) ? 0 : 1;
    m.buy(who, side, BigInt(Math.round((0.05 + rnd() ** 2 * 3) * 1000)) * (ONE / 1000n));
  }
  m.finish(winner === 'auto' ? (lead >= 0 ? 0 : 1) : winner);
  for (const who of names) if (m.due(who) > 0n) m.claim(who);
  return { market: m, names, audit: m.audit() };
}
