import { fmt, useWallet } from '@/lib/near.ts';
import { useMonsters, type NftMonster, type Vault } from '@/lib/nft.ts';
import { useAct, useLoad } from '@/hooks/async.ts';
import { Ico, Portrait } from '@/components/ui.tsx';
import { useChainDetails } from '@/lib/chain.ts';

export function Holders() {
  const { u } = useChainDetails();
  const api = useMonsters();
  const { signedAccountId, signIn } = useWallet();
  const me = signedAccountId ?? '';
  const [rows, reload] = useLoad(async () => {
    const own = (await api.mine()).filter((m) => m.owner === me);
    return Promise.all(own.map(async (m) => ({ m, v: await api.vault(m.id) }))) as Promise<{ m: NftMonster; v: Vault }[]>;
  }, [me]);
  const act = useAct(reload);
  if (!me) return <section className="slab"><h2 className="row-ico"><Ico n="icon-wallet" />Holders only</h2><p className="sub">Connect a wallet that holds a monster to enter.</p><button className="btn" onClick={() => signIn()}><span>Connect</span></button></section>;
  if (!rows) return <p>Checking your monsters on-chain…</p>;
  if (rows.length === 0) return <section className="slab"><h2 className="row-ico"><Ico n="icon-close" />Holders only</h2><p className="sub">This page opens for accounts that own a monster NFT. Rented monsters don't count.</p><a className="btn" href="/market"><span><Ico n="coin-stack" />Get a monster</span></a></section>;
  const total = rows.reduce((a, r) => a + BigInt(r.v.balance), 0n), earned = rows.reduce((a, r) => a + BigInt(r.v.earned), 0n);
  return (
    <>
      <div><h1 className="row-ico"><Ico n="trophy" />Holders' vault room</h1><p className="sub">Only holders see this. Every monster you own keeps its own earnings; withdraw is checked on-chain against the current owner.</p></div>
      <section className="slab"><dl className="kv"><dt>Monsters held</dt><dd>{rows.length}</dd><dt>In vaults</dt><dd className="row-ico"><Ico n="coin" />{fmt(total.toString())} {u}</dd><dt>Earned all time</dt><dd>{fmt(earned.toString())} {u}</dd></dl></section>
      <div className="grid">
        {rows.map(({ m, v }) => (
          <section key={m.id} className="slab" style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
            <Portrait dna={m.dna} size={140} />
            <a href={`/monster/${m.id}`}><h3>{m.name}</h3></a>
            <span className="chip gold row-ico"><Ico n="coin" />{fmt(v.balance)} {u}</span>
            <button className="btn" disabled={act.busy || !!m.price || v.balance === '0'} onClick={() => act.run(() => api.vaultWithdraw(m.id), `Withdrew ${m.name}'s vault.`)}><span>{m.price ? 'Frozen: listed' : 'Withdraw'}</span></button>
          </section>
        ))}
      </div>
      {act.msg && <p className="note" role="status">{act.msg}</p>}
    </>
  );
}
