// Painted stage art: screen-space backdrop + world-space platform image. Source art: assets/stages/<id> -> public/stages/<id>
// (black bg keyed by sprites/stages/key.py; walkable surfaces measured with sprites/stages/surf.py and written into stages.ts).
// Falls back to the procedural painter (stage.ts) until images load, and for grove's backdrop (no clean one yet).
import type { StageId } from '../stages.ts';

// s = world units per image px; `at` pins image point (px, py) to world point (wx, wy). Must agree with stages.ts geometry.
const ART: Record<StageId, { s: number; at: [px: number, py: number, wx: number, wy: number]; bg: boolean }> = {
  ember: { s: 0.85, at: [837, 452, 800, 600], bg: true },
  docks: { s: 0.75, at: [837.5, 630, 800, 640], bg: true },
  grove: { s: 1.1, at: [838.5, 515, 800, 620], bg: false },
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
