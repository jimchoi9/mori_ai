.PHONY: up down verify-install verify-isolation
up:
	docker compose up --build -d --wait

down:
	docker compose down --remove-orphans

verify-install:
	./scripts/verify-install.sh

verify-isolation:
	./scripts/verify-isolation.sh
