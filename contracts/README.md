# Arena contract

Staked 1v1 duels with live pari-mutuel betting. Source: `arena/src/lib.rs`, tests: `arena/src/tests.rs`.

Testnet: `brawler-arena-ed5da3.testnet` (owner + treasury), referee `brawler-ref-ed5da3.testnet`.

```sh
cd arena
cargo test                              # 21 unit tests
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

## Trust and limits
- The referee account decides results. Its server key is a function-call key scoped to `report_kos` and
  `report_result` on this contract (1 NEAR gas allowance), so it can't move funds.
- Owner calls (`set_referee`, `set_limits`, `withdraw_treasury`) need 1 yoctoNEAR attached, so they need a full-access key.
- Bet limits default to 0.01–100 NEAR per account per match (`set_limits`).
- Storage for matches and bets is paid from the contract's own balance. Keep a few NEAR on the account.
  Zero-stake `create_match` is free for the caller, so it can be spammed to burn that balance (fine on testnet;
  require a storage deposit before mainnet).
- KO reports lag the live fight by a block or two, so a bet placed right after a KO can still get the earlier weight.
