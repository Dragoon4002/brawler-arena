COMPOSE := docker compose -f infra/compose.yml

.PHONY: dev down logs test

dev: ## backend svcs (brawler ws :8787)
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
