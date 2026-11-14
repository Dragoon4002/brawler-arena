// Sprite-sheet heroes: frames pre-rendered in Blender (games/brawler/sprites/build.py) from rig.ts poses.
// Frame picked from fighter state, mirroring poseFor. Render-only.
import { MOVES } from '../sim/moves.ts';
import { startup, type Fighter } from '../sim/sim.ts';

type V = [number, number];
interface Sheet { cell: V; cols: number; anchor: V; pxPerUnit: number; frames: Record<string, number>; img: HTMLImageElement }

const sheets = new Map<string, Sheet | null>();

// Starts loading on first call; null until the atlas is decoded (caller falls back to the vector rig).
export function sheet(name: string): Sheet | null {
  if (!sheets.has(name)) {
    sheets.set(name, null);
    const dir = `/chars/${name}/`;
    fetch(dir + 'sheet.json').then((r) => r.json()).then(async (s: Sheet) => {
      s.img = new Image(); s.img.src = dir + 'sheet.png'; await s.img.decode();
      sheets.set(name, s);
    }).catch((e) => console.warn('sprite sheet', name, e));
  }
  return sheets.get(name) ?? null;
}

function frameOf(f: Fighter, now: number): string {
  const rest = f.grounded ? 'idle_0' : 'fall';
  switch (f.state) {
    case 'idle': return `idle_${Math.floor(now / 14) % 4}`; // 4 samples of the ~56-frame breathe cycle
    case 'run': return `run_${Math.floor((f.t % 24) / 4)}`;
    case 'jumpsquat': case 'land': return 'squat';
    case 'air': return f.vy < 0 ? 'rise' : 'fall';
    case 'block': return 'guard';
    case 'dodge': return 'tuck';
    case 'hitstun': return Math.hypot(f.vx, f.vy) > 10 ? 'tumble' : 'hurt';
    case 'attack': {
      const m = MOVES[f.move!], su = startup(f, m), end = su + m.active, air = m.air ? 'fall' : 'idle_0';
      if (f.t < su) return f.t < su / 2 ? air : `${f.move}_wind`;
      if (f.t < end) return `${f.move}_strike`;
      const k = (f.t - end) / m.recovery;
      return k < 0.4 ? `${f.move}_strike` : k < 0.75 ? `${f.move}_wind` : air;
    }
    default: return rest;
  }
}

// Fighter-local space: origin at feet, facing right. `spin` = pose.r (dodge/tumble/recovery), about the hip.
export function drawSheet(ctx: CanvasRenderingContext2D, s: Sheet, f: Fighter, now: number, spin: number, flash: boolean) {
  const i = s.frames[frameOf(f, now)] ?? 0, [w, h] = s.cell;
  ctx.save();
  if (spin) { ctx.translate(0, -44); ctx.rotate(spin); ctx.translate(0, 44); }
  ctx.scale(1 / s.pxPerUnit, 1 / s.pxPerUnit);
  if (flash) ctx.filter = 'brightness(0) invert(1)';
  ctx.drawImage(s.img, (i % s.cols) * w, Math.floor(i / s.cols) * h, w, h, -s.anchor[0], -s.anchor[1], w, h);
  ctx.restore();
}
