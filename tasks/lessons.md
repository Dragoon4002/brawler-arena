
## 2026-11-14 — character animation requests
- "Use image X as reference" for a character = build from that art (painted cutout), not the procedural rig. Don't reuse existing rig poses when user asks for "new/better animations".
- Sprite deliverable = transparent PNG frames + spritesheet + JSON (anchor, fps, phases), one character only unless told otherwise.
- Don't stall on art-method questions once intent is clear; pick the option closest to the user's words and show results.

- Deadline math: run `date -u` before stating time left; session date can be off by a day (said "deadline passed" with 5 h left, 2026-11-14).

- When work has independent parts (env/id switches, smoke tests, docs) spawn parallel agents with disjoint files instead of doing them serially; only keep truly sequential steps (same keys/accounts) inline.
