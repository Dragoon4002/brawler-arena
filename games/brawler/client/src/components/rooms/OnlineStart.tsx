import { useState } from 'react';
import type { Monster } from '@/lib/genes.ts';
import type { StageId } from '@/lib/stages.ts';
import { DEMO } from '@/lib/demo.ts';
import { peekRoom } from '@/lib/lobby.ts';
import { fmt, toYocto, useArena } from '@/lib/near.ts';
import { errText } from '@/lib/format.ts';
import { prepareFight } from '@/components/Arena.tsx';
import { Ico } from '@/components/ui.tsx';

type Arena = ReturnType<typeof useArena>;

// On-chain monsters (NftMonster has `owner`) are locked in the match; local demo-store monsters aren't.
const BUSY = 'Monster busy or unavailable. Stake refunded.';
const chainId = (m: Monster) => ('owner' in m ? m.id : undefined);

export async function joinRoom(arena: Arena, code: string, mon: Monster, say: (t: string) => void) {
  say('Looking up room…');
  const r = await peekRoom(code);
  if (!r) return say('Room not found.');
  if (r.status !== 'waiting') return say('That fight already started. You can watch it from the lobby.');
  if (r.matchId !== null) {
    if (!arena.ready) return say('Betting contract not configured on this build.');
    if (!arena.account) { say('Connect your NEAR wallet to join a staked or bettable room.'); return arena.signIn(); }
    if (r.players[0]?.account === arena.account) return say('You are the host of that room.');
    say(r.stake === '0' ? 'Confirm the join in your wallet…' : `Confirm in your wallet: ${fmt(r.stake)} NEAR stake from your balance…`);
    if ((await arena.joinMatch(r.matchId, r.stake, chainId(mon))) !== true && !DEMO) return say(BUSY); // demo returns null
  }
  prepareFight({ kind: 'join', mon, code: r.code, stage: r.stage, account: arena.account ?? '', matchId: r.matchId });
}

export function OnlineStart({ mon, stage }: { mon: Monster; stage: StageId }) {
  const arena = useArena();
  const [pub, setPub] = useState(true);
  const [bettable, setBettable] = useState(false);
  const [view, setView] = useState(true);
  const [stake, setStake] = useState('0');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const onChain = bettable || Number(stake) > 0;

  const create = async () => {
    setBusy(true); setMsg('');
    try {
      let matchId: number | null = null;
      const stakeY = Number(stake) > 0 ? toYocto(stake) : '0';
      if (onChain) {
        if (!arena.ready) throw new Error('Betting contract not configured on this build.');
        if (!arena.account) { setMsg('Connect your NEAR wallet first.'); await arena.signIn(); return; }
        setMsg('Confirm in your wallet…');
        matchId = await arena.createMatch(bettable, stakeY, chainId(mon));
        if (typeof matchId !== 'number' || !Number.isInteger(matchId)) { setMsg(BUSY); return; }
      }
      prepareFight({ kind: 'host', mon, stage, opts: { pub, view: pub || view, bettable, matchId, stake: stakeY, account: arena.account ?? '' } });
    } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };
  const join = async () => {
    setBusy(true);
    try { await joinRoom(arena, code, mon, setMsg); } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };

  return (
    <div className="split">
      <section className="slab" aria-label="Create a room" style={{ display: 'grid', gap: 16 }}>
        <h3 className="row-ico"><Ico n="icon-room-public" />Create a room</h3>
        <div className="row" role="radiogroup" aria-label="Visibility">
          <button type="button" role="radio" aria-checked={pub} className={`chip row-ico ${pub ? 'gold' : ''}`} onClick={() => setPub(true)}><Ico n="icon-room-public" />Public, listed in lobby</button>
          <button type="button" role="radio" aria-checked={!pub} className={`chip row-ico ${!pub ? 'gold' : ''}`} onClick={() => setPub(false)}><Ico n="icon-room-private" />Private, code only</button>
        </div>
        {!pub && <label className="toggle"><input type="checkbox" checked={view} onChange={(e) => setView(e.target.checked)} /> Let anyone watch (listed in lobby as watch-only)</label>}
        <label className="toggle"><input type="checkbox" checked={bettable} onChange={(e) => setBettable(e.target.checked)} /> Let spectators bet on this fight</label>
        <label className="row"><Ico n="coin-stack" />Your stake
          <input type="number" min="0" step="0.01" value={stake} onChange={(e) => setStake(e.target.value)} aria-label="Stake in NEAR" style={{ width: 130 }} /> NEAR
        </label>
        <p className="note">{onChain ? 'Your opponent matches the stake. Winner takes both, minus 0.1%. Needs a wallet signature.' : 'Friendly match, nothing on-chain.'}</p>
        <button className="btn big" disabled={busy} onClick={create}><span><Ico n={onChain ? 'coin' : 'icon-check'} />{onChain ? 'Create and stake' : 'Create room'}</span></button>
      </section>
      <section className="slab" aria-label="Join a room" style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
        <h3 className="row-ico"><Ico n="icon-room-private" />Join by code</h3>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Room code" maxLength={4} aria-label="Room code" />
        <button className="btn alt" disabled={busy || code.length !== 4} onClick={join}><span><Ico n="icon-check" />Join</span></button>
        <a className="btn ghost" href="#/lobby"><span><Ico n="icon-lobby" />Browse public lobby</span></a>
        {msg && <p className="note" role="status">{msg}</p>}
      </section>
    </div>
  );
}
