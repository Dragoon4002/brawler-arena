import { IN } from './sim/sim.ts';

// P1: WASD + Space/Z/X/C. P2: arrows + Numpad 0/1/2/3 (or , . / RightShift). Gamepads: A jump, X light, B heavy, bumpers dodge.
const KEYS: Record<string, number>[] = [
  { KeyA: IN.LEFT, KeyD: IN.RIGHT, KeyW: IN.UP, KeyS: IN.DOWN, Space: IN.JUMP, KeyZ: IN.LIGHT, KeyX: IN.HEAVY, KeyC: IN.DODGE },
  { ArrowLeft: IN.LEFT, ArrowRight: IN.RIGHT, ArrowUp: IN.UP, ArrowDown: IN.DOWN,
    Numpad0: IN.JUMP, Numpad1: IN.LIGHT, Numpad2: IN.HEAVY, Numpad3: IN.DODGE,
    ShiftRight: IN.JUMP, Comma: IN.LIGHT, Period: IN.HEAVY, Slash: IN.DODGE },
];
const held = new Set<string>();
const tapped = new Set<string>(); // keys pressed+released between two 60 Hz polls still count once
const ALL = new Set(KEYS.flatMap((k) => Object.keys(k)));
addEventListener('keydown', (e) => {
  if (ALL.has(e.code) && !(e.target instanceof HTMLInputElement)) { held.add(e.code); tapped.add(e.code); e.preventDefault(); }
});
addEventListener('keyup', (e) => held.delete(e.code));
addEventListener('blur', () => held.clear());

function keys(i: number) {
  let b = 0;
  for (const [code, bit] of Object.entries(KEYS[i])) if (held.has(code) || tapped.has(code)) b |= bit;
  return b;
}

function pad(i: number) {
  const g = navigator.getGamepads?.()[i];
  if (!g) return 0;
  const btn = (n: number) => !!g.buttons[n]?.pressed;
  const ax = g.axes[0] ?? 0, ay = g.axes[1] ?? 0;
  let b = 0;
  if (ax < -0.5 || btn(14)) b |= IN.LEFT;
  if (ax > 0.5 || btn(15)) b |= IN.RIGHT;
  if (ay < -0.5 || btn(12)) b |= IN.UP;
  if (ay > 0.5 || btn(13)) b |= IN.DOWN;
  if (btn(0)) b |= IN.JUMP;
  if (btn(2)) b |= IN.LIGHT;
  if (btn(1) || btn(3)) b |= IN.HEAVY;
  if (btn(4) || btn(5) || btn(6) || btn(7)) b |= IN.DODGE;
  return b;
}

// Local versus: P1 = keyboard set 1 (+ 2nd pad), P2 = keyboard set 2 (+ 1st pad).
export const localInputs = () => { const r = [keys(0) | pad(1), keys(1) | pad(0)]; tapped.clear(); return r; };
// Online: one player, any binding.
export const soloInput = () => { const r = keys(0) | keys(1) | pad(0); tapped.clear(); return r; };
