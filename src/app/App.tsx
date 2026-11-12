import { useEffect, useState } from 'react';
import { NearProvider, useNearWallet } from 'near-connect-hooks';
import { Logo } from './ui.tsx';
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

const NAV = [['play', 'Play'], ['lobby', 'Lobby'], ['collection', 'Collection'], ['breed', 'Breed'], ['account', 'Account']] as const;

function Bar({ here }: { here: string }) {
  const { signedAccountId } = useNearWallet();
  return (
    <header className="wrap bar">
      <a href="#/" aria-label="Home"><Logo className="logo" /></a>
      <nav aria-label="Main">
        {NAV.map(([k, label]) => <a key={k} className="navlink" href={`#/${k}`} aria-current={here === k ? 'page' : undefined}>{label}</a>)}
      </nav>
      <a className="wallet-chip" href="#/account">{signedAccountId || 'Connect wallet'}</a>
    </header>
  );
}

function Routes() {
  const [page = '', arg] = useHash();
  if (page === 'fight') return <Arena />;
  if (page === 'watch' && arg) return <Watch code={arg} />;
  if (page === '') return <Title />;
  const body = page === 'play' ? <Play />
    : page === 'lobby' ? <Lobby />
    : page === 'collection' ? <Collection />
    : page === 'monster' && arg ? <Detail id={arg} />
    : page === 'breed' ? <Breed />
    : page === 'account' ? <Account />
    : <Title />;
  return (
    <>
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
