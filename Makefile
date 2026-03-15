.PHONY: help run dev test update clean

BLUE := \033[36m
GREEN := \033[32m
YELLOW := \033[33m
RED := \033[31m
NC := \033[0m

help:
	@echo "$(BLUE)OpenCode Telegram Plugin - Host Commands$(NC)"
	@echo ""
	@echo "  make run     - Run locally"
	@echo "  make dev     - Run with hot reload"
	@echo "  make test    - Run tests"
	@echo "  make update  - Pull, rebuild, and restart guidance"
	@echo "  make clean   - Remove local runtime data"

check-env:
	@if [ ! -f .env ]; then \
		echo "$(RED)Error: .env file not found$(NC)"; \
		echo "Run ./control.sh setup first."; \
		exit 1; \
	fi

run: check-env
	@echo "$(BLUE)Starting in host mode...$(NC)"
	@if ! curl -s http://localhost:4096/global/health > /dev/null 2>&1; then \
		echo "$(YELLOW)Warning: OpenCode server not detected at localhost:4096$(NC)"; \
		echo "Start it first: opencode serve --port 4096 --hostname 127.0.0.1"; \
	fi
	@npm start

dev: check-env
	@echo "$(BLUE)Starting in development mode...$(NC)"
	@npm run dev

test:
	@./test.sh

update:
	@echo "$(BLUE)Updating...$(NC)"
	@git pull
	@npm run build
	@echo "$(GREEN)Update complete. Start with ./control.sh host$(NC)"

clean:
	@echo "$(YELLOW)Cleaning local runtime data...$(NC)"
	@rm -rf data/* shared/*
	@echo "$(GREEN)Cleanup complete$(NC)"
