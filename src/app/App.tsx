import { useEffect, useState } from 'react';
import { NearProvider } from 'near-connect-hooks';
import { useWallet } from '../near.ts';
import { DEMO } from '../demo.ts';
import { DemoIndex } from './demo.tsx';
import { MarketSim } from './sim.tsx';
import { Ico, Logo } from './ui.tsx';
import { Title, Play, Collection, Detail, Breed, Account } from './screens.tsx';
import { Arena } from './arena.tsx';
import { Lobby, Watch } from './rooms.tsx';

export const NETWORK = 'testnet' as const;

function useHash() {
  const [h, setH] = useState(location.hash || '#/');
  useEffect(() => {
    const on = () => { setH(location.hash || '#/'); scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return h.slice(1).split('/').filter(Boolean); // '#/monster/abc' -> ['monster','abc']
}

const NAV = [['play', 'Play', 'icon-play'], ['lobby', 'Lobby', 'icon-lobby'], ['collection', 'Collection', 'icon-monster'], ['breed', 'Breed', 'icon-breed'], ['account', 'Account', 'icon-wallet']] as const;

function Bar({ here }: { here: string }) {
  const { signedAccountId } = useWallet();
  return (
    <header className="wrap bar">
      <a href="#/" aria-label="Home"><Logo className="logo" /></a>
      <nav aria-label="Main">
        {NAV.map(([k, label, icon]) => <a key={k} className="navlink row-ico" href={`#/${k}`} aria-current={here === k ? 'page' : undefined}><Ico n={icon} />{label}</a>)}
      </nav>
      <a className="wallet-chip row-ico" href="#/account"><Ico n="icon-wallet" />{signedAccountId || 'Connect wallet'}</a>
    </header>
  );
}

function Routes() {
  const [page = '', arg] = useHash();
  if (page === 'fight') return <Arena key={arg} demo={DEMO ? arg : undefined} />;
  if (page === 'watch' && arg) return <Watch key={arg} code={arg} />;
  if (page === '') return <Title />;
  const body = page === 'demo' ? <DemoIndex />
    : page === 'sim' ? <MarketSim />
    : page === 'play' ? <Play />
    : page === 'lobby' ? <Lobby />
    : page === 'collection' ? <Collection />
    : page === 'monster' && arg ? <Detail id={arg} />
    : page === 'breed' ? <Breed />
    : page === 'account' ? <Account />
    : <Title />;
  return (
    <>
      {DEMO && <a className="demo-ribbon" href="/">Demo mode with fake data. Click to exit</a>}
      <Bar here={page === 'monster' ? 'collection' : page} />
      <main className="wrap page">{body}</main>
    </>
  );
}

export function App() {
  return (
    <NearProvider config={{ network: NETWORK }}>
      <div className="backdrop" />
      <Routes />
    </NearProvider>
  );
}
