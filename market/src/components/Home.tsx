import { NearProvider, NETWORK } from '@xyz/platform';
import { Wallet } from '@/components/Wallet.tsx';

const GAMES = [
  { id: 'brawler', name: 'Brawler Arena', blurb: 'Real-time monster platform fighter. Stake, bet, run tournaments.', url: process.env.NEXT_PUBLIC_BRAWLER_URL ?? 'https://brawler.xyz.com' },
];

function Home() {
  return (
    <main className="wrap">
      <header><h1>XYZ Games</h1><p className="sub">Network: {NETWORK}</p></header>
      <div className="split">
        <section aria-label="Games" className="games">
          {GAMES.map((g) => (
            <a key={g.id} className="slab game" href={g.url}>
              <h2>{g.name}</h2><p className="sub">{g.blurb}</p><span className="btn">Play</span>
            </a>
          ))}
        </section>
        <Wallet />
      </div>
    </main>
  );
}

export const App = () => <NearProvider config={{ network: NETWORK }}><Home /></NearProvider>;
