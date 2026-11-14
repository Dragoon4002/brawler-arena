// Painted stage art: screen-space backdrop + world-space platform image. Source art: assets/stages/<id> -> public/stages/<id>
// (black bg keyed by sprites/stages/key.py; walkable surfaces measured with sprites/stages/surf.py and written into stages.ts).
// Falls back to the procedural painter (stage.ts) until images load, and for grove's backdrop (no clean one yet).
import { STAGES, type StageId } from '../stages.ts';

// s = world units per image px; `at` pins image point (px, py) to world point (wx, wy). Must agree with stages.ts geometry.
const ART: Record<StageId, { s: number; at: [px: number, py: number, wx: number, wy: number]; bg: boolean }> = {
  ember: { s: 0.85, at: [837, 452, 800, 600], bg: true },
  docks: { s: 0.88, at: [706, 666, 800, 640], bg: true },
  grove: { s: 1.09, at: [734, 559, 800, 620], bg: false },
};

const imgs = new Map<string, HTMLImageElement | null>();
function img(src: string) {
  if (!imgs.has(src)) { imgs.set(src, null); const i = new Image(); i.src = src; i.decode().then(() => imgs.set(src, i), () => {}); }
  return imgs.get(src) ?? null;
}

// Screen-space backdrop, cover-fit with a little parallax. false = not ready / none (caller paints procedural sky).
export function paintArtBackground(c: CanvasRenderingContext2D, id: StageId, cam: { x: number; y: number }, W: number, H: number) {
  const i = ART[id].bg ? img(`/stages/${id}/bg.png`) : null;
  if (!i) return false;
  const k = Math.max(W / i.width, H / i.height) * 1.12;
  c.drawImage(i, (W - i.width * k) / 2 - (cam.x - 800) * 0.04, (H - i.height * k) / 2 - (cam.y - 450) * 0.03, i.width * k, i.height * k);
  return true;
}

// World-space platforms. false = not ready (caller paints procedural stage).
export function paintArtStage(c: CanvasRenderingContext2D, id: StageId) {
  const i = img(`/stages/${id}/fg.png`);
  if (!i) return false;
  const { s, at: [px, py, wx, wy] } = ART[id];
  c.drawImage(i, wx - px * s, wy - py * s, i.width * s, i.height * s);
  return true;
}

// Front layer (clouds / sea+crane / canopy): static, blurred once at load, drawn over fighters, stretched 1:1 over the blast box.
const TOP_BLUR = 4; // px
const blurred = new Map<string, HTMLCanvasElement>();

export function paintArtFront(c: CanvasRenderingContext2D, id: StageId) {
  const i = img(`/stages/${id}/top.png`);
  if (!i) return;
  let o = blurred.get(id);
  if (!o) {
    o = document.createElement('canvas'); o.width = i.width; o.height = i.height;
    const x = o.getContext('2d')!; x.filter = `blur(${TOP_BLUR}px)`; x.drawImage(i, 0, 0);
    blurred.set(id, o);
  }
  const b = STAGES[id].blast;
  c.drawImage(o, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
}
