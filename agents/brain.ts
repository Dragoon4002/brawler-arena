export interface Fighter { name: string; stocks: number; damage: number }
export interface View {
  fighters: [Fighter, Fighter];
  secs: number; // fight time elapsed
  price0: number; // market price of fighter 0, 0..1
}
export interface Budget { minBet: number; maxBet: number; left: number } // NEAR
export interface Decision { action: 'buy' | 'hold'; side: 0 | 1; amount: number; reason: string }

export const PERSONAS = ['Momentum', 'Underdog', 'Quant'] as const;
export type Persona = typeof PERSONAS[number];

// P(fighter 0 wins) from the scoreboard. 3 stocks each, damage >= 200 costs a stock.
export function winProb(v: View) {
  const [a, b] = v.fighters;
  const score = (a.stocks - b.stocks) + (b.damage - a.damage) / 200;
  return 1 / (1 + Math.exp(-1.5 * score));
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function heuristic(p: Persona, v: View, b: Budget): Decision {
  const est = winProb(v), lead: 0 | 1 = est >= 0.5 ? 0 : 1, trail: 0 | 1 = lead ? 0 : 1;
  const price = (s: 0 | 1) => (s ? 1 - v.price0 : v.price0);
  const [A, B] = v.fighters, name = (s: 0 | 1) => v.fighters[s].name;
  const hold = (reason: string): Decision => ({ action: 'hold', side: 0, amount: 0, reason });
  let side: 0 | 1, frac: number, reason: string;
  if (p === 'Momentum') {
    const gap = Math.abs(est - 0.5);
    if (gap < 0.05) return hold('No clear leader yet');
    side = lead; frac = 0.3 + gap;
    reason = `${name(lead)} ahead (${A.stocks}-${B.stocks} stocks, ${Math.round(A.damage)}-${Math.round(B.damage)} dmg), riding the momentum`;
  } else if (p === 'Underdog') {
    if (price(trail) > 0.4) return hold('Underdog not cheap enough');
    side = trail; frac = 0.25;
    reason = `${name(trail)} at ${Math.round(price(trail) * 100)}% is too cheap, comeback incoming`;
  } else {
    const e0 = est - v.price0, edge = Math.abs(e0);
    if (edge < 0.08) return hold(`No edge: model ${Math.round(est * 100)}% vs market ${Math.round(v.price0 * 100)}%`);
    side = e0 > 0 ? 0 : 1; frac = Math.min(1, edge * 3);
    reason = `Model ${Math.round((side ? 1 - est : est) * 100)}% vs market ${Math.round(price(side) * 100)}% on ${name(side)}: +${Math.round(edge * 100)}pt edge`;
  }
  return validate({ action: 'buy', side, amount: r2(b.minBet + (b.maxBet - b.minBet) * frac), reason }, b) ?? hold('Out of budget');
}

// Amount clamped into budget; null when off-schema or out of budget.
export function validate(x: any, b: Budget): Decision | null {
  if (!x || typeof x !== 'object') return null;
  const reason = typeof x.reason === 'string' ? x.reason.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  if (x.action === 'hold') return { action: 'hold', side: 0, amount: 0, reason };
  if (x.action !== 'buy' || (x.side !== 0 && x.side !== 1) || typeof x.amount !== 'number' || !Number.isFinite(x.amount) || !reason) return null;
  const cap = Math.min(b.maxBet, b.left);
  if (cap < b.minBet) return null;
  return { action: 'buy', side: x.side, amount: r2(Math.max(b.minBet, Math.min(cap, x.amount))), reason };
}

/* ---------- commentator ---------- */

export interface Moment { kind: 'start' | 'ko' | 'swing' | 'comeback' | 'over'; who: number; v: View; winner?: number | null }

export function template(m: Moment) {
  const f = m.v.fighters, n = f[m.who]?.name, o = f[1 - m.who]?.name;
  switch (m.kind) {
    case 'start': return `We are LIVE! ${f[0].name} vs ${f[1].name}, three stocks each. Place your bets!`;
    case 'ko': return `${n} goes DOWN! ${n} has ${f[m.who].stocks} stock${f[m.who].stocks === 1 ? '' : 's'} left!`;
    case 'swing': return `Huge combo from ${o}! ${n} is up to ${Math.round(f[m.who].damage)} damage!`;
    case 'comeback': return `${n} has clawed it back! ${f[0].stocks}-${f[1].stocks}, anyone's game!`;
    case 'over': return m.winner == null ? 'Match voided, bets refunded.' : `It's over! ${f[m.winner].name} takes it!`;
  }
}
