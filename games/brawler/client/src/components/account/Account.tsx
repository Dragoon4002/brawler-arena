import { useEffect, useState } from 'react';
import { yoctoToNear } from 'near-api-js';
import { getAudio, setAudio } from '@/lib/audio.ts';
import { fmt, useUnifiedBalance, useWallet } from '@/lib/near.ts';
import { useMonsters } from '@/lib/nft.ts';
import { monsters } from '@/lib/store.ts';
import { Ico } from '@/components/ui.tsx';
import { Claims } from './Claims.tsx';
import { FundsDialog } from './Funds.tsx';
import { History, Stats, useFights } from './History.tsx';

export function Account() {
  const { signedAccountId, signIn, signOut, getBalance, loading, network } = useWallet();
  const { balance } = useUnifiedBalance();
  const [bal, setBal] = useState<string>('');
  useEffect(() => {
    if (!signedAccountId) return setBal('');
    getBalance(signedAccountId).then((y: bigint) => setBal(Number(yoctoToNear(y)).toFixed(3))).catch(() => setBal('unavailable'));
  }, [signedAccountId, getBalance]);
  const fights = useFights(signedAccountId);
  const api = useMonsters();
  const [owed, setOwed] = useState('0');
  const [funds, setFunds] = useState(false);
  useEffect(() => { if (signedAccountId) api.owed().then(setOwed).catch(() => {}); }, [signedAccountId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div><h1 className="row-ico"><Ico n="icon-wallet" className="ico h" />Account</h1><p className="sub">Your NEAR account owns your monsters. Network: {network}.</p></div>
      <div className="split">
        <section className="slab" style={{ display: 'grid', gap: 14 }}>
          {loading ? <p>Checking wallet…</p> : signedAccountId ? (
            <>
              <h2 style={{ overflowWrap: 'anywhere' }}>{signedAccountId}</h2>
              <dl className="kv"><dt>Game balance</dt><dd className="row-ico"><Ico n="coin-stack" />{balance === null ? 'loading…' : `${fmt(balance)} NEAR`} <button type="button" className="link" onClick={() => setFunds(true)}>Deposit / withdraw</button></dd><dt>Wallet</dt><dd className="row-ico"><Ico n="coin" />{bal ? `${bal} NEAR` : 'loading…'}</dd><dt>Monsters</dt><dd className="row-ico"><Ico n="icon-monster" />{monsters().length}</dd></dl>
              {owed !== '0' && <button className="btn" onClick={() => api.withdrawOwed().then(() => setOwed('0'))}><span><Ico n="coin" />Withdraw {fmt(owed)} NEAR from failed payouts</span></button>}
              <button className="btn ghost" onClick={() => signOut()}><span><Ico n="icon-close" />Disconnect</span></button>
            </>
          ) : (
            <>
              <h2>Connect a wallet</h2>
              <p className="sub">Sign in once. Stakes and bets use your game balance.</p>
              <button className="btn" onClick={() => signIn()}><span><Ico n="icon-wallet" />Connect NEAR wallet</span></button>
            </>
          )}
        </section>
        <Stats fights={fights} />
      </div>
      {funds && <FundsDialog onClose={() => setFunds(false)} />}
      <Claims />
      <History fights={fights} />
      <SoundSettings />
    </>
  );
}

function SoundSettings() {
  const [a, setA] = useState(getAudio);
  const set = (p: Parameters<typeof setAudio>[0]) => setA({ ...setAudio(p) });
  return (
    <section className="slab" style={{ display: 'grid', gap: 12 }} aria-label="Sound">
      <h2 className="row-ico"><Ico n={a.muted ? 'icon-sound-off' : 'icon-sound-on'} />Sound</h2>
      <label className="row">Music
        <input type="range" min={0} max={1} step={0.05} value={a.music} onChange={(e) => set({ music: +e.target.value })} style={{ flex: 1, minHeight: 0, padding: 0 }} />
      </label>
      <label className="row">Effects
        <input type="range" min={0} max={1} step={0.05} value={a.sfx} onChange={(e) => set({ sfx: +e.target.value })} style={{ flex: 1, minHeight: 0, padding: 0 }} />
      </label>
      <label className="row"><input type="checkbox" checked={a.muted} onChange={(e) => set({ muted: e.target.checked })} style={{ minHeight: 0 }} /> Mute everything (M in a fight)</label>
    </section>
  );
}
