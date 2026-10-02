# AGENTS.md

## Description

Memori is a local research app for long-term agent memory. There is a single endless chat. Each turn retrieves ranked memories and episode summaries, the chat model replies without tools, then a separate curation call manages memories with `memory_upsert` and `memory_delete`. When a turn uses more than half the context window, the oldest half of the live messages is summarized into an episode (a conversation memory) and leaves the model's history. An info icon under each reply opens a debug dialog with the full trace of the turn.

## Commands

```bash
bun run dev     # Start the app on http://localhost:5173
bun run check   # Format, lint, and type check
bun run ci      # Check and build in parallel
```

## Stack

- **Toolchain:** Vite+ (Vite, Oxlint, Oxfmt, and type checking)
- **Application:** React, TanStack Start (server routes and server functions)
- **LLM:** AI SDK with `@ai-sdk/openai` pointed at the Codex backend. Chat, curation, and summaries are `ToolLoopAgent`s in `src/server/memori/agents.ts`. The chat reply uses the model and reasoning effort picked in the composer (stored in the SQLite `settings` table); curation and summaries use `gpt-6-luna` at `low` effort
- **Embeddings:** AI SDK `embed` with `@ai-sdk/openai` pointed at OpenRouter
- **Storage:** `node:sqlite` in `.memori/memori.db`, brute-force cosine similarity in JS. Image and PDF attachments are saved in `.memori/uploads` and served by `/api/uploads/$name`
- **Styling:** Tailwind CSS, `@tailwindcss/typography`, Geist font, visual style copied from [Zola](https://github.com/ibelick/zola)
- **Markdown:** `react-markdown` with `remark-gfm`
- **UI:** Shadcn (`base-vega`, Base UI), Tabler Icons
- **Package manager:** Bun

## Layout

```
src/
  routes/            TanStack routes, including the /api/chat server route
  server/functions.ts server functions used by routes
  server/memori/     codex provider, agents, config, db, embeddings, retrieval, prompts, chat pipeline, curation tools, episodes
  pages/             chat and memories pages
  shared/components/ app components and shadcn components in ui/
  shared/lib/        shared types (memori.ts), formatting, utils
```

## Project rules

- Never start a development server unless the user asks for it.
- Run `bun run check` after every edit.
- Do not write comments in the code.
- Build UI from shadcn components in `@/shared/components/ui` and match Zola's look (rounded composer, pill user bubbles, prose replies, discreet info icon under replies) with `className` in app components. Add components with `bunx shadcn add` and do not edit them; they are excluded from lint.
- Use `cn` from `@/shared/lib/utils`, which re-exports shadcn's `cn` package.
- Define LLM calls as `ToolLoopAgent`s in `src/server/memori/agents.ts` and call them with `stream()`, because the Codex backend rejects non-streaming requests.
- `.env` holds only `OPENROUTER_API_KEY`. All other settings (embedding model, retrieval limits, ranking weights) are constants in `src/server/memori/config.ts`.
- Use lowercase kebab-case for all files and directories.
- Keep this file and `docs/README.md` up to date whenever a change affects the commands, stack, rules, or project context.
