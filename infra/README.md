# Infra

One t4g.small (arm64) box. Caddy on 443 routes WebSocket upgrades + `/history/*` + `/tape/*` to `brawler-server:8787`, everything else to `brawler-client:3000` (Next.js standalone). `market.<domain>` goes to `market:3000` (Next.js standalone, built with bun).

## Deploy

Needs `AWS_PROFILE=crayo`, ssh access as `ubuntu`, docker buildx (linux/arm64). Ansible checks out `main` from GitHub, so push the infra changes first.

```sh
export AWS_PROFILE=crayo
make deploy-infra                 # first time only (terraform)
make deploy                       # build+ship server and client images, then ansible
# or piecewise:
make push-image                   # server only
make push-client                  # client only
make push-agents                  # bots only
make push-market                  # market only
make deploy ANSIBLE_ARGS="-e @infra/ansible/secrets.yml --ask-vault-pass"
```

Images are built locally and loaded over ssh; the box never builds (`compose up --no-build`).
After `push-client` alone, recreate it on the box: `ssh ubuntu@<ip> 'cd /opt/brawler-arena && sudo docker compose -f infra/compose.yml -f infra/compose.prod.yml up -d brawler-client'`.

Live: https://65-0-237-185.sslip.io, market: https://market.65-0-237-185.sslip.io
