// Procedural skeletal rig: bones + keyframed poses, tweened like the reference game's bone animations.
// Render-only. Reads sim state, never writes it.
import { MOVES, type MoveId } from '../sim/moves.ts';
import { startup, type Fighter } from '../sim/sim.ts';
import type { Look } from '../genes.ts';

// Angles in radians. Limbs: 0 = straight down, + = toward facing. Lower bones are relative to upper.
// t = torso lean (+ forward), h = head tilt, y = hip drop, r = whole-body spin.
export interface Pose {
  y: number; t: number; h: number; r: number;
  fu: number; fl: number; bu: number; bl: number; // front / back arm
  ft: number; fs: number; bt: number; bs: number; // front / back leg (thigh, shin)
  tail: number; jaw: number;
}

const P = (p: Partial<Pose>): Pose => ({
  y: 0, t: 0.08, h: -0.05, r: 0, fu: 0.4, fl: 1.4, bu: -0.1, bl: 1.2, ft: 0.25, fs: -0.3, bt: -0.2, bs: -0.2, tail: 0.3, jaw: 0, ...p,
});

const POSES = {
  idle: P({}),
  idle2: P({ y: 2, t: 0.13, h: 0, fu: 0.48, fl: 1.55, bl: 1.35, tail: 0.45 }),
  run1: P({ y: -2, t: 0.32, fu: -0.6, fl: 1.2, bu: 0.8, bl: 1.0, ft: 0.95, fs: -0.4, bt: -0.6, bs: -1.3, tail: 0.1 }),
  run2: P({ y: 3, t: 0.3, fu: 0.8, fl: 1.0, bu: -0.6, bl: 1.2, ft: -0.6, fs: -1.3, bt: 0.95, bs: -0.4, tail: 0.25 }),
  squat: P({ y: 11, t: 0.42, h: 0.1, fu: -0.3, fl: 0.8, bu: -0.5, bl: 0.8, ft: 0.95, fs: -1.7, bt: 0.55, bs: -1.6 }),
  rise: P({ y: -2, t: 0.1, h: -0.15, fu: 2.2, fl: 0.3, bu: -0.8, bl: 0.6, ft: 0.75, fs: -1.4, bt: -0.2, bs: -0.6, tail: -0.2 }),
  fall: P({ t: 0.05, fu: 1.4, fl: 0.4, bu: -1.0, bl: 0.5, ft: 0.3, fs: -0.2, bt: -0.1, bs: -0.3, tail: 0.6 }),
  tuck: P({ y: 6, t: 0.6, h: 0.3, fu: 0.8, fl: 1.9, bu: 0.6, bl: 1.9, ft: 1.4, fs: -2.3, bt: 1.0, bs: -2.3, tail: 1.0 }),
  hurt: P({ t: -0.5, h: -0.45, fu: -1.2, fl: 0.5, bu: -1.6, bl: 0.3, ft: 0.5, fs: -0.2, bt: -0.4, bs: -0.3, tail: 1.1, jaw: 0.5 }),
  tumble: P({ t: -0.9, h: -0.6, fu: -2.4, fl: 0.4, bu: 2.4, bl: 0.4, ft: 1.0, fs: -0.6, bt: -0.8, bs: -0.6, tail: 1.4, jaw: 0.6 }),
};

