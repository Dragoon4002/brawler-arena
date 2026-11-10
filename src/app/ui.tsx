// Shared UI pieces: logo, live monster portrait, stat pips, monster card.
import { useEffect, useRef } from 'react';
import { archetype, lookOf, STAT_KEYS, type Dna, type Monster } from '../genes.ts';
import { drawMonster, idlePose, type Pose } from '../render/rig.ts';
import { drawStageThumb } from '../render/stage.ts';
import type { StageId } from '../stages.ts';

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Working-title wordmark (name TBD). Inline SVG so it uses the loaded display font.
export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 520 150" role="img" aria-label="Brawler Arena">
      <g fontFamily="var(--font-display)" textAnchor="middle" strokeLinejoin="round" paintOrder="stroke">
        {[0, 34, 68].map((dx) => (
          <path key={dx} d={`M${40 + dx} 132 Q${58 + dx} 70 ${96 + dx} 16 Q${80 + dx} 78 ${62 + dx} 134 Z`} fill="var(--ember)" stroke="var(--ink)" strokeWidth="7" />
        ))}
        <text x="330" y="78" fontSize="74" fill="var(--cream)" stroke="var(--ink)" strokeWidth="12">Brawler</text>
        <text x="330" y="138" fontSize="58" fill="var(--gold)" stroke="var(--ink)" strokeWidth="11">Arena</text>
      </g>
    </svg>
  );
}

// Canvas portrait drawn from DNA with the same rig the arena uses.
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
      drawMonster(ctx, pose ?? idlePose(t), look, false);
      t++;
      if (!reduceMotion() && !pose) raf = requestAnimationFrame(paint);
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
          <span>{STAT_LABEL[k]}</span>
          <span className="pips" role="meter" aria-label={STAT_LABEL[k]} aria-valuemin={3} aria-valuemax={9} aria-valuenow={dna[k]}>
            {Array.from({ length: 9 }, (_, i) => <span key={i} className={`pip ${i < dna[k] ? 'on' : ''}`} />)}
          </span>
          <b>{dna[k]}</b>
        </div>
      ))}
    </div>
  );
}

export function MonsterCard({ m, onClick, selected, href }: { m: Monster; onClick?: () => void; selected?: boolean; href?: string }) {
  const body = (
    <>
      <Portrait dna={m.dna} size={200} />
      <div className="tile-head"><h3>{m.name}</h3><span className="chip">Gen {m.gen}</span></div>
      <span className="tile-meta">{archetype(m.dna)}, {m.record.w} wins, {m.record.l} losses</span>
      <Stats dna={m.dna} />
    </>
  );
  return href
    ? <a className="tile" href={href}>{body}</a>
    : <button type="button" className="tile" aria-pressed={selected} onClick={onClick}>{body}</button>;
}

// Static arena preview (painted once by the stage renderer).
export function StageThumb({ id, className }: { id: StageId; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!, dpr = devicePixelRatio || 1;
    const w = c.clientWidth || 320, h = Math.round(w * 9 / 16);
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStageThumb(ctx, id, w, h);
  }, [id]);
  return <canvas ref={ref} className={className} style={{ width: '100%', aspectRatio: '16 / 9' }} aria-hidden="true" />;
}
