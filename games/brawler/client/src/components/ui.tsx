import { useEffect, useRef } from 'react';
import { archetype, lookOf, STAT_KEYS, type Dna, type Monster } from '@/lib/genes.ts';
import { drawMonster, idlePose, type Pose } from '@/lib/render/rig.ts';
import { drawHero, hero, heroOf } from '@/lib/render/cutout.ts';
import { drawStageThumb } from '@/lib/render/stage.ts';
import type { StageId } from '@/lib/stages.ts';

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// UI art lives in Vercel Blob (store brawler-arena-ui), not in the repo. Override with NEXT_PUBLIC_ASSET_URL=/ui to use a local public/ui copy.
const ASSET_URL = process.env.NEXT_PUBLIC_ASSET_URL ?? 'https://oimajowqffhgowbd.public.blob.vercel-storage.com/ui';
const ASSET_V = 2; // bump after re-uploading art (Blob files are cached for a year)
export const asset = (name: string) => `${ASSET_URL}/${name}.webp?v=${ASSET_V}`;
// CSS can't build url() from a variable, so expose the images theme.css uses as --img-<name>.
for (const n of ['btn-orange', 'btn-gold', 'btn-teal', 'btn-dark', 'btn-red']) document.documentElement.style.setProperty(`--img-${n}`, `url("${asset(n)}")`);

export function Logo({ className }: { className?: string }) {
  return <img className={className} src={asset('logo')} alt="Brawler Arena" draggable={false} />;
}

// Decorative sheet icon (sized by CSS, 1.3em by default). Text next to it carries the meaning.
export function Ico({ n, className = 'ico' }: { n: string; className?: string }) {
  return <img className={className} src={asset(n)} alt="" aria-hidden="true" draggable={false} />;
}

export const TYPE_ICON = { Bruiser: 'type-bruiser', Duelist: 'type-duelist', Bulwark: 'type-bulwark', Skirmisher: 'type-skirmisher' } as Record<string, string>;
export const STAGE_ICON = { ember: 'arena-ember', grove: 'arena-grove', docks: 'arena-docks' } as Record<StageId, string>;

export function Portrait({ dna, size = 200, pose, flip = false, className = 'portrait' }: { dna: Dna; size?: number; pose?: Pose; flip?: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!, ctx = c.getContext('2d')!;
    const dpr = devicePixelRatio || 1;
    c.width = size * dpr; c.height = size * dpr;
    const look = lookOf(dna);
    let raf = 0, t = 0;
    const paint = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const k = size / 170;
      ctx.translate(size / 2, size * 0.86); ctx.scale(k * (flip ? -1 : 1), k);
      ctx.fillStyle = 'rgb(12 8 22 / 0.35)';
      ctx.beginPath(); ctx.ellipse(0, 4, 38, 8, 0, 0, Math.PI * 2); ctx.fill();
      const h = hero(heroOf(dna)); // vector monster until the hero's parts load
      if (h) drawHero(ctx, pose ?? idlePose(t), h, false); else drawMonster(ctx, pose ?? idlePose(t), look, false);
      t++;
      if (!h || (!reduceMotion() && !pose)) raf = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(raf);
  }, [dna, size, pose, flip]);
  return <canvas ref={ref} className={className} style={{ width: '100%', maxWidth: size, aspectRatio: '1', justifySelf: 'center' }} aria-hidden="true" />;
}

const STAT_LABEL = { str: 'Strength', dex: 'Dexterity', def: 'Defence', spd: 'Speed' } as const;
export function Stats({ dna }: { dna: Dna }) {
  return (
    <div className="stats">
      {STAT_KEYS.map((k) => (
        <div className="stat" key={k} style={{ ['--c' as string]: `var(--stat-${k})` }}>
          <span className="row-ico"><Ico n={`stat-${k}`} />{STAT_LABEL[k]}</span>
          <span className="pips" role="meter" aria-label={STAT_LABEL[k]} aria-valuemin={3} aria-valuemax={9} aria-valuenow={dna[k]}>
            {Array.from({ length: 9 }, (_, i) => <span key={i} className={`pip ${i < dna[k] ? 'on' : ''}`} />)}
          </span>
          <b>{dna[k]}</b>
        </div>
      ))}
    </div>
  );
}

