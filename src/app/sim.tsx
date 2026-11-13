// #/sim : run a whole spectator market off-chain with the contract's math and audit every payment.
import { useMemo, useState } from 'react';
import { fmt } from '../near.ts';
import { ONE, simulate, type Entry } from '../market.ts';
import { DEMO_ROOMS } from '../demo.ts';
import { PriceChart } from './rooms.tsx';
import { Ico } from './ui.tsx';

const FIGHTERS = DEMO_ROOMS[0].players.map((p) => p.name);
const signed = (y: bigint) => `${y >= 0n ? '+' : '−'}${fmt(y >= 0n ? y : -y)}`;
const ACTION: Record<Entry['kind'], string> = { seed: 'seeds pool', buy: 'buys', fee: 'fee', payout: 'winnings', refund: 'refund', house: 'pool back to house' };

export function MarketSim() {
  const [seed, setSeed] = useState(5);
  const [traders, setTraders] = useState(8);
  const [trades, setTrades] = useState(60);
  const [outcome, setOutcome] = useState<'auto' | '0' | '1' | 'void'>('auto');
  const [run, setRun] = useState(1);
  const { market: m, names, audit: a } = useMemo(
    () => simulate({ seed: BigInt(seed) * ONE, traders, trades, run, winner: outcome === 'auto' ? 'auto' : outcome === 'void' ? null : Number(outcome) }),
    [seed, traders, trades, outcome, run],
  );

  const rows = names.map((who) => {
    let paid = 0n, settled = 0n;
    for (const e of m.ledger) if (e.who === who) {
      if (e.kind === 'buy') paid += e.near;
      else if (e.kind === 'payout' || e.kind === 'refund') settled += e.near;
    }
    return { who, paid, settled, pnl: settled - paid };
  }).filter((r) => r.paid > 0n).sort((x, y) => (y.pnl > x.pnl ? 1 : -1));
  const traderNet = rows.reduce((s, r) => s + r.pnl, 0n);
  const result = m.winner === null ? 'Match void: everyone refunded their net deposit' : `${FIGHTERS[m.winner]} wins: each ${FIGHTERS[m.winner]} share pays 1 NEAR`;
  const select = (label: string, value: string | number, set: (v: string) => void, opts: [string | number, string][]) => (
    <label className="row">{label}<select value={value} onChange={(e) => set(e.target.value)}>{opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
  );

  return (
    <>
      <div>
        <h1>Market simulation</h1>
        <p className="sub">A full spectator market run in your browser with the same math and rounding as the arena contract. Fake traders follow the fight's momentum; bets lock until the end, then the match settles and everyone claims. Nothing touches the chain.</p>
      </div>

      <section className="slab sim-controls">
        {select('House seed', seed, (v) => setSeed(Number(v)), [[1, '1 NEAR'], [5, '5 NEAR'], [10, '10 NEAR']])}
        {select('Traders', traders, (v) => setTraders(Number(v)), [[4, '4'], [8, '8'], [16, '16']])}
        {select('Trades', trades, (v) => setTrades(Number(v)), [[30, '30'], [60, '60'], [120, '120']])}
        {select('Result', outcome, (v) => setOutcome(v as typeof outcome), [['auto', 'Follow the fight'], ['0', `${FIGHTERS[0]} wins`], ['1', `${FIGHTERS[1]} wins`], ['void', 'Void (refund)']])}
        <button className="btn" onClick={() => setRun(run + 1)}><span><Ico n="icon-refresh" />Run again (#{run})</span></button>
      </section>

      <div className="split">
        <section className="slab sim-block">
          <h2>{FIGHTERS[0]} price</h2>
          <PriceChart pts={m.history.map(([, b]) => b / 1e4)} />
          <p className="note">Ends at {Math.round(m.price / 100)}%. {result}.</p>
          <p className="note">Price of {FIGHTERS[0]} = b / (a + b), where a and b are the pool's {FIGHTERS[0]} and {FIGHTERS[1]} shares; a × b stays constant on every trade. Fee {Number(m.feeBps) / 100}% per trade.</p>
        </section>
        <section className="slab sim-block">
          <h2>The books</h2>
          <dl className="kv">
            <dt>House seed in</dt><dd>{fmt(a.seed)} NEAR</dd>
            <dt>Trader deposits</dt><dd>{fmt(a.deposits)} NEAR</dd>
            <dt>Paid at settlement</dt><dd>{fmt(a.payouts)} NEAR</dd>
            <dt>Fees to house</dt><dd>{fmt(a.fees)} NEAR</dd>
            <dt>Pool back to house</dt><dd>{fmt(a.house)} NEAR</dd>
            <dt>House net</dt><dd><b className={a.houseNet >= 0n ? 'pnl-up' : 'pnl-down'}>{signed(a.houseNet)} NEAR</b></dd>
            <dt>Traders net</dt><dd><b className={traderNet >= 0n ? 'pnl-up' : 'pnl-down'}>{signed(traderNet)} NEAR</b></dd>
            <dt>Money in / out</dt><dd>{fmt(a.in)} / {fmt(a.out)} NEAR</dd>
            <dt>Rounding dust</dt><dd>{a.dust.toString()} yocto</dd>
          </dl>
          <p className={a.dust >= 0n && a.dust < 1000n ? 'pnl-up' : 'pnl-down'} role="status">
            {a.dust >= 0n && a.dust < 1000n ? '✓ Balanced: every NEAR in was paid out, kept as fees, or returned to the house.' : '✗ Books do not balance.'}
            {' '}Traders {signed(traderNet)} + house {signed(a.houseNet)} + dust = 0.
          </p>
        </section>
      </div>

      <section className="slab sim-block">
        <h2>Traders</h2>
        <div className="sim-scroll">
          <table className="sim-table">
            <thead><tr><th>Account</th><th>Paid in</th><th>Settlement</th><th>Net</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.who}><td>{r.who}</td><td>{fmt(r.paid)}</td><td>{fmt(r.settled)}</td><td className={r.pnl >= 0n ? 'pnl-up' : 'pnl-down'}>{signed(r.pnl)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="slab sim-block">
        <h2>Every payment ({m.ledger.length})</h2>
        <div className="sim-scroll tall">
          <table className="sim-table">
            <thead><tr><th>#</th><th>Who</th><th>Action</th><th>Fighter</th><th>NEAR</th><th>Shares</th><th>{FIGHTERS[0]} price after</th></tr></thead>
            <tbody>
              {m.ledger.map((e, k) => (
                <tr key={k} className={e.kind === 'fee' ? 'muted' : ''}>
                  <td>{k + 1}</td><td>{e.who}</td><td>{ACTION[e.kind]}</td><td>{e.side === undefined ? '' : FIGHTERS[e.side]}</td>
                  <td>{fmt(e.near)}</td><td>{e.shares === undefined ? '' : fmt(e.shares)}</td><td>{(e.price / 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
