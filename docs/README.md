# Memori

A local research app for long-term agent memory. Every chat turn shows what the memory layer did: the memories it retrieved and how they scored, the prompt sent to the model, the reasoning, and each memory change.

There is a single endless chat. The server runs its own agent loop against the Codex Responses endpoint (`chatgpt.com/backend-api/codex/responses`), the same one the Codex CLI uses, with `store: false`, so every call sends the whole live history. The model gets two tools: `shell`, which runs any zsh command on your Mac, and the hosted `web_search`, which OpenAI runs server-side. The chat shows each step and streams the reply. Each turn retrieves ranked memories and episode summaries and adds only the ones the model has not seen yet, so the prompt prefix stays stable and the prompt cache keeps working. A separate call then returns memory operations (upsert or delete) that the server applies. Every assistant message stores its raw response items (messages, reasoning, tool calls, and outputs), which are replayed on later turns. When the context passes 100k tokens, the oldest half of the live messages is summarized into an episode and leaves the replayed history. A memory created or updated during a turn that is still in the live history is left out of the chat's retrieval, since the model already sees that turn; curation still receives it to avoid duplicates.

## Setup

You need [Bun](https://bun.sh), Node 26, and the Codex CLI logged in with ChatGPT (`codex login`). The server reads the tokens from `~/.codex/auth.json` (or `$CODEX_HOME/auth.json`) and writes refreshed tokens back to it. The endpoint is undocumented, so an OpenAI change can break it. The chat reply uses the model and reasoning effort picked in the composer; curation and summaries use `gpt-6-luna` at `low`. Embeddings use OpenRouter: copy [`.env.example`](../.env.example) to `.env` and set `OPENROUTER_API_KEY`.

The composer accepts image and PDF attachments up to 20 MB. Images of the current message are attached to the model call; every attachment is listed with its path on disk, so the model can open it with `shell`.

```sh
bun install
bun run dev
```

Retrieval and ranking settings are in [`config.ts`](../src/server/memori/config.ts). Data lives in `.memori/memori.db` and attachments in `.memori/uploads`. `bun run check` formats, lints, and type checks.
