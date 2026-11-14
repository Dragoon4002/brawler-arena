# Arena contract

Staked 1v1 duels with live pari-mutuel betting. Source: `arena/src/lib.rs`, tests: `arena/src/tests.rs`.

Testnet: arena `brawler-arena-v3-ed5da3.testnet` (self-owned, treasury), monsters `brawler-monsters-ed5da3.testnet` (self-owned), referee `brawler-ref-ed5da3.testnet`.

```sh
cd arena
cargo test                              # 42 unit tests
cargo near build non-reproducible-wasm  # -> target/near/arena.wasm
```

## Flow
1. Host `create_match(bettable)` with the stake attached (0 allowed).
2. Guest `join_match(match_id)` with the same deposit. Match goes Live.
3. Anyone but the two players `place_bet(match_id, side)` while Live (0 = host, 1 = guest).
   Weight = amount × max(10%, 100% − 30% × KOs reported so far). One side per account; repeat bets add up.
4. Referee `report_kos` during the fight, then `report_result(match_id, winner | null)`.
5. Everyone calls `claim(match_id)`: winner gets 2×stake − 0.1%; winning bettors get their bet back plus
   (losing pool − 0.1%) × weight / winning weight. Nobody on the winning side → all bets refunded. `null` result,
   `cancel_match`, or `expire` (after 2 h) → everyone gets exactly what they put in.

## Monsters (optional NFTs, `monsters` contract)
- Init: `new(owner_id, referee_id, monsters_id)`.
- `create_match(bettable, monster_id?)` / `join_match(match_id, monster_id?)`: with a monster the arena first calls
  `monsters.lock(monster, caller, now + 5h)` (2 h open + 2 h live expiry + 1 h buffer), then `on_create` / `on_join` does the create/join. If the lock fails or the
  match changed meanwhile (joined, cancelled, treasury can't seed) the deposit is refunded and the monster unlocked;
  the tx result is then `null` / `false` (a refund that fails to land goes to the treasury). Attach >= 100 Tgas.
- `report_result(match_id, winner, kos?)` (`kos[i]` = KOs by seat i) sends `monsters.record_result` and unlocks;
  `cancel_match` / `expire` unlock. Referee attaches 100 Tgas.

## Tournaments
- Owner `create_tournament(size 4|8, entry_fee, bettable)` (1 yocto).
- `enter_tournament(id, monster_id)` with exactly `entry_fee` and >= 150 Tgas (else panics "Attach 150 Tgas"):
  entries close 24 h after creation ("Entry closed"); locks the monster 72 h (24 h fill + 3 rounds x 2 h), `on_enter` adds the
  entrant (refund + unlock if full, already entered, or lock failed). One entry per account.
- Full -> round-1 matches go Live (entrant 2i vs 2i+1, stake 0, bettable if the tournament is and the treasury can seed).
  Each `report_result` advances the winner (void/expired -> random seat via `random_seed`), unlocks the loser, and opens the next-round match once
  both feeders are done. The final crowns the champion, adds title "Tournament #<id> Champion", unlocks.
- `claim_tournament(id)`: champion gets pot - 0.1% (fee to treasury). `cancel_tournament(id)` (anyone, still Open after
  24 h) -> every entrant claims their fee back.
- Views: `get_tournament(id)`, `list_tournaments(from, limit)` (newest first).

## Trust and limits
- The referee account decides results. Its server key is a function-call key scoped to `report_kos` and
  `report_result` on this contract (1 NEAR gas allowance), so it can't move funds.
- Owner calls (`set_referee`, `set_limits`, `withdraw_treasury`) need 1 yoctoNEAR attached, so they need a full-access key.
- Bet limits default to 0.01–100 NEAR per account per match (`set_limits`).
- Storage for matches and bets is paid from the contract's own balance. Keep a few NEAR on the account.
  Zero-stake `create_match` is free for the caller, so it can be spammed to burn that balance (fine on testnet;
  require a storage deposit before mainnet).
- KO reports lag the live fight by a block or two, so a bet placed right after a KO can still get the earlier weight.
