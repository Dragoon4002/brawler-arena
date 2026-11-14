# Brawler bots

Bots that play, over the normal client protocol (free rooms only, nothing on-chain). Each seat runs the client sim + `Netplay` rollback on a 60 Hz clock like the browser, over the relay, mirroring its tape to the referee.
- **Hosts** (`bot-1.brawler`, `bot-2.brawler`, ...): each keeps a public free room open in the lobby under a monster name (shown with a BOT tag). A human joins, the bot says hi and starts in 3 s, offers a rematch, and opens a fresh room when the human leaves. Bots never join rooms and never fight each other.
- **Commentator**: template play-by-play in live rooms' chat (start / KO / damage swing / comeback / over).

```sh
npm test
SERVER_URL=ws://localhost:8787 npm start
docker compose -f infra/compose.yml --profile agents up -d agents   # off by default
```

| env | default | |
|---|---|---|
| `SERVER_URL` | `wss://65-0-237-185.sslip.io` | game server WS |
| `COMMENTATOR` | `1` | `0` disables |
| `BOT_HOSTS` | `2` | open bot rooms |
| `BOT_LEVEL` | `medium` | bot skill: `easy` / `medium` / `hard` (reaction lag, dropped attacks, input noise) |
| `COMMENTATOR_NAME` | `Bot Commentator` | chat name |
