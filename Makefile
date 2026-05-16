# Variables ———————————————————————————————————————————————————————————————————

PYTHON_VERSION = 3.10
ENV_DIR = .venv
SOURCE_DIR = src
PYCACHE_DIR = $(ENV_DIR)/cache/python
MYPY_CACHE_DIR = $(ENV_DIR)/cache/mypy
RUFF_CACHE_DIR = $(ENV_DIR)/cache/ruff
PYTHON_BIN = $(ENV_DIR)/bin/python
PYTHON = PYTHONPYCACHEPREFIX=$(PYCACHE_DIR) $(PYTHON_BIN)

# Environment —————————————————————————————————————————————————————————————————

env:
	uv venv $(ENV_DIR) --python $(PYTHON_VERSION)
	uv pip install --python $(PYTHON_BIN) --group app --group dev

sync:
	uv pip install --python $(PYTHON_BIN) --upgrade --group app --group dev

clean:
	rm -rf $(ENV_DIR)

# Project —————————————————————————————————————————————————————————————————————

run: tidy
	$(PYTHON) src/main.py

tidy:
	$(ENV_DIR)/bin/mypy --cache-dir $(MYPY_CACHE_DIR) $(SOURCE_DIR)
	$(ENV_DIR)/bin/ruff check --cache-dir $(RUFF_CACHE_DIR) --fix $(SOURCE_DIR)
	$(ENV_DIR)/bin/ruff format --cache-dir $(RUFF_CACHE_DIR) $(SOURCE_DIR)
