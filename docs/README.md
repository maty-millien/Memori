# Memori

A local research app for long-term agent memory. Every chat turn shows what the memory layer did: the memories it retrieved and how they scored, the prompt sent to the model, the reasoning, and each memory tool call.

There is a single endless chat. Each turn retrieves ranked memories and episode summaries, the chat model replies without tools, then a separate call curates memories with `memory_upsert` and `memory_delete`. When a turn uses more than half the context window, the oldest half of the live messages is summarized into an episode and leaves the model's history, so the chat never runs out of context. A memory created or updated during a turn that is still in the live history is left out of the chat's retrieval, since the model already sees that turn; curation still receives it to avoid duplicates.

## Setup

You need [Bun](https://bun.sh), Node 26, and a Codex login. All LLM calls go through the Codex backend with your `~/.codex/auth.json` token (run `codex login` if it expires). The chat reply uses the model and reasoning effort picked in the composer; curation and summaries use `gpt-6-luna` at `low`. Embeddings use OpenRouter: copy [`.env.example`](../.env.example) to `.env` and set `OPENROUTER_API_KEY`.

The composer accepts image and PDF attachments up to 20 MB. The chat model sees them until their messages are summarized into an episode; curation, summaries, and retrieval only see the filenames.

```sh
bun install
bun run dev
```

Retrieval and ranking settings are in [`config.ts`](../src/server/memori/config.ts). Data lives in `.memori/memori.db` and attachments in `.memori/uploads`. `bun run check` formats, lints, and type checks.
