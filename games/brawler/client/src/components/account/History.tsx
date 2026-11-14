import { useState } from 'react';
import { fmt, useArena, type MatchView } from '@/lib/near.ts';
import { history, monster, type MatchLog } from '@/lib/store.ts';
import { short } from '@/lib/format.ts';
import { useLoad } from '@/hooks/async.ts';
import { Ico } from '@/components/ui.tsx';

export interface Fight { at: number; won: boolean | null; mine: string; vs: string; stake: string; kind: 'Friendly' | 'Staked' | 'Tournament'; matchId: number | null; kos?: number }

const kindOf = (stake: string | undefined, tournament: boolean | number | null | undefined, matchId?: number | null): Fight['kind'] =>
  tournament || tournament === 0 ? 'Tournament' : (stake && stake !== '0') || matchId != null ? 'Staked' : 'Friendly';

// Local log (this browser, includes free rooms) merged with the account's on-chain matches (any device).
export function useFights(account: string | null | undefined) {
  const arena = useArena();
  const [chain] = useLoad(async () => {
    if (!account) return [] as MatchView[];
    const out: MatchView[] = [];
    // ponytail: client-side scan of list_matches; an indexer replaces this when match count grows
    for (let from = 0; from < 1000; from += 50) {
      const page = await arena.listMatches(from, 50);
      out.push(...page.filter((m) => m.host === account || m.guest === account));
      if (page.length < 50) break;
    }
    return out;
  }, [account]);
  const local = history();
  const byId = new Map(local.filter((l) => l.matchId != null).map((l) => [l.matchId!, l] as [number, MatchLog]));
  const fights: Fight[] = local.map((l) => {
    const c = chain?.find((m) => m.id === l.matchId);
    return { at: l.at, won: l.won, mine: monster(l.mine)?.name ?? 'Unknown', vs: l.vsAccount ? `${l.vs} (${short(l.vsAccount)})` : l.vs, stake: l.stake ?? '0', kind: kindOf(l.stake, c?.tournament ?? l.tournament, l.matchId), matchId: l.matchId ?? null, kos: l.kos };
  });
  for (const m of chain ?? []) {
    if (byId.has(m.id) || (m.status !== 'settled' && m.status !== 'refund') || !m.guest) continue;
    const seat = m.host === account ? 0 : 1;
    fights.push({ at: m.started_ms || m.created_ms, won: m.status === 'refund' || m.winner === null ? null : m.winner === seat, mine: m.monsters[seat] ? `#${m.monsters[seat]}` : '—', vs: short(seat ? m.host : m.guest), stake: m.stake, kind: kindOf(m.stake, m.tournament, m.id), matchId: m.id });
  }
  return fights.sort((a, b) => b.at - a.at);
}

export function Stats({ fights }: { fights: Fight[] }) {
  const wins = fights.filter((f) => f.won === true).length, losses = fights.filter((f) => f.won === false).length;
  const won = fights.reduce((t, f) => (f.won && f.kind !== 'Friendly' ? t + BigInt(f.stake) : t), 0n);
  const tiles: [string, string, string][] = [
    ['trophy', 'Wins', String(wins)], ['skull', 'Losses', String(losses)],
    ['icon-history', 'Win rate', wins + losses ? `${Math.round((wins / (wins + losses)) * 100)}%` : '—'],
    ['coin', 'NEAR won', fmt(won.toString())],
  ];
  return (
    <section className="slab stat-tiles" aria-label="Record">
      {tiles.map(([icon, label, v]) => <div key={label} className="stat-tile"><Ico n={icon} /><b>{v}</b><small>{label}</small></div>)}
    </section>
  );
}

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function History({ fights }: { fights: Fight[] }) {
  const [n, setN] = useState(10);
  return (
    <section className="slab" aria-label="Match history">
      <h2 className="row-ico"><Ico n="icon-history" />Match history</h2>
      {fights.length === 0 ? <p className="sub">No fights yet.</p> : (
        <div className="history-wrap">
          <table className="history">
            <thead><tr><th>Result</th><th>Your monster</th><th>Opponent</th><th>Stake</th><th>Type</th><th>When</th></tr></thead>
            <tbody>
              {fights.slice(0, n).map((f, i) => (
                <tr key={`${f.at}-${i}`}>
                  <td><span className={`chip row-ico ${f.won ? 'gold' : ''}`}><Ico n={f.won ? 'trophy' : f.won === null ? 'icon-refresh' : 'skull'} />{f.won ? 'Won' : f.won === null ? 'Refund' : 'Lost'}</span></td>
                  <td>{f.mine}</td>
                  <td>{f.vs}</td>
                  <td>{f.stake !== '0' ? `${fmt(f.stake)} NEAR` : '—'}</td>
                  <td><span className={`chip kind-${f.kind.toLowerCase()}`}>{f.kind}{f.matchId != null ? ` #${f.matchId}` : ''}</span></td>
                  <td className="muted">{when(f.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {fights.length > n && <button type="button" className="btn ghost" style={{ marginTop: 12 }} onClick={() => setN(n + 20)}><span>Show more ({fights.length - n})</span></button>}
    </section>
  );
}
