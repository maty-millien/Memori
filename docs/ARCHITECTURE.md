# How Remanence works

One chat turn, from the user's message to compaction. Each step names the tables it reads or writes.

```mermaid
---
config:
  flowchart:
    wrappingWidth: 400
---
flowchart TB
    start(["<b>User sends a message</b>"]) --> wait["<b>Prepare</b><br/>Wait for the previous turn's curation and compaction<br/>Load the live messages, the model and the effort<br/><i>reads messages, settings</i>"]
    wait --> retrieval

    subgraph retrieval ["<b>1. Retrieval</b>"]
        direction LR
        query["<b>Build the query</b><br/>Last 500 characters of each<br/>of the last 2 messages<br/>+ the new message"] --> embedQuery["<b>Embed the query</b><br/>voyage-4-large<br/>through OpenRouter"]
        embedQuery --> rankMemories["<b>Rank memories</b><br/>similarity 0.7 + importance 0.2 + recency 0.07<br/>+ usage 0.03 + global 0.1<br/>Keep the top 50 and bump their access count<br/>Skip those updated during the live thread<br/><i>reads and writes memories</i>"]
        embedQuery --> pickConversations["<b>Pick past conversations</b><br/>10 latest by end date<br/>+ 10 closest to the query among the others<br/><i>reads conversations</i>"]
    end

    retrieval --> prompt

    subgraph prompt ["<b>2. Prompt</b>"]
        direction LR
        dedup["<b>Deduplicate</b><br/>Drop what the live thread has already seen<br/>An edited memory counts as new"] --> blocks["<b>Prompt blocks</b><br/>latest_conversations<br/>relevant_conversations<br/>relevant_memories<br/>user_message with datetime and timezone"]
    end

    prompt --> agent

    subgraph agent ["<b>3. Agent loop</b>"]
        direction LR
        input["<b>Model input</b><br/>Static instructions<br/>+ stored items of the live replies,<br/>reasoning and tool outputs included<br/>+ the new prompt<br/>Sent stateless, store: false<br/><i>reads thread_items</i>"] --> codex["<b>Codex Responses</b><br/>One tool call at a time"]
        codex <-->|tool call| tools["<b>Tools</b><br/>shell, read, patch<br/>question: waits for the user's answer<br/>web_search: hosted by OpenAI"]
        codex <-->|tool call| recall["<b>recall</b><br/>Top 20 by meaning + top 20 by keywords<br/>fused by rank, keep 5<br/><i>reads archived_turns + FTS5 index</i>"]
        codex -->|user steers: added<br/>before the next call| codex
        codex -->|user stops| stopped["<b>Stopped</b><br/>Save the partial turn with a stop note<br/>Skip curation and compaction"]
        codex -->|final reply| stream["<b>Stream</b><br/>Send the reply to the UI"]
        stream --> save["<b>Save</b><br/>User message, reply with its trace,<br/>and the reply's raw items<br/><i>writes messages, thread_items</i>"]
    end

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

    class start,wait,trace,next endpoint
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

## Memory layers

| Layer                           | Table                      | Reaches the model                                         |
| ------------------------------- | -------------------------- | --------------------------------------------------------- |
| Durable facts                   | `memories`                 | Injected automatically when relevant and not already seen |
| Summaries of archived stretches | `conversations`            | Injected automatically, latest or relevant ones           |
| Archived exchanges              | `archived_turns`           | Only when the model calls `recall`                        |
| Full original history           | `messages`, `thread_items` | Live part replayed every turn, archived part never read   |
