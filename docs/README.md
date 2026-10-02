# Memori

A local research app for long-term agent memory. Every chat turn shows what the memory layer did: the memories it retrieved and how they scored, the prompt sent to the model, the reasoning, and each memory tool call.

Each turn retrieves ranked memories and past conversation summaries, the chat model replies without tools, then a separate call curates memories with `memory_upsert` and `memory_delete`. "New chat" summarizes the session into a conversation memory.

## Setup

You need [Bun](https://bun.sh), Node 26, and a Codex login. Chat, curation, and summaries use `gpt-6-luna` through the Codex backend with your `~/.codex/auth.json` token (run `codex login` if it expires). Embeddings use OpenRouter: copy [`.env.example`](../.env.example) to `.env` and set `OPENROUTER_API_KEY`.

```sh
bun install
bun run dev
```

Retrieval and ranking settings are in [`config.ts`](../src/server/memori/config.ts). Data lives in `.memori/memori.db`. `bun run check` formats, lints, and type checks.
