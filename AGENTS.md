# AGENTS.md

## Description

Memori is a local research app for long-term agent memory. There is a single endless chat. The server runs its own agent loop against the Codex Responses endpoint (`chatgpt.com/backend-api/codex/responses`) with the Codex CLI login, and gives the model a `shell` tool plus the hosted `web_search` tool. Each turn retrieves ranked memories and episode summaries and injects only the ones the thread has not seen. A separate Codex call returns memory operations (upsert or delete) that the server applies. When the context passes 100k tokens, the oldest half of the live messages is summarized into an episode (a conversation memory), and later turns send only the stored response items of the remaining live messages. An info icon under each reply opens a debug dialog with the full trace of the turn.

## Project rules

- Never start a development server unless the user asks for it.
- Run `bun run ci` after every edit.
- Do not write comments in the code.
