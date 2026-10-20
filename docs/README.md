<p align="center">
  <img src="../public/favicon.svg" alt="" width="72">
</p>

<h1 align="center">Remanence</h1>

<p align="center">A personal AI agent with one chat that never resets.</p>

<p align="center">
  <img src="screenshot.png" alt="The Remanence chat, with the agent's steps above its reply">
</p>

Remanence remembers what matters about you and your work from one turn to the next, and can search everything that has left its context. It's also a research app for agent memory: the info icon under each reply opens the full trace of the turn, with the memories retrieved and their scores, the prompt sent to the model, the reasoning, and every memory change.

## How it remembers

- **Memories.** After each reply, a separate model call decides what to save, update, or forget. Each memory covers one subject, with absolute dates and a dated history when something changes.
- **Retrieval.** Each turn ranks every memory against the latest exchange and adds the top 50 the chat hasn't seen yet. The prompt prefix stays stable, so the prompt cache keeps working.
- **Compaction.** When the context passes 100k tokens, the oldest half of the chat is summarized into a past conversation. Recent and relevant summaries come back on later turns.
- **Recall.** Archived exchanges are indexed by embedding and by keyword, and the model searches them with the `recall` tool.

The full flow of a turn, with the tables each step reads or writes. A wakeup runs the same turn without a user message: the model writes first, or answers `SILENT` to say nothing, and curation is skipped.

```mermaid
---
config:
  flowchart:
    wrappingWidth: 400
---
flowchart TB
    start(["<b>User sends a message</b><br/>Cancels a running wakeup turn"]) --> wait["<b>Prepare</b><br/>Wait for the previous turn's curation and compaction<br/>Load the live messages, the model and the effort<br/><i>reads messages, settings</i>"]
    wakeup(["<b>A wakeup comes due</b><br/>Checked every minute when no turn is running<br/><i>reads wakeups</i>"]) --> wait
    wait --> retrieval

    subgraph retrieval ["<b>1. Retrieval</b>"]
        direction LR
        query["<b>Build the query</b><br/>Last 500 characters of each<br/>of the last 2 messages<br/>+ the new message"] --> embedQuery["<b>Embed the query</b><br/>EmbeddingGemma 300m<br/>locally"]
        embedQuery --> rankMemories["<b>Rank memories</b><br/>similarity 0.7 + importance 0.2 + recency 0.07<br/>+ usage 0.03 + global 0.1<br/>Keep the top 50 and bump their access count<br/>Skip those updated during the live thread<br/><i>reads and writes memories</i>"]
        embedQuery --> pickConversations["<b>Pick past conversations</b><br/>10 latest by end date<br/>+ 10 closest to the query among the others<br/><i>reads conversations</i>"]
    end

    retrieval --> prompt

    subgraph prompt ["<b>2. Prompt</b>"]
        direction LR
        dedup["<b>Deduplicate</b><br/>Drop what the live thread has already seen<br/>An edited memory counts as new"] --> blocks["<b>Prompt blocks</b><br/>latest_conversations<br/>relevant_conversations<br/>relevant_memories<br/>user_message or wakeup, with datetime and timezone"]
    end

    prompt --> agent

    subgraph agent ["<b>3. Agent loop</b>"]
        direction LR
        input["<b>Model input</b><br/>Static instructions<br/>+ stored items of the live replies,<br/>reasoning and tool outputs included<br/>+ the new prompt<br/>Sent stateless, store: false<br/><i>reads thread_items</i>"] --> codex["<b>Codex Responses</b><br/>One tool call at a time"]
        codex <-->|tool call| tools["<b>Tools</b><br/>shell, read, patch<br/>question: waits for the user's answer, not on wakeups<br/>schedule: plans a wakeup <i>writes wakeups</i><br/>web_search: hosted by OpenAI"]
        codex <-->|tool call| recall["<b>recall</b><br/>Top 20 by meaning + top 20 by keywords<br/>fused by rank, keep 5<br/><i>reads archived_turns + FTS5 index</i>"]
        codex -->|user steers: added<br/>before the next call| codex
        codex -->|user stops| stopped["<b>Stopped</b><br/>Save the partial turn with a stop note<br/>Skip curation and compaction"]
        codex -->|final reply| stream["<b>Stream</b><br/>Send the reply to the UI"]
        stream --> save["<b>Save</b><br/>Delete the wakeup, move the check-in 6 hours out<br/>Drop a SILENT wakeup reply<br/>Otherwise save the user message, reply with its trace,<br/>and the reply's raw items<br/>Tell open tabs about a wakeup reply<br/><i>writes wakeups, messages, thread_items</i>"]
    end

    agent -->|wakeup reply| overflow
    agent --> curation

    subgraph curation ["<b>4. Curation, in the background</b>"]
        direction LR
        curationInput["<b>Curation input</b><br/>Up to 50 retrieved memories<br/>+ memories from the live thread<br/>+ 2 previous messages<br/>+ the full latest turn"] --> curationCall["<b>Codex call</b><br/>Returns memory operations<br/>as structured JSON"]
        curationCall --> operations["<b>Apply operations</b><br/>upsert new: create with scope and importance<br/>upsert by id: rewrite content and importance,<br/>merge, keep dated history<br/>delete: forget request, merged duplicate"]
        operations --> embedMemory["<b>Embed</b><br/>Each new or changed content<br/><i>writes memories</i>"]
    end

    curation --> overflow{"<b>Last call over<br/>100k tokens?</b>"}
    overflow -->|no| trace
    overflow -->|yes| compaction

    subgraph compaction ["<b>5. Compaction, in the background</b>"]
        direction LR
        oldest["<b>Split</b><br/>Live messages before this turn,<br/>weighted by stored item size<br/>Take the oldest half,<br/>cut before a user message"] --> summarize["<b>Summarize</b><br/>Codex summary, 300 words max<br/>Goals, decisions, artifacts,<br/>failed attempts, open items<br/>Embedded<br/><i>writes conversations</i>"]
        oldest --> turns["<b>Archive exchanges</b><br/>One transcript per user message<br/>and its replies, embedded<br/><i>writes archived_turns + FTS5 index</i>"]
        oldest --> assign["<b>Retire messages</b><br/>Tag them with the conversation id,<br/>they leave the live thread<br/><i>writes messages</i>"]
    end

    compaction --> trace["<b>Complete the trace</b><br/>Curation operations, compaction,<br/>curation usage, errors<br/><i>writes messages</i>"]
    trace --> next(["<b>Ready for the next message</b>"])

    classDef endpoint fill:#6b728033,stroke:#6b7280,stroke-width:2px
    classDef retrievalNode fill:#3b82f633,stroke:#3b82f6,stroke-width:2px
    classDef promptNode fill:#8b5cf633,stroke:#8b5cf6,stroke-width:2px
    classDef agentNode fill:#f59e0b33,stroke:#f59e0b,stroke-width:2px
    classDef curationNode fill:#22c55e33,stroke:#22c55e,stroke-width:2px
    classDef compactionNode fill:#f43f5e33,stroke:#f43f5e,stroke-width:2px
    classDef decision fill:#eab30833,stroke:#eab308,stroke-width:2px

    class start,wakeup,wait,trace,next endpoint
    class query,embedQuery,rankMemories,pickConversations retrievalNode
    class dedup,blocks promptNode
    class input,codex,tools,recall,stopped,stream,save agentNode
    class curationInput,curationCall,operations,embedMemory curationNode
    class oldest,summarize,turns,assign compactionNode
    class overflow decision

    style retrieval fill:#3b82f612,stroke:#3b82f6
    style prompt fill:#8b5cf612,stroke:#8b5cf6
    style agent fill:#f59e0b12,stroke:#f59e0b
    style curation fill:#22c55e12,stroke:#22c55e
    style compaction fill:#f43f5e12,stroke:#f43f5e
```

