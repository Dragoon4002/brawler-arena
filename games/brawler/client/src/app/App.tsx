import { useEffect, useState } from 'react';
import { NearProvider, NETWORK } from '@xyz/platform';
import { DEMO } from '../demo.ts';
import { DemoIndex } from './demo.tsx';
import { MarketSim } from './sim.tsx';
import { Title, Play, Collection, Detail, Breed, Account } from './screens.tsx';
import { Arena } from './arena.tsx';
import { Lobby, Watch } from './rooms.tsx';
import { Market, Season, TournamentPage, Tournaments } from './economy.tsx';
import { GodotPage } from './godot.tsx';

function useHash() {
  const [h, setH] = useState(location.hash || '#/');
  useEffect(() => {
    const on = () => { setH(location.hash || '#/'); scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return h.slice(1).split('/').filter(Boolean); // '#/monster/abc' -> ['monster','abc']
}

function Routes() {
  const [page = '', arg] = useHash();
  if (location.pathname.replace(/\/+$/, '') === '/godot') return <GodotPage />; // path route: export lives under /godot/game/
  if (page === 'fight') return <Arena key={arg} demo={DEMO ? arg : undefined} />;
  if (page === 'watch' && arg) return <Watch key={arg} code={arg} />;
  if (page === '') return <Title />;
  const body = page === 'demo' ? <DemoIndex />
    : page === 'sim' ? <MarketSim />
    : page === 'play' ? <Play />
    : page === 'lobby' ? <Lobby />
    : page === 'collection' ? <Collection />
    : page === 'monster' && arg ? <Detail key={arg} id={arg} />
    : page === 'breed' ? <Breed />
    : page === 'market' ? <Market />
    : page === 'season' ? <Season />
    : page === 'tournaments' ? <Tournaments />
    : page === 'tournament' && arg ? <TournamentPage id={+arg} />
    : page === 'account' ? <Account />
    : null; // unknown route -> plain title
  return <Title page={page === 'monster' ? 'collection' : page === 'tournament' ? 'tournaments' : page}>{body}</Title>;
}

export function App() {
  return (
    <NearProvider config={{ network: NETWORK }}>
      <div className="backdrop" />
      <Routes />
    </NearProvider>
  );
}
