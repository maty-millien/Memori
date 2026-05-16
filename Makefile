# Variables ———————————————————————————————————————————————————————————————————

PYTHON_VERSION = 3.10
ENV_DIR = .venv
SOURCE_DIR = src
PYCACHE_DIR = $(ENV_DIR)/pycache
PYTHON_BIN = $(ENV_DIR)/bin/python
PYTHON = PYTHONPYCACHEPREFIX=$(PYCACHE_DIR) $(PYTHON_BIN)

# Environment rules ———————————————————————————————————————————————————————————

env:
	uv venv $(ENV_DIR) --python $(PYTHON_VERSION)
	uv pip install --python $(PYTHON_BIN) --group app --group dev

sync:
	uv pip install --python $(PYTHON_BIN) --upgrade --group app --group dev

clean:
	rm -rf $(ENV_DIR)

# Project rules ———————————————————————————————————————————————————————————————

run:
	$(PYTHON) src/main.py

tidy:
	$(ENV_DIR)/bin/mypy $(SOURCE_DIR)
	$(ENV_DIR)/bin/ruff check --fix $(SOURCE_DIR)
	$(ENV_DIR)/bin/ruff format $(SOURCE_DIR)