## What the agent can do

The agent works on the machine running the server, your computer or a remote one. It can run commands in your `$SHELL`, read files, images, and PDFs, edit files, ask you to choose or confirm something, search the archive with `recall`, and search the web.

It also writes first, like a personal assistant. When you mention an appointment, a trip, or a deadline, it schedules a moment to ask how it went or to remind you, without being asked. After 6 quiet hours it checks in, and stays silent unless it has something worth saying. These messages are saved to the chat and show up live if the tab is open. They only go out while the server is running.

## Getting started

You need [Bun](https://bun.sh), Node 26, and the [Codex CLI](https://github.com/openai/codex) logged in with ChatGPT. Embeddings run locally with [EmbeddingGemma](https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX), downloaded (about 1.2 GB) on first use.

```sh
codex login
bun install
bun run dev
```

<details>
<summary>More details</summary>

<br>

The server runs its own agent loop against the Codex Responses endpoint (`chatgpt.com/backend-api/codex/responses`), the same one the Codex CLI uses, with `store: false`. It reads the tokens from `~/.codex/auth.json` (or `$CODEX_HOME/auth.json`) and writes refreshed tokens back to it. The endpoint is undocumented, so an OpenAI change can break it.

The chat reply uses the model and reasoning effort picked in the composer. Curation and summaries use `gpt-6-luna` at `low`. Retrieval and ranking settings are in [`config.ts`](../src/features/memories/server/config.ts), and data lives in `.remanence/remanence.db`. `bun run check` formats, lints, and type checks.

</details>
