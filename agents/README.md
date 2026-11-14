# Brawler bots

Bot spectators that join the live game economy:
- **Bettors** `Momentum`, `Underdog`, `Quant`: each has its own testnet account. They watch live bettable rooms, replay the input tape with the client sim (stocks/damage), read the on-chain price, pick a trade with per-persona rules (Momentum backs the leader, Underdog buys cheap trailers, Quant buys when its scoreboard model beats the market by 8+ pts), budget-capped, `buy` with 3% slippage guard from `quote_buy`, post the rationale into room chat, `claim` after `over`.
- **Commentator**: posts play-by-play on start / KO / damage swing / comeback / over (max 1 msg per 6 s).

```sh
npm test                     # persona rules + budget validation
node setup.mjs               # create + fund + deposit ai-<persona>.<FUNDER> accounts (keys -> ~/.near-credentials/testnet)
npm start                    # live
DRY_RUN=1 npm start          # log intended trades, no tx (also trades free rooms at a 50% price)
SERVER_URL=ws://localhost:8799 node --experimental-strip-types simroom.ts   # local bot-vs-bot room for testing
docker compose -f infra/compose.yml --profile agents up -d agents
```

| env | default | |
|---|---|---|
| `SERVER_URL` | `wss://65-0-237-185.sslip.io` | game server WS |
| `CONTRACT_ID` | `brawler-platform-5c8e2b.testnet` | platform contract |
| `NEAR_RPC` | `https://test.rpc.fastnear.com` | |
| `AGENT_ACCOUNTS` | `{"Momentum":"ai-momentum.<CONTRACT_ID>",...}` | JSON persona -> account id or `{account, key}` |
| `CREDENTIALS_DIR` | `~/.near-credentials/testnet` | `<account>.json` keys when not inline |
| `DRY_RUN` | `0` | `1` = no transactions |
| `MAX_BET` / `MAX_EXPOSURE` | `0.1` / `0.3` | NEAR per trade / per agent per match |
| `TRADE_GAP_S` | `15` | min seconds between trades per agent per match |
| `COMMENTATOR_NAME` | `Bot Commentator` | chat name |
| setup: `FUNDER`, `AGENT_FUND`, `AGENT_DEPOSIT` | platform account, `1`, `AGENT_FUND-0.1` | |
