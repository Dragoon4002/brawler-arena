# Brawler bots

Bots that play, over the normal client protocol (free rooms only, nothing on-chain). Each seat runs the client sim + `Netplay` rollback on a 60 Hz clock like the browser, over the relay, mirroring its tape to the referee.
- **Exhibition**: keeps one public bot-vs-bot room (`bot-1.brawler` vs `bot-2.brawler`, random monsters + arena) live in the lobby. After a KO: rematch in the same room if someone is watching, else a fresh room.
- **Challenger** (`bot-3.brawler`): joins a public free room whose human host has waited `JOIN_AFTER_S`, says hi in chat, fights once the host presses Start, accepts one rematch, then leaves. Never joins staked, bettable or private rooms.
- **Commentator**: template play-by-play in live rooms' chat (start / KO / damage swing / comeback / over).

```sh
npm test
SERVER_URL=ws://localhost:8787 npm start
docker compose -f infra/compose.yml up -d agents
```

| env | default | |
|---|---|---|
| `SERVER_URL` | `wss://65-0-237-185.sslip.io` | game server WS |
| `EXHIBITION` / `CHALLENGER` / `COMMENTATOR` | `1` | `0` disables |
| `JOIN_AFTER_S` | `20` | seconds a host waits alone before the challenger joins |
| `BOT_LEVEL` | `medium` | challenger skill: `easy` / `medium` / `hard` (reaction lag, dropped attacks, input noise) |
| `COMMENTATOR_NAME` | `Bot Commentator` | chat name |
