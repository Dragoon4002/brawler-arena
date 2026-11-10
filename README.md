# Brawler Arena

A real-time 2D platform fighter: two monsters on a floating stage, knocking each other off it. This is the base battle loop for a NEAR-based arena game. NFT monsters and their stats get plugged in later through `src/sim/sim.ts` → `Stats`.

## Run

```sh
npm install
npm run dev       # game at http://localhost:5173
npm run server    # online relay at ws://localhost:8787 (only needed for online play)
npm test          # simulation tests
```

- **Local versus:** click *Local Versus*.
- **Online:** player A clicks *Host Online* and shares the 4-letter code. Player B types it and clicks *Join*.
- **Production (one process):** `npm run build && npm start` serves the game and the relay on `$PORT` (default 8787). Deploy as a single Node web service, for example on Railway or Render.
- **Remote server:** open the game with `?server=wss://your-host` or set `VITE_SERVER_URL` at build time.

## Controls

| | Move / aim | Jump | Light | Heavy | Dodge |
|---|---|---|---|---|---|
| P1 | WASD | Space | Z | X | C |
| P2 | Arrows | Num0 / RShift | Num1 / , | Num2 / . | Num3 / / |
| Gamepad | Stick / D-pad | A | X | B / Y | Bumpers / triggers |

Hold a direction with an attack to pick the move (neutral, side or down; ground or air). Air neutral heavy is the recovery move; air down heavy is the ground pound. Hold down on a thin platform to drop through it. Press ` to show hitboxes and Esc to return to the menu.

## How it works

- **`src/sim/`**: deterministic simulation at a fixed 60 Hz. It has no DOM, no randomness, no trig and no clock, so the same inputs always produce the same state.
  - **Fighter states:** idle, run, jumpsquat, air, land, dodge, attack, hitstun, dead.
  - **Health + damage %:** each stock has 200 HP. Damage taken lowers HP and raises knockback: (base + damage% × growth) × defence modifier.
  - **Hit timing:** hitlag freezes both fighters on impact, and hitstun scales with knockback.
  - **Stocks:** you lose one when you leave the blast zone or your HP hits 0; 3 each.
  - **Movement:** 1 ground jump plus 2 air jumps, short hop, fast-fall, and dodges with invulnerability frames and a cooldown.
  - **Input buffer:** button presses are remembered for 6 frames.
  - **Frame data:** in `moves.ts` (startup, active and recovery frames, hitbox, damage, knockback).
- **`src/render/`**: a procedural bone rig. Each animation is a keyframed pose that gets tweened: wind-up, then a snap into the strike, then an ease back to rest. On top of that: a camera that zooms to fit both fighters, hit sparks, screen shake and KO beams. The renderer only reads sim state; it never changes it.
- **`src/net.ts` + `server/relay.ts`**: delay-based lockstep netplay. Each client sends its input 4 frames ahead and steps the sim only when both players' inputs for that frame have arrived. The clients compare state hashes every second to detect desyncs. The relay server only pairs rooms and forwards packets.

The reference game was studied for its move set, animation phases and frame counts. No art, names or data were copied.

## Not built yet

Wall cling, weapon pickups, rollback netcode, matchmaking, wiring NFT stats in, sound.
