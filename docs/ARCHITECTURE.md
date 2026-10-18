# How Memori works

One chat turn, from the user's message to compaction. Tables are drawn as cylinders.

```mermaid
flowchart TD
    start(["User sends a message"]) --> wait["Wait for the previous turn's curation and compaction"]
    wait --> live["Load the live messages"]

    subgraph retrieval ["1. Retrieval"]
        query["Query: tail of the last 2 messages + the new message"] --> embedQuery["Embed the query"]
        embedQuery --> rankMemories["Memories: 40 nearest + all global ones<br/>score = meaning 0.7 + importance 0.2 + recency 0.07 + usage 0.03 + global 0.1<br/>keep the top 20, skip memories updated during the live thread"]
        embedQuery --> pickConversations["Past conversations: 10 most recent + 10 most similar summaries"]
    end

    live --> query

    subgraph prompt ["2. Prompt"]
        dedup["Drop what the live thread has already seen"] --> blocks["recent_conversations<br/>similar_conversations<br/>relevant_memories<br/>removed_memories<br/>message_metadata<br/>user message"]
    end

    rankMemories --> dedup
    pickConversations --> dedup

    subgraph agent ["3. Agent loop"]
        input["Static instructions<br/>+ live thread items, old tool outputs elided in batches of 5<br/>+ the new prompt"] --> codex["Codex Responses"]
        codex -->|tool call| tools["shell, read, patch, question, web_search"]
        codex -->|tool call| recall["recall: semantic + keyword search, fused by rank"]
        tools --> codex
        recall --> codex
        codex -->|user steers mid-turn| codex
        codex -->|final reply| stream["Stream the reply to the UI"]
    end

    blocks --> input

    stream --> save["Save the messages and the raw thread items"]

    subgraph curation ["4. Curation, in the background"]
        curationInput["20 retrieved memories + memories from the live thread<br/>+ 3 previous messages + the full latest turn"] --> curationCall["Codex returns operations"]
        curationCall --> operations["upsert: create, merge, keep dated history<br/>delete: forget request, merged duplicate"]
        operations --> embedMemory["Embed each new content"]
    end

    save --> curationInput

    embedMemory --> overflow{"Context over 100k tokens?"}
    overflow -->|no| next(["Ready for the next message"])

    subgraph compaction ["5. Compaction"]
        oldest["Oldest half of the live thread, cut before a user message"] --> summarize["Codex summary, 300 words max"]
        oldest --> turns["One transcript per exchange, embedded"]
        oldest --> assign["Tag the messages with the conversation id, they leave the live thread"]
    end

    overflow -->|yes| oldest
    assign --> next

    memoriesTable[("memories")]
    conversationsTable[("conversations")]
    archivedTable[("archived_turns + FTS5 index")]
    messagesTable[("messages")]
    itemsTable[("thread_items")]

    memoriesTable -.-> rankMemories
    conversationsTable -.-> pickConversations
    archivedTable -.-> recall
    messagesTable -.-> live
    itemsTable -.-> input
    save -.-> messagesTable
    save -.-> itemsTable
    embedMemory -.-> memoriesTable
    summarize -.-> conversationsTable
    turns -.-> archivedTable
    assign -.-> messagesTable
```

## Memory layers

| Layer                           | Table                      | Reaches the model                                         |
| ------------------------------- | -------------------------- | --------------------------------------------------------- |
| Durable facts                   | `memories`                 | Injected automatically when relevant and not already seen |
| Summaries of archived stretches | `conversations`            | Injected automatically, recent or similar ones            |
| Archived exchanges              | `archived_turns`           | Only when the model calls `recall`                        |
| Full original history           | `messages`, `thread_items` | Live part replayed every turn, archived part never read   |
