// Canvas renderer: dynamic camera, stage, fighters, hit FX, HUD. Render-only state (particles, shake) lives here.
import { STAGE, HURT_H, MAX_HP, hitboxOf, type GameState, type SimEvent } from '../sim/sim.ts';
import { drawMonster, poseFor, type Look } from './rig.ts';

export const W = 1280, H = 720;

export const LOOKS: Look[] = [
  { body: '#3fc1b0', belly: '#c9f2e4', dark: '#2a8a80', horn: '#f4e9c8', eye: '#1b1426' },
  { body: '#f08a3c', belly: '#ffe0b8', dark: '#b85a22', horn: '#fff3d6', eye: '#1b1426' },
];
const NAMES = ['P1', 'P2'];

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; kind: 'spark' | 'dust' | 'ring' | 'beam' }

export function createRenderer(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const cam = { x: 800, y: 450, z: 0.8 };
  let shake = 0;
  const parts: Particle[] = [];
  const squash = [0, 0];
  let showBoxes = false;
  addEventListener('keydown', (e) => { if (e.code === 'Backquote') showBoxes = !showBoxes; });

  function resize() {
    const dpr = devicePixelRatio || 1;
    const s = Math.min(innerWidth / W, innerHeight / H);
    canvas.style.width = `${W * s}px`; canvas.style.height = `${H * s}px`;
    canvas.width = W * s * dpr; canvas.height = H * s * dpr;
    ctx.setTransform(s * dpr, 0, 0, s * dpr, 0, 0);
  }
  addEventListener('resize', resize); resize();

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
        const bz = STAGE.blast;
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
    const x0 = Math.min(...xs, 500), x1 = Math.max(...xs, 1100), y0 = Math.min(...ys, 380), y1 = Math.max(...ys, 640);
    const z = Math.max(0.42, Math.min(1.0, W / (x1 - x0 + 520), H / (y1 - y0 + 380)));
    cam.x += ((x0 + x1) / 2 - cam.x) * 0.1;
    cam.y += ((y0 + y1) / 2 - cam.y) * 0.1;
    cam.z += (z - cam.z) * 0.08;
  }

  function background() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#20163f'); g.addColorStop(0.6, '#5b3a73'); g.addColorStop(1, '#e58f6a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // parallax hills
    for (const [k, col, base, amp] of [[0.15, '#3a2a5c', 470, 70], [0.3, '#2b1f47', 540, 55]] as const) {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 40) {
        const wx = x + cam.x * k;
        ctx.lineTo(x, base + Math.sin(wx / 140) * amp * 0.6 + Math.sin(wx / 53) * amp * 0.25);
      }
      ctx.lineTo(W, H); ctx.fill();
    }
  }

  function stage() {
    const m = STAGE.main;
    // floating island underside
    ctx.fillStyle = '#4a3a5e';
    ctx.beginPath(); ctx.moveTo(m.x0, m.y);
    ctx.lineTo(m.x0 + 40, m.y1 + 40); ctx.lineTo((m.x0 + m.x1) / 2, m.y1 + 170); ctx.lineTo(m.x1 - 40, m.y1 + 40); ctx.lineTo(m.x1, m.y); ctx.fill();
    ctx.fillStyle = '#6b5a7e'; ctx.fillRect(m.x0, m.y, m.x1 - m.x0, m.y1 - m.y);
    ctx.fillStyle = '#7fd36b'; ctx.fillRect(m.x0 - 6, m.y - 4, m.x1 - m.x0 + 12, 16);
    ctx.fillStyle = '#5fae52'; ctx.fillRect(m.x0 - 6, m.y + 10, m.x1 - m.x0 + 12, 4);
    for (const p of STAGE.soft) {
      ctx.fillStyle = '#a8794e'; ctx.fillRect(p.x0, p.y, p.x1 - p.x0, 12);
      ctx.fillStyle = '#c99a68'; ctx.fillRect(p.x0, p.y, p.x1 - p.x0, 4);
      ctx.fillStyle = '#6e4b2e';
      for (const x of [p.x0 + 20, p.x1 - 26]) ctx.fillRect(x, p.y + 12, 6, 26);
    }
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
      drawMonster(ctx, p, LOOKS[i], f.hitlag > 0 && f.state === 'hitstun');
      ctx.restore();

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
    if (s.winner >= 0) banner = `${NAMES[s.winner]} WINS — both press JUMP for rematch`;
    if (banner) {
      ctx.font = 'bold 28px system-ui'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, H / 2 - 40, W, 70);
      ctx.fillStyle = '#fff'; ctx.fillText(banner, W / 2, H / 2 + 8);
    }
  }

  function draw(s: GameState, banner = '', info = '') {
    updateCamera(s);
    background();
    ctx.save();
    const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
    shake *= 0.85;
    ctx.translate(W / 2 + sx, H / 2 + sy); ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y);
    stage(); fighters(s); particles();
    ctx.restore();
    hud(s, banner, info);
  }

  return { draw, onEvents, setNames: (n: string[]) => NAMES.splice(0, 2, ...n) };
}
