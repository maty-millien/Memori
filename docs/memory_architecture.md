# Memori Memory Architecture

## Goal

Memori is a prototype memory layer for LLM conversations. The goal is to let an assistant preserve useful information across fresh-context chats while avoiding noisy, duplicated, stale, or unverifiable memories.

The system should support long-running interaction continuity for:

- stable user preferences
- project facts and decisions
- deferred tasks
- evolving or contradictory information
- explainable retrieval

The benchmark should test the memory system as a full loop, not just isolated model behavior.

## Core Direction

Memori should use automatic retrieval rather than giving the LLM a search tool.

Before each model call, the system retrieves the most relevant memories from storage and injects them directly into the model context with metadata. The LLM does not decide whether to search. Retrieval is a responsibility of the memory system.

The LLM can still maintain memory through explicit tools:

- `memory.write`
- `memory.update`
- `memory.delete`

This keeps responsibilities separated:

- the system retrieves relevant memory
- the LLM answers and proposes memory changes
- the database stores durable memories
- the consolidator cleans up duplicates, noise, and obsolete information

## High-Level Flow

```text
User message
  -> automatic retrieval from memory database
  -> inject relevant memories into LLM context
  -> LLM answers with memory metadata available
  -> LLM may call write/update/delete tools
  -> memory changes are saved
  -> after the session, consolidation cleans the memory base
```

## Context Injection

Relevant memories should be injected into the model context in a structured block. Each memory must include enough metadata for the model to use it correctly and for the system to evaluate retrieval quality.

Example:

```yaml
relevant_memories:
  - id: mem_012
    kind: preference
    confidence: 0.92
    content: User prefers answers in French.
    reason: Matches a stable language preference relevant to the current request.

  - id: mem_027
    kind: project
    confidence: 0.87
    content: User is building Memori, a memory layer for LLMs.
    reason: Current request discusses the memory architecture.
```

The model should treat this block as retrieved context, not as a user message.

## Memory Tools

The LLM should not receive a general-purpose search tool in the main design.

Instead, it receives maintenance tools:

```text
memory.write(content, kind, confidence, source)
memory.update(memory_id, content, confidence, reason)
memory.delete(memory_id, reason)
```

The purpose of these tools is to let the model maintain the memory base when the conversation reveals durable information.

Examples of information worth writing:

- user preferences
- stable project constraints
- important decisions
- deferred tasks
- confirmed corrections to previous memories

Examples of information that should not be written:

- casual micro-details
- assistant acknowledgements
- temporary environment details
- one-off emotional phrasing unless it affects future behavior
- duplicated restatements of an existing memory

## Storage

Memories should be stored in a vector database with metadata.

A memory record should eventually include:

```yaml
id: mem_012
kind: preference
content: User prefers short but concrete explanations for code topics.
embedding: ...
confidence: 0.91
created_at: ...
updated_at: ...
source_session_id: chat_1_seed
status: active
```

The vector database is used for semantic retrieval. Metadata can support filtering, ranking, freshness, confidence, and explainability.

## Retrieval

Retrieval is automatic and happens before each LLM call.

The first version can use:

- semantic search over embeddings
- top-k retrieval
- lightweight metadata scoring

Later versions can add:

- keyword matching
- recency weighting
- confidence weighting
- reranking
- topic filters

The retrieval system should produce both selected memories and an explanation of why they were selected.

## Consolidation

Consolidation should run after a chat session, not necessarily after every single turn.

The consolidator should:

- merge duplicated memories
- replace obsolete memories when newer information contradicts them
- remove weak or noisy memories
- preserve important stable information
- update confidence
- keep an audit trail when possible

This makes the architecture easier to build incrementally:

```text
V1: automatic retrieval + memory write tool
V2: add update/delete tools
V3: add session-end consolidation
V4: add stronger scoring, conflict handling, and explainability
```

## Benchmark Implications

The benchmark should evaluate the architecture as separate components first, then as a full memory loop.

The core scenario types are:

- `retrieval_injection`
- `memory_tool_call`
- `session_consolidation`
- `full_loop`

This keeps failures diagnosable. If the full loop fails, the smaller component scenarios should reveal whether the issue is retrieval, tool-call behavior, or consolidation.

### Retrieval Injection

Retrieval scenarios test whether the system injects the right memories before the model call.

Example:

```text
initial memories + user turn
  -> automatic retrieval
  -> expected injected memory IDs
```

The LLM does not call a search tool in these tests.

```yaml
type: retrieval_injection
initial_memories:
  - id: mem_project
    content: User is building Memori, a durable memory layer for LLM conversations.
  - id: mem_running
    content: User prefers running in the morning.
turns:
  - role: user
    content: Can you help me think through the memory architecture?
expected:
  injected_memory_ids:
    include:
      - mem_project
    exclude:
      - mem_running
    max_count: 3
```

### Memory Tool Calls

Tool-call scenarios test whether the LLM maintains memory correctly when it sees a user message and optional injected memories.

They check whether the model should:

- call `memory.write`
- call `memory.update`
- call `memory.delete`
- avoid calling any memory tool

Example:

```yaml
type: memory_tool_call
injected_memory_ids: []
turns:
  - role: user
    content: For code explanations, I prefer short but concrete answers.
expected:
  tool_calls:
    - name: memory.write
      arguments:
        kind: preference
        content_regex: (?i)\bcode\b.*\bshort\b.*\bconcrete\b
        confidence: high
  final_memory_count:
    min: 1
    max: 1
```

Noise should produce no write:

```yaml
expected:
  tool_calls: []
  forbidden_tool_calls:
    - name: memory.write
      arguments:
        content_regex: (?i)\bcoffee\b|\bplaylist\b
  final_memory_count:
    min: 0
    max: 0
```

### Consolidation

Consolidation scenarios test the post-session cleanup step without running a chat.

```yaml
type: session_consolidation
pre_consolidation_memories:
  - id: mem_1
    content: Memori is an external memory layer for LLMs.
  - id: mem_2
    content: Memori gives language models durable memory.
  - id: mem_3
    content: User opened a terminal.
expected:
  final_memory_count:
    min: 1
    max: 1
  final_memories:
    should_match:
      - label: consolidated_project_memory
        regex: (?i)\bMemori\b.*\bmemory\b.*\bLLM
    should_not_match:
      - regex: (?i)\bterminal\b
```

### Full Loop

Full-loop scenarios test several fresh-context chats together:

```text
chat 1 -> automatic retrieval -> LLM memory tool calls
chat 2 with fresh context -> automatic retrieval -> LLM updates memory
chat 3 with fresh context -> automatic retrieval -> answer
session end -> consolidation
```

These scenarios are useful for the final demo, but they should not replace focused component tests.

Across all scenario types, expectations should avoid exact memory wording. A good memory system may phrase the same fact differently.

Instead, scenarios should check:

- how many memories were created
- whether created memories match expected regex patterns
- whether noisy details were not stored
- whether retrieval included the right memory labels
- whether retrieval excluded irrelevant memories
- whether consolidation removed duplicates or obsolete facts

This catches the important failure mode: if a scenario contains only two durable facts but the system creates ten memories, the benchmark should fail even if some of those memories are technically true.

## Design Principle

Memori should not try to remember everything.

The system should remember information that improves future behavior and discard information that only describes the current moment. The hard part is not storing memories; the hard part is keeping the memory base useful.
