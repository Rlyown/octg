# OpenCode Telegram Plugin - Universal Deployment Makefile
# Supports Docker, OrbStack, and Host deployment

.PHONY: help up down logs status restart build run clean test

# Default values
WORKSPACE_PATH ?= ./workspace
CONFIG_PATH ?= ~/.config/opencode
COMPOSE_FILE ?= docker-compose.yml

# Colors for output
BLUE := \033[36m
GREEN := \033[32m
YELLOW := \033[33m
RED := \033[31m
NC := \033[0m # No Color

help: ## Show this help message
	@echo "$(BLUE)OpenCode Telegram Plugin - Deployment Commands$(NC)"
	@echo ""
	@echo "$(GREEN)Docker/OrbStack Commands:$(NC)"
	@echo "  make up      - Start services (Docker/OrbStack)"
	@echo "  make down    - Stop services"
	@echo "  make logs    - View logs"
	@echo "  make status  - Check service status"
	@echo "  make restart - Restart services"
	@echo "  make build   - Build Docker images"
	@echo ""
	@echo "$(GREEN)Host Commands:$(NC)"
	@echo "  make run     - Run locally (without Docker)"
	@echo "  make dev     - Run with hot reload"
	@echo ""
	@echo "$(GREEN)Maintenance:$(NC)"
	@echo "  make test    - Run tests"
	@echo "  make clean   - Clean up containers and volumes"
	@echo "  make update  - Update and rebuild"
	@echo ""
	@echo "$(YELLOW)Current Configuration:$(NC)"
	@echo "  WORKSPACE_PATH: $(WORKSPACE_PATH)"
	@echo "  CONFIG_PATH: $(CONFIG_PATH)"

# Check if .env exists
check-env:
	@if [ ! -f .env ]; then \
		echo "$(RED)Error: .env file not found$(NC)"; \
		echo "Please copy .env.example to .env and configure it:"; \
		echo "  cp .env.example .env"; \
		exit 1; \
	fi

# Check Docker/OrbStack availability
check-docker:
	@which docker > /dev/null || (echo "$(RED)Error: Docker not found$(NC)" && exit 1)
	@docker info > /dev/null 2>&1 || (echo "$(RED)Error: Docker daemon not running$(NC)" && exit 1)
	@echo "$(GREEN)✓ Docker is available$(NC)"
	@if command -v orb > /dev/null 2>&1; then \
		echo "$(GREEN)✓ OrbStack detected$(NC)"; \
	fi

up: check-env check-docker ## Start services with Docker/OrbStack
	@echo "$(BLUE)Starting services...$(NC)"
	@export WORKSPACE_PATH=$(WORKSPACE_PATH) && \
	export CONFIG_PATH=$(CONFIG_PATH) && \
	docker-compose -f $(COMPOSE_FILE) up -d
	@echo "$(GREEN)✓ Services started$(NC)"
	@echo ""
	@echo "View logs: $(YELLOW)make logs$(NC)"
	@echo "Check status: $(YELLOW)make status$(NC)"

down: ## Stop services
	@echo "$(BLUE)Stopping services...$(NC)"
	@docker-compose -f $(COMPOSE_FILE) down
	@echo "$(GREEN)✓ Services stopped$(NC)"

logs: ## View logs
	@docker-compose -f $(COMPOSE_FILE) logs -f

status: ## Check service status
	@echo "$(BLUE)Service Status:$(NC)"
	@docker-compose -f $(COMPOSE_FILE) ps
	@echo ""
	@echo "$(BLUE)Container Health:$(NC)"
	@docker-compose -f $(COMPOSE_FILE) exec opencode wget -q --spider http://localhost:4096/global/health 2>/dev/null && \
		echo "$(GREEN)✓ OpenCode: Healthy$(NC)" || \
		echo "$(RED)✗ OpenCode: Not Responding$(NC)"

restart: down up ## Restart services

build: check-env ## Build Docker images
	@echo "$(BLUE)Building images...$(NC)"
	@docker-compose -f $(COMPOSE_FILE) build
	@echo "$(GREEN)✓ Images built$(NC)"

# Host deployment (without Docker)
run: check-env ## Run locally (requires opencode serve running)
	@echo "$(BLUE)Starting in host mode...$(NC)"
	@if ! curl -s http://localhost:4096/global/health > /dev/null 2>&1; then \
		echo "$(YELLOW)⚠ Warning: OpenCode server not detected at localhost:4096$(NC)"; \
		echo "Please start it first: opencode serve --port 4096"; \
	fi
	@npm start

dev: check-env ## Run with hot reload
	@echo "$(BLUE)Starting in development mode...$(NC)"
	@npm run dev

# Testing
test: ## Run tests
	@./test.sh

# Maintenance
clean: down ## Clean up containers and volumes
	@echo "$(YELLOW)Cleaning up...$(NC)"
	@docker-compose -f $(COMPOSE_FILE) down -v --remove-orphans
	@docker system prune -f
	@echo "$(GREEN)✓ Cleanup complete$(NC)"

update: ## Update and rebuild
	@echo "$(BLUE)Updating...$(NC)"
	@git pull
	@make build
	@make restart
	@echo "$(GREEN)✓ Update complete$(NC)"

# OrbStack specific commands (Mac only)
if-mac:
	@if [[ "$$(uname)" != "Darwin" ]]; then \
		echo "$(RED)This command is for macOS only$(NC)"; \
		exit 1; \
	fi

orb-status: if-mac ## Check OrbStack status
	@orb status

orb-list: if-mac ## List OrbStack containers
	@orb list

# Utility
shell-telegram: ## Open shell in telegram-plugin container
	@docker-compose -f $(COMPOSE_FILE) exec telegram-plugin sh

shell-opencode: ## Open shell in opencode container
	@docker-compose -f $(COMPOSE_FILE) exec opencode sh

exec-telegram: ## Execute command in telegram-plugin container
	@docker-compose -f $(COMPOSE_FILE) exec telegram-plugin $(cmd)

exec-opencode: ## Execute command in opencode container
	@docker-compose -f $(COMPOSE_FILE) exec opencode $(cmd)
