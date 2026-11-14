// Canvas renderer: dynamic camera, stage, fighters, hit FX, HUD. Render-only state (particles, shake) lives here.
import { STAGES, HURT_H, MAX_HP, hitboxOf, type GameState, type SimEvent, type StageId } from '../sim/sim.ts';
import { paintBackground, paintStage, paintFront } from './stage.ts';
import { drawMonster, poseFor, type Look } from './rig.ts';
import { drawHero, hero } from './cutout.ts';
import { drawSheet, sheet } from './sheet.ts';
import { lookOf, randomDna } from '../genes.ts';

export const W = 1280, H = 720;

// Per-match players (set from the chosen monsters). Defaults: two fixed demo monsters.
const LOOKS: Look[] = [lookOf({ ...randomDna(7), hue: 172 }), lookOf({ ...randomDna(8), hue: 24 })];
const NAMES = ['P1', 'P2'];

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; kind: 'spark' | 'dust' | 'ring' | 'beam' }

export function createRenderer(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const cam = { x: 800, y: 450, z: 0.8 };
  let shake = 0;
  const parts: Particle[] = [];
  const squash = [0, 0];
  let showBoxes = false;
  let stageId: StageId = 'ember';
  // ?p1=lortor&p2=torfen swaps a seat's vector monster for an image hero (art test); &style=sheet uses the sprite sheet.
  const q = new URLSearchParams(location.search), HEROES = [q.get('p1'), q.get('p2')], SHEET = q.get('style') === 'sheet';
  const onKey = (e: KeyboardEvent) => { if (e.code === 'Backquote') showBoxes = !showBoxes; };
  addEventListener('keydown', onKey);

  function resize() {
    const dpr = devicePixelRatio || 1;
    const box = canvas.parentElement; // fit the container (full screen in a fight, a column when watching)
    const s = Math.min((box?.clientWidth || innerWidth) / W, (box?.clientHeight || innerHeight) / H);
    canvas.style.width = `${W * s}px`; canvas.style.height = `${H * s}px`;
    canvas.width = W * s * dpr; canvas.height = H * s * dpr;
    ctx.setTransform(s * dpr, 0, 0, s * dpr, 0, 0);
  }
  const fit = new ResizeObserver(resize);
  if (canvas.parentElement) fit.observe(canvas.parentElement);
  resize();

  const burst = (x: number, y: number, n: number, speed: number, color: string, kind: Particle['kind'], size = 4, life = 22) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.6);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, size: size * (0.6 + Math.random() * 0.8), color, kind });
    }
  };

  function onEvents(events: SimEvent[]) {
    for (const e of events) {
      if (e.kind === 'hit') {
        const big = e.power > 14;
        burst(e.x, e.y, big ? 22 : 10, big ? 16 : 10, big ? '#ffe36b' : '#fff', 'spark', big ? 5 : 3.5);
        parts.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 12, max: 12, size: big ? 90 : 50, color: '#fff', kind: 'ring' });
        shake = Math.max(shake, Math.min(22, e.power * 0.7));
      } else if (e.kind === 'ko') {
        const bz = STAGES[stageId].blast;
        const x = Math.max(bz.x0 + 120, Math.min(bz.x1 - 120, e.x)), y = Math.max(bz.y0 + 120, Math.min(bz.y1 - 120, e.y));
        parts.push({ x, y, vx: 0, vy: 0, life: 40, max: 40, size: 1, color: LOOKS[e.who].body, kind: 'beam' });
        burst(x, y, 40, 26, LOOKS[e.who].body, 'spark', 7, 34);
        shake = 30;
      } else if (e.kind === 'land') {
        squash[e.who] = Math.min(0.3, e.power / 45);
        burst(e.x, e.y, 6, 3, 'rgba(220,210,190,0.8)', 'dust', 6, 18);
      } else if (e.kind === 'jump') {
        burst(e.x, e.y, 5, 2.5, 'rgba(220,210,190,0.8)', 'dust', 5, 14);
      }
    }
  }

  function updateCamera(s: GameState) {
    const live = s.fighters.filter((f) => f.state !== 'dead');
    const xs = live.length ? live.map((f) => f.x) : [800], ys = live.length ? live.map((f) => f.y - 45) : [500];
    const b = STAGES[s.stage].cam;
    const x0 = Math.min(...xs, b.x0), x1 = Math.max(...xs, b.x1), y0 = Math.min(...ys, b.y0), y1 = Math.max(...ys, b.y1);
    const z = Math.max(0.42, Math.min(1.0, W / (x1 - x0 + 520), H / (y1 - y0 + 380)));
    cam.x += ((x0 + x1) / 2 - cam.x) * 0.1;
    cam.y += ((y0 + y1) / 2 - cam.y) * 0.1;
    cam.z += (z - cam.z) * 0.08;
  }

  function fighters(s: GameState) {
    s.fighters.forEach((f, i) => {
      if (f.state === 'dead') return;
      squash[i] *= 0.82;
      const p = poseFor(f, s.frame);
      ctx.save();
      ctx.translate(f.x, f.y);
      if (f.invuln > 0 && Math.floor(s.frame / 4) % 2) ctx.globalAlpha = f.state === 'dodge' ? 0.55 : 0.35;
      ctx.scale(f.facing * (1 + squash[i]), 1 - squash[i]);
      const flash = f.hitlag > 0 && f.state === 'hitstun', name = HEROES[i];
      const sh = name && SHEET ? sheet(name) : null, h = name && !SHEET ? hero(name) : null;
      if (sh) drawSheet(ctx, sh, f, s.frame, p.r, flash);
      else if (h) drawHero(ctx, p, h, flash);
      else drawMonster(ctx, p, LOOKS[i], flash);
      ctx.restore();

      if (f.state === 'block') { // shield arc on the guarded (front) side
        ctx.save();
        ctx.globalAlpha = 0.5 + 0.15 * Math.sin(s.frame / 4); ctx.strokeStyle = '#9ad8ff'; ctx.lineWidth = 7; ctx.lineCap = 'round';
        ctx.beginPath();
        const a0 = f.facing === 1 ? -1.1 : Math.PI - 1.1;
        ctx.arc(f.x, f.y - HURT_H / 2, 58, a0, a0 + 2.2);
        ctx.stroke(); ctx.restore();
      }
      const hb = hitboxOf(f);
      if (hb) { // strike swoosh
        ctx.save();
        ctx.globalAlpha = 0.55; ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.ellipse(hb.x + hb.w / 2, hb.y + hb.h / 2, hb.w / 2, hb.h / 2, 0, f.facing === 1 ? -1.4 : Math.PI - 0.9, f.facing === 1 ? 0.9 : Math.PI + 1.4);
        ctx.stroke(); ctx.restore();
      }
      if (f.state === 'hitstun' && Math.hypot(f.vx, f.vy) > 12 && s.frame % 2 === 0) {
        parts.push({ x: f.x, y: f.y - 45, vx: 0, vy: 0, life: 20, max: 20, size: 14, color: 'rgba(255,255,255,0.5)', kind: 'dust' });
      }
      if (showBoxes) {
        ctx.strokeStyle = '#0f0'; ctx.lineWidth = 2; ctx.strokeRect(f.x - 25, f.y - HURT_H, 50, HURT_H);
        if (hb) { ctx.strokeStyle = '#f33'; ctx.strokeRect(hb.x, hb.y, hb.w, hb.h); }
      }
    });
  }

  function particles() {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx; p.y += p.vy; p.vx *= 0.9; p.vy *= 0.9;
      if (p.kind === 'dust') p.vy -= 0.1;
      const k = p.life / p.max;
      ctx.globalAlpha = Math.max(0, k);
      if (p.kind === 'ring') {
        ctx.strokeStyle = p.color; ctx.lineWidth = 5 * k;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - k) + 10, 0, Math.PI * 2); ctx.stroke();
      } else if (p.kind === 'beam') {
        ctx.fillStyle = p.color; ctx.fillRect(p.x - 60 * k, -2000, 120 * k, 5000);
        ctx.fillStyle = '#fff'; ctx.fillRect(p.x - 20 * k, -2000, 40 * k, 5000);
      } else if (p.kind === 'spark') {
        ctx.strokeStyle = p.color; ctx.lineWidth = p.size * k; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2, p.y - p.vy * 2); ctx.stroke();
      } else {
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.4 - k), 0, Math.PI * 2); ctx.fill();
      }
      if (--p.life <= 0) parts.splice(i, 1);
    }
    ctx.globalAlpha = 1;
  }

  const hpShown = [MAX_HP, MAX_HP]; // trailing "chip" bar

  function hud(s: GameState, banner: string, info: string) {
    s.fighters.forEach((f, i) => {
      const x = i === 0 ? 40 : W - 280, bw = 224;
      const hp = f.state === 'dead' ? 0 : Math.max(0, MAX_HP - f.damage), k = hp / MAX_HP;
      hpShown[i] = hp > hpShown[i] ? hp : hpShown[i] + (hp - hpShown[i]) * 0.06;
      ctx.fillStyle = 'rgba(15,10,30,0.6)'; ctx.fillRect(x, 20, 240, 86);
      ctx.fillStyle = LOOKS[i].body; ctx.fillRect(x, 20, 6, 86);
      ctx.font = 'bold 16px system-ui'; ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
      ctx.fillText(NAMES[i], x + 16, 42);
      for (let n = 0; n < f.stocks; n++) {
        ctx.fillStyle = LOOKS[i].body; ctx.beginPath(); ctx.arc(x + 226 - n * 20, 36, 7, 0, Math.PI * 2); ctx.fill();
      }
      // health bar: green -> yellow -> red, white chip shows recent damage
      ctx.fillStyle = '#2a2140'; ctx.fillRect(x + 10, 52, bw, 22);
      ctx.fillStyle = '#fff'; ctx.fillRect(x + 10, 52, bw * hpShown[i] / MAX_HP, 22);
      ctx.fillStyle = `hsl(${120 * k}, 75%, 50%)`; ctx.fillRect(x + 10, 52, bw * k, 22);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.strokeRect(x + 10, 52, bw, 22);
      ctx.font = 'bold 14px system-ui'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      ctx.fillText(`${Math.ceil(hp)} / ${MAX_HP}`, x + 10 + bw / 2, 68);
      ctx.textAlign = 'left'; ctx.font = '13px system-ui'; ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(`knockback +${f.damage}%`, x + 16, 96);
    });
    if (info) {
      ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillText(info, W / 2, H - 12);
    }
    if (banner) {
      ctx.font = 'bold 28px system-ui'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, H / 2 - 40, W, 70);
      ctx.fillStyle = '#fff'; ctx.fillText(banner, W / 2, H / 2 + 8);
    }
  }

  function draw(s: GameState, banner = '', info = '') {
    if (s.stage !== stageId) { stageId = s.stage; parts.length = 0; }
    updateCamera(s);
    const t = performance.now() / 1000;
    paintBackground(ctx, stageId, cam);
    ctx.save();
    const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
    shake *= 0.85;
    ctx.translate(W / 2 + sx, H / 2 + sy); ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y);
    paintStage(ctx, stageId, t); fighters(s); particles(); paintFront(ctx, stageId, t);
    ctx.restore();
    hud(s, banner, info);
  }

  return {
    draw, onEvents,
    setPlayers: (names: string[], looks?: Look[]) => { NAMES.splice(0, 2, ...names); if (looks) LOOKS.splice(0, 2, ...looks); },
    destroy: () => { removeEventListener('keydown', onKey); fit.disconnect(); },
  };
}
