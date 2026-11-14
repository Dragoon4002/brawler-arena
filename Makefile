COMPOSE := docker compose -f infra/compose.yml

.PHONY: dev down logs test wasm e2e

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
