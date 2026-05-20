# Memori

A prototype long-term memory layer for LLM conversations. Memori lets an assistant remember preferences, facts, and past chats across fresh-context sessions, with automatic retrieval and LLM-controlled write hygiene.

## How it works

1. Before each model call, the system retrieves the most relevant memories and the 5 most recent / 5 most similar past conversation summaries, and injects them into the context.
2. The LLM answers the user. It also has two tools, `memory_upsert` and `memory_delete`, that it uses to keep the long-term memory accurate (creating new memories, refining contradicted ones, pruning duplicates, honoring forget requests).
3. When a session ends, the system stores a one-sentence summary of the conversation, which later becomes part of the recent / similar context for future sessions.

For the full design, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Quick start

Requirements: Python 3.10, [`uv`](https://github.com/astral-sh/uv), and a `.env` file at the repo root with:

```
OPENROUTER_API_KEY=sk-or-...
MEMORI_LLM_MODEL=deepseek/deepseek-v4-flash
MEMORI_REASONING_EFFORT=high
MEMORI_EMBEDDING_MODEL=perplexity/pplx-embed-v1-4b
```

Set up the virtualenv, then run the CLI:

```sh
make env       # create .venv, install dependencies
make run       # start the CLI (alias for `make cli`)
```

In the CLI:

- type to chat. Reasoning streams in dim italic, the reply streams in plain, tool calls show as dim grey lines like `· memory.upsert`
- `/memories` lists every stored memory
- `/new` saves the current session as a conversation summary and starts fresh
- `/reset` wipes all memories
- `Ctrl+D` saves the session and exits

## Benchmarks

13 YAML scenarios in `benchmarks/` cover retrieval injection, memory tool calls (create / update / delete / noise rejection), and full multi-session loops. Run them with:

```sh
make benchmark
```

A timestamped markdown log is written to `runs/`.

## Layout

```
src/
  cli/         user-facing REPL
  core/        memory engine, vector store, OpenRouter client, LLM loop
  benchmark/   scenario loader + grader
benchmarks/    scenario YAML files
docs/          README + ARCHITECTURE
runs/          benchmark run logs (gitignored)
```
