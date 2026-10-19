# Memori

A local research app for long-term agent memory. Every chat turn shows what the memory layer did: the memories it retrieved and how they scored, the prompt sent to the model, the reasoning, and each memory change.

There is a single endless chat. The server runs its own agent loop against the Codex Responses endpoint (`chatgpt.com/backend-api/codex/responses`), the same one the Codex CLI uses, with `store: false`, so every call sends the whole live history. The model works on the machine running the server, whether that's your computer or a remote server, and the system prompt describes that machine. It has six tools: `shell` runs commands with your `$SHELL`, `read` opens files, images, and PDFs, `patch` edits files, `question` asks you to choose or confirm, `recall` searches archived parts of the conversation, and the hosted `web_search` runs on OpenAI's side.

Each turn ranks every memory against the latest exchange and adds the top 50, along with the most recent and most relevant summaries of past conversations. Only entries the live history hasn't seen yet are added, so the prompt prefix stays stable and the prompt cache keeps working. After the reply, a separate call returns memory operations (upsert or delete) that the server applies. Memories are kept one per subject, with absolute dates and a dated history when something changes. Every assistant message stores its raw response items, which are replayed on later turns. When the context passes 100k tokens, the oldest half of the live messages is summarized into a past conversation and leaves the replayed history. Each archived exchange is also indexed for `recall`, by embedding and by keyword. [`ARCHITECTURE.md`](ARCHITECTURE.md) shows the full flow.

## Setup

You need [Bun](https://bun.sh), Node 26, and the Codex CLI logged in with ChatGPT (`codex login`). The server reads the tokens from `~/.codex/auth.json` (or `$CODEX_HOME/auth.json`) and writes refreshed tokens back to it. The endpoint is undocumented, so an OpenAI change can break it. The chat reply uses the model and reasoning effort picked in the composer; curation and summaries use `gpt-6-luna` at `low`. Embeddings use OpenRouter: copy [`.env.example`](../.env.example) to `.env` and set `OPENROUTER_API_KEY`.

```sh
bun install
bun run dev
```

Retrieval and ranking settings are in [`config.ts`](../src/features/memories/server/config.ts). Data lives in `.memori/memori.db`. `bun run check` formats, lints, and type checks.
