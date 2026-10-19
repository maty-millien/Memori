# How Memori works

One chat turn, from the user's message to compaction. Each step names the tables it reads or writes.

```mermaid
---
config:
  flowchart:
    wrappingWidth: 400
---
flowchart TB
    start(["User sends a message"]) --> wait["Wait for the previous turn's curation and compaction<br/>then load the live messages<br/><i>reads messages</i>"]
    wait --> retrieval

    subgraph retrieval ["1. Retrieval"]
        direction LR
        query["Query: tail of the last 2 messages<br/>+ the new message"] --> embedQuery["Embed the query"]
        embedQuery --> rankMemories["Rank all memories<br/>meaning 0.7 + importance 0.2 + recency 0.07<br/>+ usage 0.03 + global 0.1<br/>top 50, skip those updated during the live thread<br/><i>reads memories</i>"]
        embedQuery --> pickConversations["10 latest + 10 most relevant<br/>past conversation summaries<br/><i>reads conversations</i>"]
    end

    retrieval --> prompt

    subgraph prompt ["2. Prompt"]
        direction LR
        dedup["Drop what the live thread<br/>has already seen"] --> blocks["latest_conversations<br/>relevant_conversations<br/>relevant_memories<br/>user_message with datetime and timezone"]
    end

    prompt --> agent

    subgraph agent ["3. Agent loop"]
        direction LR
        input["Static instructions<br/>+ live thread items, tool outputs included<br/>+ the new prompt<br/><i>reads thread_items</i>"] --> codex["Codex Responses"]
        codex <-->|tool call| tools["shell, read, patch,<br/>question, web_search"]
        codex <-->|tool call| recall["recall: semantic + keyword<br/>search, fused by rank<br/><i>reads archived_turns</i>"]
        codex -->|user steers mid-turn| codex
        codex -->|final reply| stream["Stream the reply to the UI"]
        stream --> save["Save the messages and raw thread items<br/><i>writes messages, thread_items</i>"]
    end

    agent --> curation

    subgraph curation ["4. Curation, in the background"]
        direction LR
        curationInput["Up to 50 retrieved memories<br/>+ memories from the live thread<br/>+ 3 previous messages<br/>+ the full latest turn"] --> curationCall["Codex returns operations"]
        curationCall --> operations["upsert: create, merge, keep dated history<br/>delete: forget request, merged duplicate"]
        operations --> embedMemory["Embed each new content<br/><i>writes memories</i>"]
    end

    curation --> overflow{"Context over<br/>100k tokens?"}
    overflow -->|no| next(["Ready for the next message"])
    overflow -->|yes| compaction

    subgraph compaction ["5. Compaction"]
        direction LR
        oldest["Oldest half of the live thread,<br/>cut before a user message"] --> summarize["Codex summary, 300 words max<br/><i>writes conversations</i>"]
        oldest --> turns["One transcript per exchange, embedded<br/><i>writes archived_turns + FTS5 index</i>"]
        oldest --> assign["Tag the messages with the conversation id,<br/>they leave the live thread<br/><i>writes messages</i>"]
    end

    compaction --> next

    classDef endpoint fill:#f3f4f6,stroke:#6b7280,color:#111827
    classDef retrievalNode fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
    classDef promptNode fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
    classDef agentNode fill:#fef3c7,stroke:#d97706,color:#78350f
    classDef curationNode fill:#dcfce7,stroke:#16a34a,color:#14532d
    classDef compactionNode fill:#ffe4e6,stroke:#e11d48,color:#881337
    classDef decision fill:#fef9c3,stroke:#ca8a04,color:#713f12

    class start,wait,next endpoint
    class query,embedQuery,rankMemories,pickConversations retrievalNode
    class dedup,blocks promptNode
    class input,codex,tools,recall,stream,save agentNode
    class curationInput,curationCall,operations,embedMemory curationNode
    class oldest,summarize,turns,assign compactionNode
    class overflow decision

    style retrieval fill:#eff6ff,stroke:#2563eb,color:#1e3a8a
    style prompt fill:#f5f3ff,stroke:#7c3aed,color:#4c1d95
    style agent fill:#fffbeb,stroke:#d97706,color:#78350f
    style curation fill:#f0fdf4,stroke:#16a34a,color:#14532d
    style compaction fill:#fff1f2,stroke:#e11d48,color:#881337
```

## Memory layers

| Layer                           | Table                      | Reaches the model                                         |
| ------------------------------- | -------------------------- | --------------------------------------------------------- |
| Durable facts                   | `memories`                 | Injected automatically when relevant and not already seen |
| Summaries of archived stretches | `conversations`            | Injected automatically, latest or relevant ones           |
| Archived exchanges              | `archived_turns`           | Only when the model calls `recall`                        |
| Full original history           | `messages`, `thread_items` | Live part replayed every turn, archived part never read   |