export function MonsterCard({ m, onClick, selected, href, extra, disabled }: { m: Monster; onClick?: () => void; selected?: boolean; href?: string; extra?: React.ReactNode; disabled?: boolean }) {
  const body = (
    <>
      <Portrait dna={m.dna} size={200} />
      <div className="tile-head"><h3>{m.name}</h3><span className="chip">Gen {m.gen}</span></div>
      <span className="tile-meta row-ico"><Ico n={TYPE_ICON[archetype(m.dna)]} />{archetype(m.dna)}, {m.record.w} wins, {m.record.l} losses</span>
      {extra}
      <Stats dna={m.dna} />
    </>
  );
  return href
    ? <a className="tile" href={href}>{body}</a>
    : <button type="button" className="tile" aria-pressed={selected} disabled={disabled} onClick={onClick}>{body}</button>;
}

// Title-screen key art: 4 painted layers (public/title, split by sprites/title/layers.py) shifted for parallax.
// Follows the pointer, drifts slowly when idle; static under reduced motion. Bleed (inset -40px) hides shifted edges.
const TITLE_LAYERS = [['0-sky', 0], ['1-far', 8], ['2-mid', 18], ['3-front', 30]] as const;
export function TitleArt({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reduceMotion()) return;
    const imgs = [...ref.current!.querySelectorAll('img')];
    const aim = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
    let raf = 0, last = 0;
    const onMove = (e: PointerEvent) => { aim.x = (e.clientX / innerWidth) * 2 - 1; aim.y = (e.clientY / innerHeight) * 2 - 1; last = performance.now(); };
    const frame = (t: number) => {
      const idle = t - last > 3000; // no pointer lately: slow figure-eight drift
      const tx = idle ? Math.sin(t / 3200) * 0.6 : aim.x, ty = idle ? Math.sin(t / 1600) * 0.4 : aim.y;
      cur.x += (tx - cur.x) * 0.06; cur.y += (ty - cur.y) * 0.06;
      imgs.forEach((im, i) => { const k = TITLE_LAYERS[i][1]; im.style.transform = `translate(${-cur.x * k}px, ${-cur.y * k * 0.5}px)`; });
      raf = requestAnimationFrame(frame);
    };
    addEventListener('pointermove', onMove);
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); removeEventListener('pointermove', onMove); };
  }, []);
  return (
    <div ref={ref} className={`title-art ${className ?? ''}`} aria-hidden="true">
      {TITLE_LAYERS.map(([n]) => <img key={n} src={`/title/${n}.png`} alt="" draggable={false} />)}
    </div>
  );
}

export function ArenaBackdrop({ id, className }: { id: StageId; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!, ctx = c.getContext('2d')!;
    let raf = 0;
    const paint = () => {
      const dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const s = Math.max(w / 1280, h / 720);
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (w - 1280 * s) / 2, dpr * (h - 720 * s) / 2);
      const ready = drawStageThumb(ctx, id, 1280, 720, performance.now() / 1000); // seconds, same clock as the fight renderer
      if (!ready || !reduceMotion()) raf = requestAnimationFrame(paint);
    };
    paint();
    const onResize = () => { if (reduceMotion()) paint(); };
    addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', onResize); };
  }, [id]);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}

export function StageThumb({ id, className }: { id: StageId; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!, dpr = devicePixelRatio || 1;
    const w = c.clientWidth || 320, h = Math.round(w * 9 / 16);
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    let raf = 0;
    const paint = () => { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); if (!drawStageThumb(ctx, id, w, h)) raf = requestAnimationFrame(paint); };
    paint();
    return () => cancelAnimationFrame(raf);
  }, [id]);
  return <canvas ref={ref} className={className} style={{ width: '100%', aspectRatio: '16 / 9' }} aria-hidden="true" />;
}

export function HubDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); ref.current?.querySelector('input')?.focus(); }, []);
  return (
    <dialog ref={ref} className="hub-dialog" aria-label={title} onClose={onClose} onClick={(e) => e.target === ref.current && ref.current?.close()}>
      <header><h2>{title}</h2><button type="button" className="hub-x" aria-label="Close" onClick={() => ref.current?.close()}><Ico n="icon-close" /></button></header>
      {children}
    </dialog>
  );
}
