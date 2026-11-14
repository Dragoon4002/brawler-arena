# Infra

One t4g.small (arm64) box runs the game server and bots; Caddy on 443 terminates TLS for `brawler-server:8787` (WebSocket, `/history/*`, `/tape/*`). The Next.js apps (`games/brawler/client`, `market/`) are hosted on Vercel.

Vercel env:
- game client: `NEXT_PUBLIC_SERVER_URL=wss://<domain>`, `NEXT_PUBLIC_MARKET_URL=<market url>`
- market: `NEXT_PUBLIC_DEMO=1` until the skills contract is live, `NEXT_PUBLIC_BRAWLER_URL=<game url>`

## Deploy

Needs `AWS_PROFILE=crayo`, ssh access as `ubuntu`, docker buildx (linux/arm64). Ansible checks out `main` from GitHub, so push the infra changes first.

```sh
export AWS_PROFILE=crayo
make deploy-infra                 # first time only (terraform)
make deploy                       # build+ship server and bot images, then ansible
# or piecewise:
make push-image                   # server only
make push-agents                  # bots only
make deploy ANSIBLE_ARGS="-e @infra/ansible/secrets.yml --ask-vault-pass"
```

Images are built locally and loaded over ssh; the box never builds (`compose up --no-build`).

Server: wss://65-0-237-185.sslip.io
