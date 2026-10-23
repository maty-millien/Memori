# AGENTS.md

## Description

Remanence is a local research app for long-term agent memory, built around a single endless chat. The server runs the agent loop with the AI SDK against the Codex Responses endpoint, using the Codex CLI login. Each turn injects relevant memories and past conversations, a separate call curates the memories afterwards, and old messages are compacted once the context grows too large. The agent can also write first through scheduled wakeups. `docs/README.md` describes the full flow of a turn.

## Project rules

- You can start a dev server but always stop it at the end of your turn, and also use a different port to avoid conflicts.
- Run `bun run ci` after every edit.
- Do not write comments in the code.

## Structure

- `src/routes/`: TanStack Start file routes. Keep them thin: a loader, the page component, and API handlers that validate input and call feature code.
- `src/features/chat/`: the chat page (`ui/`) and the agent turn (`server/`).
- `src/features/memories/`: the memories dialog (`ui/`) and the memory pipeline (`server/`): retrieval, curation, past conversations, embeddings, prompt formatting, and ranking settings in `config.ts`.
- `src/shared/`: code used by both features only. `ui/` holds shadcn components, `lib/` holds types and helpers that run in the browser and on the server, `server/` holds the database, the Codex client, and uploads.

Dependencies point one way: routes -> features -> shared. `features/chat` may import `features/memories`, never the reverse.

Browser code reaches server code (`server/` folders, `node:` imports) only through the `createServerFn` exports in `functions.ts` files or through route `server.handlers`. `ui/` files never import any other server module.

## Keeping the codebase small

- Put new code in the feature that uses it. Move it to `shared/` only when a second feature needs it, and move it back when only one feature is left.
- Don't create a file for something with a single caller. Keep small components, helpers, and constants in the file that uses them, and split a file only when it holds unrelated things.
- Before writing a helper, check `shared/lib/remanence.ts`, `shared/lib/format.ts`, the standard library, and installed dependencies.
- Don't add interfaces, wrappers, options, or config for a single implementation or a value that never changes. Don't define a type that renames the fields of another type; derive it with `Pick`, `Omit`, or `z.infer`.
- Don't add fallbacks for data shapes or cases that can't occur. When you change a stored data shape, update the type and remove the old handling.
- When a change leaves code, props, exports, files, dependencies, or config unused, delete it in the same change. Move deleted files to the Trash with `trash`, and trash a folder once it's empty.
- Only add shadcn components with `bunx shadcn add`, and only when a page uses them.
