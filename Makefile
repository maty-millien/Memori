# Variables ———————————————————————————————————————————————————————————————————

PYTHON_VERSION = 3.10
ENV_DIR = .venv
SOURCE_DIR = src
PYCACHE_DIR = $(ENV_DIR)/cache/python
MYPY_CACHE_DIR = $(ENV_DIR)/cache/mypy
RUFF_CACHE_DIR = $(ENV_DIR)/cache/ruff
PYTHON_BIN = $(ENV_DIR)/bin/python
PYTHON = PYTHONPATH=$(SOURCE_DIR) PYTHONPYCACHEPREFIX=$(PYCACHE_DIR) $(PYTHON_BIN)

# Environment —————————————————————————————————————————————————————————————————

env: clean
	uv venv $(ENV_DIR) --python $(PYTHON_VERSION)
	uv pip install --python $(PYTHON_BIN) --group app --group dev

clean:
	rm -rf $(ENV_DIR)

# Project —————————————————————————————————————————————————————————————————————

run: cli

cli: tidy
	$(PYTHON) -m memori.cli.entry

benchmark: tidy
	$(PYTHON) -m memori.benchmark.entry

tidy:
	MYPYPATH=$(SOURCE_DIR) $(ENV_DIR)/bin/mypy --explicit-package-bases --cache-dir $(MYPY_CACHE_DIR) $(SOURCE_DIR)
	$(ENV_DIR)/bin/ruff check --cache-dir $(RUFF_CACHE_DIR) --fix $(SOURCE_DIR)
	$(ENV_DIR)/bin/ruff format --cache-dir $(RUFF_CACHE_DIR) $(SOURCE_DIR)
	bunx --yes prettier --write --log-level warn .
