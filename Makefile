COMPOSE := docker compose -f infra/compose.yml

TF := terraform -chdir=infra/terraform

.PHONY: dev down logs test wasm e2e deploy-infra push-image push-client push-agents push-market deploy

dev:
	$(COMPOSE) up --build -d
	@echo "brawler ws -> ws://localhost:$${BRAWLER_PORT:-8787}"

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f

test:
	npm test
	cargo test --workspace
	cd contracts/platform && cargo test
	cd games/brawler/contract && cargo test
	$(MAKE) e2e

wasm:
	cd contracts/platform && cargo near build non-reproducible-wasm
	cd games/brawler/contract && cargo near build non-reproducible-wasm

e2e: wasm
	cd contracts/e2e && cargo test -- --nocapture

deploy-infra:
	$(TF) init
	$(TF) apply

# built locally: a release build on a 2G t4g box takes >10 min and starves ssh
PLATFORM ?= linux/arm64
push-image:
	docker buildx build --platform $(PLATFORM) -f infra/brawler-server.Dockerfile -t brawler-server --load .
	docker save brawler-server | gzip | ssh ubuntu@$$($(TF) output -raw public_ip) 'gunzip | sudo docker load'

push-client:
	docker buildx build --platform $(PLATFORM) -f infra/brawler-client.Dockerfile -t brawler-client --load .
	docker save brawler-client | gzip | ssh ubuntu@$$($(TF) output -raw public_ip) 'gunzip | sudo docker load'

push-agents:
	docker buildx build --platform $(PLATFORM) -f infra/agents.Dockerfile -t brawler-agents --load .
	docker save brawler-agents | gzip | ssh ubuntu@$$($(TF) output -raw public_ip) 'gunzip | sudo docker load'

push-market:
	docker buildx build --platform $(PLATFORM) -f infra/market.Dockerfile -t brawler-market --load .
	docker save brawler-market | gzip | ssh ubuntu@$$($(TF) output -raw public_ip) 'gunzip | sudo docker load'

# extra flags: make deploy ANSIBLE_ARGS="-e @infra/ansible/secrets.yml --ask-vault-pass"
deploy: push-image push-client push-agents push-market
	ANSIBLE_CONFIG=infra/ansible/ansible.cfg ansible-playbook infra/ansible/playbook.yml \
		-i "$$($(TF) output -raw public_ip)," -e domain="$$($(TF) output -raw domain)" $(ANSIBLE_ARGS)
