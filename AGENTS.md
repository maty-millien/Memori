# AGENTS.md

## Description

Memori is a local research app for long-term agent memory. There is a single endless chat. The chat is backed by one Codex thread through `codex app-server` (isolated `CODEX_HOME` in `.memori/codex`), which can run commands on the Mac and search the web. Each turn retrieves ranked memories and episode summaries and injects only the ones the thread has not seen. A separate Codex call returns memory operations (upsert or delete) that the server applies. When the context uses more than half the window, the oldest half of the live messages is summarized into an episode (a conversation memory), and the next turn starts a new thread seeded with the raw Codex items of the remaining live messages. An info icon under each reply opens a debug dialog with the full trace of the turn.

## Project rules

- Never start a development server unless the user asks for it.
- Run `bun run ci` after every edit.
- Do not write comments in the code.
