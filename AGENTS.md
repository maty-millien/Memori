# AGENTS.md

## Description

Memori is a local research app for long-term agent memory. There is a single endless chat. Each turn retrieves ranked memories and episode summaries, the chat model replies without tools, then a separate curation call manages memories with `memory_upsert` and `memory_delete`. When a turn uses more than half the context window, the oldest half of the live messages is summarized into an episode (a conversation memory) and leaves the model's history. An info icon under each reply opens a debug dialog with the full trace of the turn.

## Project rules

- Never start a development server unless the user asks for it.
- Run `bun run ci` after every edit.
- Do not write comments in the code.