// Per-move [wind-up, strike]. Startup tweens rest->wind, first active frames snap wind->strike, recovery eases back.
const ATTACK: Record<MoveId, [Partial<Pose>, Partial<Pose>]> = {
  jab1: [{ fu: 0.2, fl: 1.9, t: 0.0 }, { fu: 1.55, fl: 0.05, t: 0.25, jaw: 0.3 }],
  jab2: [{ bu: 0.1, bl: 1.9, fu: 0.3, fl: 1.6 }, { bu: 1.55, bl: 0.05, fu: 0.2, fl: 1.5, t: 0.3, jaw: 0.3 }],
  jab3: [{ fu: -0.3, fl: 1.7, y: 7, t: 0.3 }, { fu: 2.5, fl: 0.2, t: 0.05, y: -4, h: -0.3, jaw: 0.6 }],
  sideLight: [{ fu: -0.9, fl: 1.2, t: -0.1 }, { fu: 1.6, fl: 0.1, t: 0.5, ft: 0.85, fs: -0.3, bt: -0.75, bs: -0.4, jaw: 0.5 }],
  downLight: [{ y: 10, t: 0.25, ft: 0.9, fs: -1.7 }, { y: 13, t: -0.2, ft: 1.55, fs: 0, bt: -0.2, bs: -1.6, fu: -0.6, bu: 0.6 }],
  airNeutral: [{ fu: -1.6, fl: 0.4, bu: -1.4, bl: 0.4, t: 0.3 }, { fu: 3.0, fl: 0.2, bu: 2.6, bl: 0.2, t: -0.2, h: -0.4, jaw: 0.5 }],
  airSide: [{ ft: 0.9, fs: -2.1, t: -0.2, bt: 0.4, bs: -1.6 }, { ft: 1.65, fs: 0, t: -0.45, bt: -0.4, bs: -1.2, fu: -1.0, bu: -1.0, jaw: 0.3 }],
  airDown: [{ ft: 0.8, fs: -1.9, bt: 0.6, bs: -1.9, t: 0.3 }, { ft: 0.1, fs: 0, bt: -0.1, bs: 0, y: 6, t: 0.1, fu: 2.4, bu: 2.4 }],
  nHeavy: [{ y: 13, t: 0.5, fu: -0.6, fl: 1.7, bu: -0.6, bl: 1.7, ft: 0.85, fs: -1.5, bt: 0.4, bs: -1.4 }, { y: -7, t: -0.2, h: -0.55, fu: 3.0, fl: 0.1, bu: 2.8, bl: 0.1, ft: 0.1, fs: -0.1, bt: -0.1, bs: -0.1, jaw: 0.8 }],
  sHeavy: [{ t: -0.45, fu: -2.3, fl: 0.5, bu: -1.9, bl: 0.4, ft: 0.4, bt: -0.5 }, { t: 0.65, fu: 1.6, fl: 0, bu: 1.2, bl: 0.2, ft: 0.95, fs: -0.2, bt: -0.85, bs: -0.3, jaw: 0.8 }],
  dHeavy: [{ y: 9, t: 0.35, tail: -0.6, fu: 0.9, fl: 1.4 }, { y: 11, t: 0.1, tail: 2.6, fu: 1.6, fl: 0, bu: -1.6, bl: 0, ft: 0.9, fs: -0.6, bt: -0.9, bs: -0.6, jaw: 0.6 }],
  airSideHeavy: [{ t: -0.3, ft: 1.2, fs: -2.1, bt: 1.2, bs: -2.1 }, { t: -0.85, ft: 1.7, fs: 0, bt: 1.5, bs: 0, fu: -2.0, bu: -2.0, jaw: 0.6 }],
  recovery: [{ y: 6, t: 0.35, fu: -0.4, fl: 1.7 }, { t: -0.1, fu: 3.05, fl: 0, bu: -0.8, bl: 0.5, ft: 0.2, fs: -1.2, bt: -0.4, bs: -0.4, h: -0.4, jaw: 0.7 }],
  groundPound: [{ t: 0.5, ft: 1.3, fs: -2.1, bt: 1.1, bs: -2.1, fu: 2.6, fl: 0.8, bu: 2.6, bl: 0.8 }, { t: 0.2, fu: 0.1, fl: 0, bu: 0.1, bl: 0, ft: 0.2, fs: -0.3, bt: -0.3, bs: -0.3, jaw: 0.8 }],
};

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export function lerpPose(a: Pose, b: Pose, k: number): Pose {
  const o = { ...a };
  for (const key in a) (o as any)[key] = (a as any)[key] + ((b as any)[key] - (a as any)[key]) * k;
  return o;
}

// Pick + blend the pose for a fighter this frame.
export function poseFor(f: Fighter, now: number): Pose {
  const rest = f.grounded ? POSES.idle : POSES.fall;
  switch (f.state) {
    case 'idle': return lerpPose(POSES.idle, POSES.idle2, (Math.sin(now / 9) + 1) / 2);
    case 'run': {
      const c = (f.t % 24) / 24;
      return lerpPose(POSES.run1, POSES.run2, ease(c < 0.5 ? c * 2 : 2 - c * 2));
    }
    case 'jumpsquat': case 'land': return POSES.squat;
    case 'air': return lerpPose(POSES.rise, POSES.fall, ease((f.vy + 8) / 16));
    case 'dodge': return { ...POSES.tuck, r: f.grounded ? 0 : f.t * 0.45 * f.facing };
    case 'hitstun': {
      const big = Math.hypot(f.vx, f.vy) > 10;
      return big ? { ...POSES.tumble, r: -f.t * 0.35 } : POSES.hurt;
    }
    case 'attack': {
      const m = MOVES[f.move!], [w, h] = ATTACK[f.move!];
      const su = startup(f, m), end = su + m.active;
      const wind = { ...rest, ...w }, hit = { ...rest, ...w, ...h };
      if (f.t < su) return lerpPose(rest, wind, ease(f.t / su));
      if (f.t < end) {
        const p = lerpPose(wind, hit, Math.min(1, (f.t - su + 1) / 2));
        return f.move === 'recovery' ? { ...p, r: (f.t - su) * 0.55 } : p;
      }
      return lerpPose(hit, rest, ease((f.t - end) / m.recovery));
    }
    default: return rest;
  }
}

