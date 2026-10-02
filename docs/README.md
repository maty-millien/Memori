# Memori

A local research app for long-term agent memory. Every chat turn shows what the memory layer did: the memories it retrieved and how they scored, the prompt sent to the model, the reasoning, and each memory change.

There is a single endless chat backed by one Codex thread, driven through `codex app-server`. Codex can run any command on your Mac and search the web; the chat shows each step and streams the reply. Each turn retrieves ranked memories and episode summaries and adds only the ones the thread has not seen yet, so the thread prefix stays stable and the prompt cache keeps working. A separate Codex call then returns memory operations (upsert or delete) that the server applies. When the context passes 100k tokens, the oldest third of the live messages is summarized into an episode. The next turn then starts a new thread and injects the raw Codex items (messages, tool calls, and outputs) of the remaining live messages; the same happens after a server restart. A memory created or updated during a turn that is still in the live history is left out of the chat's retrieval, since the model already sees that turn; curation still receives it to avoid duplicates.

## Setup

You need [Bun](https://bun.sh), Node 26, and the Codex CLI logged in (`codex login`). Codex runs with an isolated `CODEX_HOME` in `.memori/codex` that only links to your `~/.codex/auth.json`, so your config, AGENTS.md, skills, and plugins are not loaded. Raw item injection relies on experimental app-server fields (`experimentalRawEvents`, `thread/inject_items`), so a Codex update can break it. The chat reply uses the model and reasoning effort picked in the composer; curation and summaries use `gpt-6-luna` at `low`. Embeddings use OpenRouter: copy [`.env.example`](../.env.example) to `.env` and set `OPENROUTER_API_KEY`.

The composer accepts image and PDF attachments up to 20 MB. Images of the current message are attached to the Codex call; every attachment is listed with its path on disk, so Codex can open it with its tools.

```sh
bun install
bun run dev
```

Retrieval and ranking settings are in [`config.ts`](../src/server/memori/config.ts). Data lives in `.memori/memori.db` and attachments in `.memori/uploads`. `bun run check` formats, lints, and type checks.
