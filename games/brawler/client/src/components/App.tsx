import { useEffect, useState } from 'react';
import { NearProvider, NETWORK } from '@xyz/platform';
import { DEMO } from '@/lib/demo.ts';
import { go, route } from '@/lib/nav.ts';
import { Account } from '@/components/account/Account.tsx';
import { Arena } from '@/components/Arena.tsx';
import { DemoIndex } from '@/components/demo/DemoIndex.tsx';
import { MarketSim } from '@/components/demo/MarketSim.tsx';
import { Market } from '@/components/economy/Market.tsx';
import { Season } from '@/components/economy/Season.tsx';
import { TournamentPage } from '@/components/economy/TournamentPage.tsx';
import { Tournaments } from '@/components/economy/Tournaments.tsx';
import { GodotPage } from '@/components/GodotPage.tsx';
import { Breed } from '@/components/monsters/Breed.tsx';
import { Collection } from '@/components/monsters/Collection.tsx';
import { Detail } from '@/components/monsters/Detail.tsx';
import { Play } from '@/components/Play.tsx';
import { Lobby } from '@/components/rooms/Lobby.tsx';
import { Watch } from '@/components/rooms/Watch.tsx';
import { Title } from '@/components/Title.tsx';

// old bookmarks used #/path
if (location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1) + location.search);

// In-app links switch screens without a reload so the room's WebSocket survives. /godot is a separate Next page.
function onLinkClick(e: MouseEvent) {
  if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element).closest?.('a[href^="/"]');
  const href = a?.getAttribute('href');
  if (!a || !href || a.hasAttribute('target') || a.hasAttribute('download') || href.startsWith('/godot')) return;
  e.preventDefault();
  go(href);
}

function usePath() {
  const [p, setP] = useState(route);
  useEffect(() => {
    const on = () => { setP(route()); scrollTo(0, 0); };
    addEventListener('popstate', on);
    document.addEventListener('click', onLinkClick);
    return () => { removeEventListener('popstate', on); document.removeEventListener('click', onLinkClick); };
  }, []);
  return p;
}

function Routes() {
  const [page = '', arg, arg2] = usePath();
  if (page === 'fight') return <Arena key={arg} demo={DEMO ? arg : undefined} />;
  if (page === 'watch' && arg) return <Watch key={arg} code={arg} />;
  if (page === '') return <Title />;
  const body = page === 'demo' ? <DemoIndex />
    : page === 'sim' ? <MarketSim />
    : page === 'play' ? <Play initial={arg === 'join' ? 'join' : 'create'} invite={arg === 'join' ? arg2 : undefined} />
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <NearProvider config={{ network: NETWORK }}>
      <div className="backdrop" />
      {children}
    </NearProvider>
  );
}

export const App = () => <Shell><Routes /></Shell>;
export const GodotApp = () => <Shell><GodotPage /></Shell>;
