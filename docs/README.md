<div align="center">

# Memori

Memori is model-agnostic memory middleware for AI agents. It lets any agent loop retrieve durable memories, expose memory-management tools, and store end-of-session summaries without Memori owning the model call.

[![Python](https://img.shields.io/badge/python-3.10-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![GitHub install](https://img.shields.io/badge/install-GitHub-181717?logo=github)](https://github.com/maty-millien/Memori)
[![OpenRouter](https://img.shields.io/badge/LLM-OpenRouter-6E56CF)](https://openrouter.ai/)
[![Chroma](https://img.shields.io/badge/vector_store-Chroma-FF6B6B)](https://www.trychroma.com/)

</div>

---

![Memori CLI showcasing automatic memory curation](./assets/memori-showcase.png)

## Install From GitHub

Install the library directly from this repository:

```sh
pip install git+https://github.com/maty-millien/Memori.git
```

Install a specific branch:

```sh
pip install git+https://github.com/maty-millien/Memori.git@main
```

Install from a local checkout while developing:

```sh
git clone https://github.com/maty-millien/Memori.git
cd Memori
pip install -e .
```

Then import Memori:

```python
from memori import Memori
```

## Configure

Memori currently uses OpenRouter for embeddings and session summarization. Create a `.env` file in your project with the values from [`.env.example`](../.env.example):

```ini
OPENROUTER_API_KEY=sk-or-v1-...
MEMORI_LLM_MODEL=deepseek/deepseek-v4-flash
MEMORI_REASONING_EFFORT=high
MEMORI_EMBEDDING_MODEL=perplexity/pplx-embed-v1-4b
```

The remaining values in `.env.example` control retrieval limits, importance weights, and ranking weights.

## Library Usage

Memori plugs into an existing agent loop. It does not call your model, manage retries, own streaming, or impose a message format.

```python
from memori import Memori

memori = Memori.from_env(path=".memori")

user_message = "Please remember that I prefer concise Python examples."
context = memori.before_turn(user_message)

response = agent.run(
    prompt=context.prompt,
    tools=memori.tools(),
)

for call in response.tool_calls:
    memori.handle_tool_call(call.name, call.arguments)

memori.after_turn(
    user_message=user_message,
    assistant_message=response.text,
    tool_calls=response.tool_calls,
)

summary = memori.end_session()
```

If your agent does not support tools, you can still use retrieval and session summaries:

```python
context = memori.before_turn(user_message)
response = agent.run(prompt=context.prompt)
memori.after_turn(user_message, response.text)
memori.end_session()
```

## How It Works

1. **Before a turn**, call `before_turn(user_message)`. Memori retrieves ranked durable memories plus recent and similar past conversation summaries.
2. **During the agent call**, use `context.prompt` directly or render `context.memories`, `context.recent_conversations`, and `context.similar_conversations` yourself.
3. **During tool execution**, route `memory_upsert` and `memory_delete` calls to `handle_tool_call(...)`.
4. **After a turn**, call `after_turn(...)` so Memori can track the active session transcript.
5. **When a session ends**, call `end_session()`. Memori summarizes the session, stores that summary as conversation memory, and clears the session buffer.

Ranking blends semantic similarity, importance category, recency, usage, and a small boost for globally scoped memories.

## Public API

`Memori.from_env(path: str | None = None) -> Memori`

Creates a Memori instance using the current `.env` settings. Pass `path=".memori"` for a persistent local Chroma store, or omit `path` for an in-memory store.

`before_turn(user_message: str) -> MemoryContext`

Retrieves relevant durable memories, recent conversation summaries, and similar conversation summaries. The returned context includes:

```python
context.user_message
context.prompt
context.retrieved
context.memories
context.recent_conversations
context.similar_conversations
```

`tools() -> list[MemoryTool]`

Returns framework-neutral tool definitions for `memory_upsert` and `memory_delete`.

`handle_tool_call(name: str, arguments: dict) -> str`

Executes a memory tool call:

```python
memori.handle_tool_call(
    "memory_upsert",
    {
        "content": "The user prefers concise Python examples.",
        "scope": "global",
        "importance": "global_preference",
    },
)
```

`after_turn(user_message: str, assistant_message: str, tool_calls: list | None = None) -> None`

Records a completed turn in the active session transcript. This does not persist a conversation summary yet.

`end_session() -> str`

Summarizes the active session, stores the summary for future recent/similar conversation retrieval, clears the active transcript, and returns the summary. If no turns were recorded, it returns an empty string.

`memories() -> list[Memory]`

Returns durable memories. Conversation summaries are used for retrieval but are not included in this list.

`reset(memories: list[Memory] | None = None) -> None`

Clears stored memories and replaces them with the optional list. This also clears the active session transcript.

## CLI Demo

The CLI is a development/demo app built on the same public `Memori` API. It is not installed as a command by the base library package.

```sh
make env
make run
```

Commands:

| Command     | What it does                                          |
| ----------- | ----------------------------------------------------- |
| `/new`      | Save the current session as a summary and start fresh |
| `/clear`    | Alias for `/new`                                      |
| `/reset`    | Wipe all stored memories                              |
| `/memories` | List every stored memory                              |
| `/help`     | Show help                                             |
| `/quit`     | Save the current session as a summary and exit        |

## Benchmarks

15 YAML scenarios in [`benchmarks/`](../benchmarks) cover retrieval injection, memory tool calls, importance reranking, session-end summaries, and multi-session loops.

```sh
make benchmark
```

A timestamped JSON artifact lands in `.memori/runs/` (gitignored).

## Development

All tooling is driven through the Makefile so caches, paths, and flags stay consistent.

| Target           | Description                                                           |
| ---------------- | --------------------------------------------------------------------- |
| `make env`       | Create `.venv` and install the package plus app/dev dependency groups |
| `make clean`     | Remove `.venv`                                                        |
| `make run`       | Alias for `make cli`                                                  |
| `make cli`       | Start the interactive CLI                                             |
| `make benchmark` | Run YAML scenarios in `benchmarks/`, writing JSON to `.memori/runs/`  |
| `make tidy`      | `mypy`, `ruff check --fix`, `ruff format`, and `prettier --write`     |
