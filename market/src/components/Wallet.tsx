import { useEffect, useState } from 'react';
import { fmt, toYocto, useBalance, usePlatform } from '@xyz/platform';

const RESERVE = 5n * 10n ** 22n; // 0.05 NEAR kept in wallet for gas

const parse = (v: string, max: bigint | null, what: string): [bigint, string] => {
  let y: bigint;
  try { y = BigInt(toYocto(v.trim())); } catch { return [0n, 'Enter an amount in NEAR, like 0.5.']; }
  if (y <= 0n) return [0n, 'Enter an amount above 0.'];
  if (max !== null && y > max) return [0n, `Max ${fmt(max)} NEAR (${what}).`];
  return [y, ''];
};

export function Wallet() {
  const p = usePlatform();
  const { w } = p;
  const acct = w.signedAccountId;
  const { balance } = useBalance();
  const [wallet, setWallet] = useState<bigint | null>(null);
  const [amt, setAmt] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!acct) return setWallet(null);
    w.getBalance(acct).then(setWallet).catch(() => setWallet(null));
  }, [acct, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  if (w.loading) return <section className="slab"><p>Checking wallet…</p></section>;
  if (!acct) return (
    <section className="slab">
      <h2>Connect wallet</h2>
      <p className="sub">One balance for every game. Deposit once, play anywhere.</p>
      <button className="btn" onClick={() => w.signIn()}>Connect NEAR wallet</button>
    </section>
  );
  const run = async (kind: 'deposit' | 'withdraw') => {
    const max = kind === 'deposit' ? (wallet === null ? null : wallet > RESERVE ? wallet - RESERVE : 0n) : balance === null ? null : BigInt(balance);
    const [y, err] = parse(amt, max, kind === 'deposit' ? 'wallet minus gas' : 'game balance');
    if (err) return setMsg(err);
    setBusy(true); setMsg('Confirm in your wallet…');
    try {
      await (kind === 'deposit' ? p.deposit(y.toString()) : p.withdraw(y.toString()));
      setMsg(kind === 'deposit' ? `Deposited ${fmt(y)} NEAR.` : `Withdrew ${fmt(y)} NEAR.`); setAmt('');
    } catch (e) { setMsg(((e as Error)?.message ?? String(e)).slice(0, 160)); } finally { setBusy(false); }
  };
  return (
    <section className="slab" aria-label="Balance">
      <h2 style={{ overflowWrap: 'anywhere' }}>{acct}</h2>
      <dl className="kv">
        <dt>Game balance</dt><dd>{balance === null ? 'loading…' : `${fmt(balance)} NEAR`}</dd>
        <dt>Wallet</dt><dd>{wallet === null ? '…' : `${fmt(wallet)} NEAR`}</dd>
      </dl>
      <form className="row" onSubmit={(e) => { e.preventDefault(); run('deposit'); }}>
        <input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.5" value={amt} onChange={(e) => setAmt(e.target.value)} aria-label="Amount in NEAR" />
        <button className="btn" disabled={busy}>Deposit</button>
        <button className="btn ghost" type="button" disabled={busy} onClick={() => run('withdraw')}>Withdraw</button>
      </form>
      <p className="sub" role="status">{msg}</p>
      <button className="btn ghost" onClick={() => w.signOut()}>Disconnect</button>
    </section>
  );
}

