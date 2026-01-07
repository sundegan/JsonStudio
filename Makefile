.PHONY: help dev build check test fmt lint clean install

# Default target: show help
help:
	@echo "Tauri desktop app development commands"
	@echo ""
	@echo "  make dev          - Development mode (build and run frontend + backend)"
	@echo "  make build        - Build application (frontend + backend)"
	@echo "  make check        - Type check (frontend + backend)"
	@echo "  make test         - Run tests"
	@echo "  make fmt          - Format code (frontend + backend)"
	@echo "  make lint         - Lint code (frontend + backend)"
	@echo "  make clean        - Clean build artifacts"
	@echo "  make install      - Install dependencies"

# Development mode (frontend + backend)
dev:
	pnpm tauri dev

# Build application (frontend + backend)
build:
	pnpm tauri build

# Type check (frontend + backend)
check:
	pnpm check
	cd src-tauri && cargo check

# Run tests
test:
	cd src-tauri && cargo test

# Format code (frontend + backend)
fmt:
	cd src-tauri && cargo fmt
	pnpm exec prettier --write "src/**/*.{ts,js,svelte}" 2>/dev/null || true

# Lint code (frontend + backend)
lint:
	cd src-tauri && cargo clippy
	pnpm check

# Clean build artifacts
clean:
	rm -rf build
	rm -rf src-tauri/target
	rm -rf node_modules/.vite

# Install dependencies
install:
	pnpm install
	cd src-tauri && cargo fetch

