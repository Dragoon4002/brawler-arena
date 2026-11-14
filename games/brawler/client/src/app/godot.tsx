// /godot: hosts the Godot web export (public/godot/game/) + a NEAR test panel.
// Wallet + chain stay here in React; the Godot game asks for actions over postMessage (see games/brawler/godot/near_bridge.gd).
// Protocol (JSON strings, same origin only):
//   game -> page  {type: 'near:connect' | 'near:account' | 'near:sign' | 'near:createMatch' | 'near:cancelMatch', id, ...args}
//   page -> game  {type: 'near:result', id, ok, data | error}   and   {type: 'near:account', account}
import { useEffect, useRef, useState } from 'react';
import { CONTRACT_ID, useArena, useWallet } from '../near.ts';
import { DEMO } from '../demo.ts';
import { Ico } from './ui.tsx';

const GAME_URL = '/godot/game/index.html';
const MAX_MSG = 200;

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);

export function GodotPage() {
  const w = useWallet() as ReturnType<typeof useWallet> & { signNEP413Message?: (p: { message: string; recipient: string; nonce: Uint8Array }) => Promise<{ publicKey: unknown; signature: unknown }> };
  const arena = useArena();
  const account = w.signedAccountId || '';
  const frame = useRef<HTMLIFrameElement>(null);
  const [hasGame, setHasGame] = useState<boolean | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [matchId, setMatchId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const say = (s: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${s}`, ...l].slice(0, 30));

  // Is the export there? (Vite would otherwise fall back to this SPA's index.html.)
  useEffect(() => {
    fetch(GAME_URL, { method: 'GET' }).then((r) => r.text()).then((t) => setHasGame(!t.includes('id="root"'))).catch(() => setHasGame(false));
  }, []);

  // The three actions, shared by the buttons and the Godot bridge.
  const actions = {
    connect: async () => { if (!account) await w.signIn(); return account || null; },
    sign: async (message: string) => {
      if (!account) throw new Error('Connect wallet first');
      if (DEMO || !w.signNEP413Message) throw new Error('Signing needs a real wallet (not demo mode)');
      const nonce = crypto.getRandomValues(new Uint8Array(32));
      const s = await w.signNEP413Message({ message, recipient: CONTRACT_ID, nonce });
      return { account, message, recipient: CONTRACT_ID, nonce: b64(nonce), publicKey: String(s.publicKey), signature: String(s.signature) };
    },
    createMatch: async () => {
      if (!account) throw new Error('Connect wallet first');
      const id = await arena.createMatch(false, '0'); // free, non-bettable test room
      if (id == null) throw new Error('Room not created');
      setMatchId(id);
      return { matchId: id };
    },
    cancelMatch: async (id: number) => { await arena.cancelMatch(id); setMatchId(null); return { matchId: id, cancelled: true }; },
  };

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true); say(`${label}…`);
    try { const r = await fn(); say(`${label} ok ${r == null ? '' : JSON.stringify(r).slice(0, 220)}`); return r; }
    catch (e) { say(`${label} failed: ${errText(e)}`); throw e; }
    finally { setBusy(false); }
  };

  // Tell the game who is signed in.
  const post = (m: object) => frame.current?.contentWindow?.postMessage(JSON.stringify(m), location.origin);
  useEffect(() => { post({ type: 'near:account', account: account || null }); }, [account, hasGame]);

  // Bridge: requests from the Godot iframe. Trust boundary: same origin + our iframe only, fixed action list, validated args.
  useEffect(() => {
    const on = async (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow || typeof e.data !== 'string') return;
      let m: any; try { m = JSON.parse(e.data); } catch { return; }
      if (typeof m?.type !== 'string' || !m.type.startsWith('near:')) return;
      const id = String(m.id ?? '');
      const reply = (ok: boolean, x: unknown) => post({ type: 'near:result', id, ok, ...(ok ? { data: x } : { error: errText(x) }) });
      try {
        const data = await (m.type === 'near:connect' ? run('Godot: connect', actions.connect)
          : m.type === 'near:account' ? Promise.resolve(account || null)
          : m.type === 'near:sign' ? (typeof m.message === 'string' && m.message.length <= MAX_MSG ? run('Godot: sign', () => actions.sign(m.message)) : Promise.reject(new Error(`message must be a string of at most ${MAX_MSG} chars`)))
          : m.type === 'near:createMatch' ? run('Godot: create room', actions.createMatch)
          : m.type === 'near:cancelMatch' ? (Number.isSafeInteger(m.matchId) && m.matchId >= 0 ? run('Godot: cancel room', () => actions.cancelMatch(m.matchId)) : Promise.reject(new Error('matchId must be a non-negative integer')))
          : Promise.reject(new Error(`unknown action ${m.type}`)));
        reply(true, data);
      } catch (err) { reply(false, err); }
    };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  });

  return (
    <main className="godot-page">
      <header className="godot-head">
        <a className="btn ghost" href="/"><span><Ico n="icon-close" />Back</span></a>
        <h1>Godot client</h1>
        <span className="sub">contract {CONTRACT_ID}{DEMO ? ' · demo mode' : ''}</span>
      </header>

      <section className="godot-stage">
        {hasGame ? <iframe ref={frame} src={GAME_URL} title="Godot game" allow="gamepad; fullscreen" />
          : (
            <div className="godot-empty slab">
              <h3>{hasGame === null ? 'Looking for the Godot export…' : 'No Godot export yet'}</h3>
              {hasGame === false && <p className="sub">Export your project for Web to <code>games/brawler/client/public/godot/game/</code> (file name <code>index.html</code>, Thread Support off), then reload. Autoload <code>games/brawler/godot/near_bridge.gd</code> to reach the wallet from GDScript.</p>}
            </div>
          )}
      </section>

      <aside className="godot-panel slab">
        <h3 className="row-ico"><Ico n="icon-wallet" />Wallet test</h3>
        <p className="sub">{account ? <>Signed in as <b>{account}</b></> : 'Not connected'}</p>
        <div className="godot-btns">
          {!account
            ? <button className="btn" disabled={busy} onClick={() => run('Connect', actions.connect).catch(() => {})}><span><Ico n="icon-wallet" />Connect wallet</span></button>
            : <button className="btn ghost" disabled={busy} onClick={() => w.signOut()}><span>Disconnect</span></button>}
          <button className="btn" disabled={busy || !account} onClick={() => run('Sign message', () => actions.sign(`brawler-arena:godot-test:${Date.now()}`)).catch(() => {})}><span><Ico n="icon-check" />Sign message</span></button>
          <button className="btn" disabled={busy || !account} onClick={() => run('Create fight room', actions.createMatch).catch(() => {})}><span><Ico n="icon-play" />Create fight room (0 NEAR)</span></button>
          {matchId !== null && <button className="btn ghost" disabled={busy} onClick={() => run('Cancel room', () => actions.cancelMatch(matchId)).catch(() => {})}><span><Ico n="icon-close" />Cancel room #{matchId}</span></button>}
        </div>
        <ol className="godot-log" aria-live="polite">{log.map((l, i) => <li key={i}>{l}</li>)}</ol>
      </aside>
    </main>
  );
}