export type { Look } from '../genes.ts';

type V = [number, number];
const down = (o: V, a: number, len: number): V => [o[0] + Math.sin(a) * len, o[1] + Math.cos(a) * len];

const limb = (ctx: CanvasRenderingContext2D, pts: V[], w: number[], fill: string, line: string) => {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [col, extra] of [[line, 5], [fill, 0]] as const) {
    ctx.strokeStyle = col;
    for (let i = 0; i < pts.length - 1; i++) {
      ctx.lineWidth = w[i] + extra;
      ctx.beginPath(); ctx.moveTo(...pts[i]); ctx.lineTo(...pts[i + 1]); ctx.stroke();
    }
  }
};

const blob = (ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number, fill: string, line: string) => {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = line; ctx.stroke();
};

const tri = (ctx: CanvasRenderingContext2D, a: V, b: V, c: V) => {
  ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.closePath(); ctx.fill(); ctx.stroke();
};

const INK = '#1b1426';
const FLASH: Look = { body: '#fff', belly: '#fff', dark: '#ddd', horn: '#fff', eye: '#fff', mark: '#eee', hornStyle: 0, tailStyle: 0, pattern: 0, eyeStyle: 0, scale: 1 };

function horns(ctx: CanvasRenderingContext2D, style: number, col: string) {
  ctx.fillStyle = col; ctx.strokeStyle = INK; ctx.lineWidth = 3;
  if (style === 3) { // single crest horn
    ctx.beginPath(); ctx.moveTo(-2, -15); ctx.quadraticCurveTo(10, -34, 20, -46); ctx.quadraticCurveTo(14, -26, 12, -13); ctx.closePath(); ctx.fill(); ctx.stroke();
    return;
  }
  for (const s of [-1, 1]) {
    ctx.beginPath();
    if (style === 0) { ctx.moveTo(s * 3, -13); ctx.quadraticCurveTo(s * 10, -26, s * 14, -40); ctx.quadraticCurveTo(s * 20, -22, s * 14, -8); }
    else if (style === 1) { ctx.moveTo(s * 4, -14); ctx.lineTo(s * 9, -34); ctx.lineTo(s * 14, -11); }
    else { // ram curl
      ctx.moveTo(s * 6, -14); ctx.bezierCurveTo(s * 26, -30, s * 34, -4, s * 20, 2); ctx.bezierCurveTo(s * 26, -10, s * 20, -18, s * 12, -8);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
}

function tail(ctx: CanvasRenderingContext2D, style: number, hip: V, swing: number, L: Look) {
  const ta = Math.PI / 2 + 0.6 - swing * 0.6;
  const t1 = down(hip, -ta, 26), t2 = down(t1, -ta - 0.5 + swing * 0.3, 22);
  limb(ctx, [hip, t1, t2], [14, 8], L.dark, INK);
  ctx.fillStyle = L.horn; ctx.strokeStyle = INK; ctx.lineWidth = 2;
  if (style === 0) { // dorsal spikes
    for (const [pt, s] of [[t1, 7], [t2, 6]] as [V, number][]) tri(ctx, [pt[0] - s, pt[1]], [pt[0], pt[1] - s * 1.8], [pt[0] + s, pt[1]]);
  } else if (style === 1) { // club
    blob(ctx, t2[0], t2[1], 9, 8, 0, L.horn, INK);
  } else { // leaf fin
    ctx.fillStyle = L.mark;
    ctx.beginPath(); ctx.moveTo(...t1); ctx.quadraticCurveTo(t2[0] - 4, t2[1] - 22, t2[0] - 12, t2[1] - 4); ctx.quadraticCurveTo(t2[0], t2[1] + 2, ...t1); ctx.fill(); ctx.stroke();
  }
}

function eyes(ctx: CanvasRenderingContext2D, style: number, L: Look, angry: boolean) {
  if (style === 3) { // big single eye
    blob(ctx, 8, -4, 10, 10, 0, '#fff', INK);
    ctx.fillStyle = L.mark; ctx.beginPath(); ctx.arc(11, -3, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = L.eye; ctx.beginPath(); ctx.arc(12, -3, 3, 0, Math.PI * 2); ctx.fill();
    return;
  }
  blob(ctx, 10, -3, 7, 8, 0, '#fff', INK);
  ctx.fillStyle = L.eye; ctx.beginPath(); ctx.arc(12.5, -2, 3.6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath();
  if (style === 1 || angry) { ctx.moveTo(3, -13); ctx.lineTo(17, -8); } // brow
  else if (style === 2) { ctx.moveTo(3, -6); ctx.lineTo(17, -6); } // sleepy lid
  ctx.stroke();
}

function markings(ctx: CanvasRenderingContext2D, style: number, mid: V, rot: number, col: string) {
  if (!style) return;
  ctx.save(); ctx.translate(...mid); ctx.rotate(rot);
  ctx.beginPath(); ctx.ellipse(0, 0, 22, 26, 0, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = col; ctx.globalAlpha = 0.85;
  if (style === 1) for (const y of [-14, -3, 8]) { ctx.beginPath(); ctx.moveTo(-24, y); ctx.lineTo(-6, y + 3); ctx.lineTo(-24, y + 7); ctx.fill(); }
  else for (const [x, y, r] of [[-12, -12, 4], [-15, 2, 5], [-8, 13, 3.5], [-3, -18, 3]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

// Draw in fighter-local space: origin at feet, facing right. Caller handles translate/flip.
export function drawMonster(ctx: CanvasRenderingContext2D, p: Pose, look: Look, flash: boolean) {
  const L = flash ? FLASH : look;
  const hip: V = [0, -44 + p.y];
  ctx.save();
  ctx.scale(look.scale, look.scale);
  if (p.r) { ctx.translate(hip[0], hip[1]); ctx.rotate(p.r); ctx.translate(-hip[0], -hip[1]); }

  const neck: V = [hip[0] + Math.sin(p.t) * 30, hip[1] - Math.cos(p.t) * 30];
  const shoulder: V = [hip[0] + Math.sin(p.t) * 24, hip[1] - Math.cos(p.t) * 24];
  const arm = (u: number, l: number): V[] => { const e = down(shoulder, u, 20); return [shoulder, e, down(e, u + l, 20)]; };
  const leg = (u: number, l: number): V[] => { const k = down(hip, u, 22); return [hip, k, down(k, u + l, 23)]; };

  tail(ctx, look.tailStyle, hip, p.tail, L);

  const bl = leg(p.bt, p.bs), ba = arm(p.bu, p.bl);
  limb(ctx, bl, [15, 12], L.dark, INK);
  blob(ctx, bl[2][0] + 5, bl[2][1] - 2, 10, 5, 0, L.dark, INK);
  limb(ctx, ba, [12, 10], L.dark, INK);

  // torso
  const mid: V = [(hip[0] + neck[0]) / 2, (hip[1] + neck[1]) / 2];
  blob(ctx, mid[0], mid[1], 23, 27, p.t, L.body, INK);
  markings(ctx, look.pattern, mid, p.t, L.mark);
  ctx.beginPath(); ctx.ellipse(mid[0] + Math.cos(p.t) * 7, mid[1] + Math.sin(p.t) * 7, 12, 19, p.t, 0, Math.PI * 2);
  ctx.fillStyle = L.belly; ctx.fill();

  // head
  const ha = p.t + p.h;
  const head: V = [neck[0] + Math.sin(ha) * 16, neck[1] - Math.cos(ha) * 16];
  ctx.save(); ctx.translate(...head); ctx.rotate(ha);
  horns(ctx, look.hornStyle, L.horn);
  // jaw opens on strikes
  ctx.save(); ctx.translate(6, 6); ctx.rotate(p.jaw * 0.6);
  blob(ctx, 8, 6, 14, 7, 0, L.dark, INK);
  ctx.restore();
  blob(ctx, 2, 0, 21, 18, 0, L.body, INK);
  if (p.jaw > 0.2) {
    ctx.fillStyle = '#fff';
    for (const dx of [6, 12, 18]) { ctx.beginPath(); ctx.moveTo(dx - 3, 9); ctx.lineTo(dx, 15); ctx.lineTo(dx + 3, 9); ctx.fill(); }
  }
  eyes(ctx, look.eyeStyle, L, p.jaw > 0.4);
  ctx.restore();

  const fl = leg(p.ft, p.fs), fa = arm(p.fu, p.fl);
  limb(ctx, fl, [16, 13], L.body, INK);
  blob(ctx, fl[2][0] + 5, fl[2][1] - 2, 11, 5.5, 0, L.body, INK);
  limb(ctx, fa, [13, 11], L.body, INK);
  // claws
  const hand = fa[2], fore = Math.atan2(hand[0] - fa[1][0], hand[1] - fa[1][1]);
  ctx.fillStyle = L.horn;
  for (const o of [-0.5, 0, 0.5]) {
    const c = down(hand, fore + o, 11);
    ctx.beginPath(); ctx.moveTo(hand[0] - 3, hand[1]); ctx.lineTo(...c); ctx.lineTo(hand[0] + 3, hand[1]); ctx.fill();
  }
  ctx.restore();
}

// Idle pose for portraits / menus (render-only).
export function idlePose(now: number): Pose {
  return lerpPose(POSES.idle, POSES.idle2, (Math.sin(now / 9) + 1) / 2);
}
