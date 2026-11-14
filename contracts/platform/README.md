# arena

Brawler Arena contract: staked 1v1 duels, AMM spectator betting, optional monster NFTs, 4/8-player tournaments.
Full flow and calls: [`../README.md`](../README.md).

```sh
cargo test                              # unit tests
cargo near build non-reproducible-wasm  # -> target/near/arena.wasm
near contract call-function as-transaction <arena> new json-args '{"owner_id":"<owner>","referee_id":"<referee>","monsters_id":"<monsters>"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR'
```
