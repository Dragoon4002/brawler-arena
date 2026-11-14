import { useEffect, useMemo, useRef, useState } from 'react';
import { archetype } from '@/lib/genes.ts';
import { STAGES, STAGE_IDS, type StageId } from '@/lib/stages.ts';
import { DEMO } from '@/lib/demo.ts';
import { fmt, MARKET_URL, useUnifiedBalance, useWallet } from '@/lib/near.ts';
import { monsters } from '@/lib/store.ts';
import { ArenaBackdrop, Ico, Logo, Portrait, STAGE_ICON, StageThumb, TYPE_ICON } from '@/components/ui.tsx';

function HubBtn({ href, label, icon, badge, active }: { href: string; label: string; icon: string; badge?: number; active?: boolean }) {
  return (
    <div className="hub-slot">
      <a className="hub-btn" href={href} aria-current={active ? 'page' : undefined}>
        <Ico n={icon} className="hub-btn-ico" />
        <span>{label}</span>
        {badge ? <b className="hub-badge">{badge}</b> : null}
      </a>
    </div>
  );
}

const PANEL_FROM: Record<string, 'left' | 'right' | 'bottom'> = { collection: 'left', breed: 'left', market: 'left', account: 'left', lobby: 'right', tournaments: 'right', season: 'right', play: 'bottom' };

function HubDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="hub-dialog" aria-label={title} onClose={onClose} onClick={(e) => e.target === ref.current && ref.current?.close()}>
      <header><h2>{title}</h2><button type="button" className="hub-x" aria-label="Close" onClick={() => ref.current?.close()}><Ico n="icon-close" /></button></header>
      {children}
    </dialog>
  );
}

export function Title({ page, children }: { page?: string; children?: React.ReactNode }) {
  const list = useMemo(monsters, []);
  const { signedAccountId } = useWallet();
  const { balance } = useUnifiedBalance();
  const [i, setI] = useState(0);
  const [stage, setStage] = useState<StageId>('ember');
  const [pop, setPop] = useState<'mon' | 'map' | null>(null);
  const m = list[i];
  const wins = list.reduce((s, x) => s + x.record.w, 0), kos = list.reduce((s, x) => s + x.record.ko, 0);
  const step = (d: number) => setI((i + d + list.length) % list.length);
  return (
    <div className={`hub ${children ? 'open' : ''}`}>
      <ArenaBackdrop id={stage} className="hub-bg" />
      <header className="hub-top">
        <a href="#/" aria-label="Home"><Logo className="hub-logo" /></a>
        <div className="hub-counters">
          <span className="hub-count" title="Total wins"><Ico n="trophy" /><i>Wins</i>{wins}</span>
          <span className="hub-count" title="Total knockouts"><Ico n="ko" /><i>KOs</i>{kos}</span>
          {signedAccountId && <a className="hub-count" href={MARKET_URL} title="Unified balance, top up on market"><Ico n="coin" /><i>Balance</i>{balance === null ? '…' : `${fmt(balance)} NEAR`}</a>}
          <a className="hub-count wallet" href="#/account"><Ico n="icon-wallet" />{signedAccountId || 'Connect wallet'}</a>
          {DEMO && <a className="hub-count demo" href="/">Demo mode · exit</a>}
        </div>
      </header>

      <nav className="hub-side left" aria-label="Monsters">
        <HubBtn href="#/collection" label="Monsters" icon="icon-monster" badge={list.length} active={page === 'collection'} />
        <HubBtn href="#/breed" label="Breed" icon="icon-breed" active={page === 'breed'} />
        <HubBtn href="#/market" label="Market" icon="coin-stack" active={page === 'market'} />
        <HubBtn href="#/account" label="Account" icon="icon-wallet" active={page === 'account'} />
      </nav>

      <section className="hub-hero" aria-label="Your monster" inert={!!children}>
        <div className="hub-tags">
          <span className="hub-tag gen"><Ico n="dna" />Gen {m.gen}</span>
          <span className="hub-tag rec"><Ico n="trophy" />{m.record.w}W · {m.record.l}L</span>
          <span className="hub-tag"><Ico n={TYPE_ICON[archetype(m.dna)]} />{archetype(m.dna)}</span>
        </div>
        <button type="button" className="hub-mon" aria-label={`Choose monster, current ${m.name}`} onClick={() => setPop('mon')}>
          <Portrait key={m.id} dna={m.dna} size={420} className="" />
        </button>
        <div className="hub-name">
          {list.length > 1 && <button type="button" className="hub-arrow" onClick={() => step(-1)} aria-label="Previous monster">◀</button>}
          <button type="button" className="hub-plate" onClick={() => setPop('mon')}><h1>{m.name}</h1><small>Change monster</small></button>
          {list.length > 1 && <button type="button" className="hub-arrow" onClick={() => step(1)} aria-label="Next monster">▶</button>}
        </div>
      </section>

      <nav className="hub-side right" aria-label="Online">
        <HubBtn href="#/lobby" label="Lobby" icon="icon-lobby" active={page === 'lobby'} />
        <HubBtn href="#/tournaments" label="Cups" icon="trophy" active={page === 'tournaments'} />
        <HubBtn href="#/season" label="Season" icon="icon-history" active={page === 'season'} />
      </nav>

      {children && (
        <main key={page} className={`hub-panel from-${PANEL_FROM[page ?? ''] ?? 'bottom'}`}>
          <a className="hub-close panel-x" href="#/" aria-label="Close"><Ico n="icon-close" /></a>
          <div className="page">{children}</div>
        </main>
      )}

      <footer className="hub-bottom" inert={!!children}>
        {/* ponytail: arena pick here only changes the backdrop; Play still has its own picker */}
        <button type="button" className="hub-event" onClick={() => setPop('map')}>
          <StageThumb id={stage} className="hub-event-thumb" />
          <small>Arena · tap to change</small>
          <b>{STAGES[stage].name}</b>
          <span>{STAGES[stage].blurb}</span>
        </button>
        <a className="hub-play" href="#/play"><span><Ico n="icon-play" />Play</span></a>
      </footer>

      {pop === 'mon' && (
        <HubDialog title="Choose your monster" onClose={() => setPop(null)}>
          <div className="hub-pick">
            {list.map((x, j) => (
              <button key={x.id} type="button" className="hub-card" aria-pressed={j === i} onClick={() => { setI(j); setPop(null); }}>
                <Portrait dna={x.dna} size={220} className="" />
                <b>{x.name}</b>
                <span className="row-ico"><Ico n={TYPE_ICON[archetype(x.dna)]} />Gen {x.gen} · {archetype(x.dna)} · {x.record.w}W {x.record.l}L</span>
              </button>
            ))}
          </div>
          <a className="hub-link row-ico" href="#/collection"><Ico n="icon-monster" />Manage collection</a>
        </HubDialog>
      )}
      {pop === 'map' && (
        <HubDialog title="Choose arena" onClose={() => setPop(null)}>
          <div className="hub-pick maps">
            {STAGE_IDS.map((id) => (
              <button key={id} type="button" className="hub-card" aria-pressed={id === stage} onClick={() => { setStage(id); setPop(null); }}>
                <StageThumb id={id} className="hub-card-thumb" />
                <b className="row-ico"><Ico n={STAGE_ICON[id]} />{STAGES[id].name}</b>
                <span>{STAGES[id].blurb}</span>
              </button>
            ))}
          </div>
        </HubDialog>
      )}
    </div>
  );
}
