# Variables ———————————————————————————————————————————————————————————————————

PYTHON_VERSION = 3.10
ENV_DIR = .venv
PACKAGE_DIR = memori
TOOLS_DIR = tools
CHECK_DIRS = $(PACKAGE_DIR) $(TOOLS_DIR)
PYCACHE_DIR = $(ENV_DIR)/cache/python
MYPY_CACHE_DIR = $(ENV_DIR)/cache/mypy
RUFF_CACHE_DIR = $(ENV_DIR)/cache/ruff
PYTHON_BIN = $(ENV_DIR)/bin/python
PYTHON = PYTHONPATH=.:$(TOOLS_DIR) PYTHONPYCACHEPREFIX=$(PYCACHE_DIR) $(PYTHON_BIN)

# Environment —————————————————————————————————————————————————————————————————

env: clean
	uv venv $(ENV_DIR) --python $(PYTHON_VERSION)
	uv pip install --python $(PYTHON_BIN) -e . --group app --group dev

clean:
	rm -rf $(ENV_DIR)

tidy:
	MYPYPATH=.:$(TOOLS_DIR) $(ENV_DIR)/bin/mypy --explicit-package-bases --cache-dir $(MYPY_CACHE_DIR) $(CHECK_DIRS)
	$(ENV_DIR)/bin/ruff check --cache-dir $(RUFF_CACHE_DIR) --fix $(CHECK_DIRS)
	$(ENV_DIR)/bin/ruff format --cache-dir $(RUFF_CACHE_DIR) $(CHECK_DIRS)
	bunx --yes prettier --write --log-level warn .


# Project —————————————————————————————————————————————————————————————————————

cli: tidy
	$(PYTHON) -m cli.entry

bench: tidy
	$(PYTHON) -m bench.entry
