# brawler_arena base battle

- [x] Scaffold Vite + TS + Canvas2D
- [x] Deterministic sim (states, moves, hits, KO, stocks) + node:test suite
- [x] Bone rig + poses + FX + HUD + camera
- [x] Input (2 keyboard sets + gamepads, tap latch)
- [x] Lockstep netplay + ws relay + menu
- [x] README

## Review
- `npm test` 7/7, `tsc --noEmit` clean, `vite build` ok.
- Headless Chrome: local match renders, attacks/swoosh/hitboxes visible.
- Two-browser online match 15 s random inputs: no desync, same stocks both sides.
- KO thresholds (dummy, side/top KO): sHeavy ~120% center / ~70% edge, nHeavy ~120%, dHeavy ~150-190%.
- Next: NFT stats → `Stats`/`Look`, rollback if latency hurts, deploy relay.
