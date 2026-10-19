# How Memori works

One chat turn, from the user's message to compaction. Each step names the tables it reads or writes.

```mermaid
---
config:
  flowchart:
    wrappingWidth: 400
---
flowchart TB
    start(["<b>User sends a message</b>"]) --> wait["<b>Prepare</b><br/>Wait for the previous turn's curation and compaction<br/>Load the live messages<br/><i>reads messages</i>"]
    wait --> retrieval

    subgraph retrieval ["<b>1. Retrieval</b>"]
        direction LR
        query["<b>Build the query</b><br/>Tail of the last 2 messages<br/>+ the new message"] --> embedQuery["<b>Embed the query</b>"]
        embedQuery --> rankMemories["<b>Rank memories</b><br/>similarity 0.7 + importance 0.2 + recency 0.07<br/>+ usage 0.03 + global 0.1<br/>Keep the top 50<br/>skip those updated during the live thread<br/><i>reads memories</i>"]
        embedQuery --> pickConversations["<b>Pick past conversations</b><br/>10 latest + 10 most relevant summaries<br/><i>reads conversations</i>"]
    end

    retrieval --> prompt

    subgraph prompt ["<b>2. Prompt</b>"]
        direction LR
        dedup["<b>Deduplicate</b><br/>Drop what the live thread<br/>has already seen"] --> blocks["<b>Prompt blocks</b><br/>latest_conversations<br/>relevant_conversations<br/>relevant_memories<br/>user_message with datetime and timezone"]
    end

    prompt --> agent

    subgraph agent ["<b>3. Agent loop</b>"]
        direction LR
        input["<b>Model input</b><br/>Static instructions<br/>+ live thread items, tool outputs included<br/>+ the new prompt<br/><i>reads thread_items</i>"] --> codex["<b>Codex Responses</b>"]
        codex <-->|tool call| tools["<b>Tools</b><br/>shell, read, patch,<br/>question, web_search"]
        codex <-->|tool call| recall["<b>recall</b><br/>Semantic + keyword search,<br/>fused by rank<br/><i>reads archived_turns</i>"]
        codex -->|user steers mid-turn| codex
        codex -->|final reply| stream["<b>Stream</b><br/>Send the reply to the UI"]
        stream --> save["<b>Save</b><br/>Messages and raw thread items<br/><i>writes messages, thread_items</i>"]
    end

    agent --> curation

    subgraph curation ["<b>4. Curation, in the background</b>"]
        direction LR
        curationInput["<b>Curation input</b><br/>Up to 50 retrieved memories<br/>+ memories from the live thread<br/>+ 2 previous messages<br/>+ the full latest turn"] --> curationCall["<b>Codex call</b><br/>Returns memory operations"]
        curationCall --> operations["<b>Apply operations</b><br/>upsert: create, merge, keep dated history<br/>delete: forget request, merged duplicate"]
        operations --> embedMemory["<b>Embed</b><br/>Each new content<br/><i>writes memories</i>"]
    end

    curation --> overflow{"<b>Context over<br/>100k tokens?</b>"}
    overflow -->|no| next(["<b>Ready for the next message</b>"])
    overflow -->|yes| compaction

    subgraph compaction ["<b>5. Compaction</b>"]
        direction LR
        oldest["<b>Split</b><br/>Oldest half of the live thread,<br/>cut before a user message"] --> summarize["<b>Summarize</b><br/>Codex summary, 300 words max<br/><i>writes conversations</i>"]
        oldest --> turns["<b>Archive exchanges</b><br/>One transcript per exchange, embedded<br/><i>writes archived_turns + FTS5 index</i>"]
        oldest --> assign["<b>Retire messages</b><br/>Tag them with the conversation id,<br/>they leave the live thread<br/><i>writes messages</i>"]
    end

    compaction --> next

    classDef endpoint fill:#6b728033,stroke:#6b7280,stroke-width:2px
    classDef retrievalNode fill:#3b82f633,stroke:#3b82f6,stroke-width:2px
    classDef promptNode fill:#8b5cf633,stroke:#8b5cf6,stroke-width:2px
    classDef agentNode fill:#f59e0b33,stroke:#f59e0b,stroke-width:2px
    classDef curationNode fill:#22c55e33,stroke:#22c55e,stroke-width:2px
    classDef compactionNode fill:#f43f5e33,stroke:#f43f5e,stroke-width:2px
    classDef decision fill:#eab30833,stroke:#eab308,stroke-width:2px

    class start,wait,next endpoint
    class query,embedQuery,rankMemories,pickConversations retrievalNode
    class dedup,blocks promptNode
    class input,codex,tools,recall,stream,save agentNode
    class curationInput,curationCall,operations,embedMemory curationNode
    class oldest,summarize,turns,assign compactionNode
    class overflow decision

    style retrieval fill:#3b82f612,stroke:#3b82f6
    style prompt fill:#8b5cf612,stroke:#8b5cf6
    style agent fill:#f59e0b12,stroke:#f59e0b
    style curation fill:#22c55e12,stroke:#22c55e
    style compaction fill:#f43f5e12,stroke:#f43f5e
```

## Memory layers

| Layer                           | Table                      | Reaches the model                                         |
| ------------------------------- | -------------------------- | --------------------------------------------------------- |
| Durable facts                   | `memories`                 | Injected automatically when relevant and not already seen |
| Summaries of archived stretches | `conversations`            | Injected automatically, latest or relevant ones           |
| Archived exchanges              | `archived_turns`           | Only when the model calls `recall`                        |
| Full original history           | `messages`, `thread_items` | Live part replayed every turn, archived part never read   |
