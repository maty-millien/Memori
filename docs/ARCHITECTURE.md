# Memori Architecture

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

- `memory.upsert` (create when called without `memory_id`, replace when called with one)
- `memory.delete`

This keeps responsibilities separated:

- the system retrieves relevant memory
- the LLM answers and proposes memory changes (including pruning duplicates it sees in the retrieved set)
- the database stores durable memories

## High-Level Flow

```text
User message
  -> automatic retrieval from memory database
  -> inject relevant memories into LLM context
  -> LLM answers with memory metadata available
  -> LLM may call upsert/delete tools (including delete on duplicates)
  -> memory changes are saved
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
memory.upsert(content, memory_id?, scope?)
memory.delete(memory_id)
```

`memory.upsert` creates a new memory when `memory_id` is omitted and replaces the content of an existing memory when one is passed.

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

## Write-Time Hygiene

There is no separate consolidation pass. The LLM is responsible for keeping the memory base clean at write time, every time it is invoked with a user turn and retrieved memories:

- if the user message restates an existing retrieved memory, write nothing
- if the user message contradicts or refines a retrieved memory, call `memory.upsert` with that `memory_id` to replace it
- if the retrieved set contains two or more memories stating substantially the same fact, call `memory.delete` on the redundant ones and keep the most informative single version
- if the user asks to forget something, call `memory.delete`

This collapses what a traditional consolidator would do into the same loop that already runs on every turn. The bet is that retrieval + the LLM at write time is sufficient; a periodic consolidation pass can be added later if the benchmark shows duplicates or obsolete entries slipping through.

Roadmap:

```text
V0: benchmark scenarios + scenario loader (current)
V1: automatic retrieval + memory upsert tool
V2: add delete tool
V3: stronger scoring, conflict handling, explainability
V4: (optional) periodic consolidation if write-time hygiene proves insufficient
```

## Benchmark Implications

The benchmark should evaluate the architecture as separate components first, then as a full memory loop.

The core scenario types are:

- `retrieval_injection`
- `memory_tool_call` (covers upsert, delete, including duplicate pruning)
- `full_loop`

This keeps failures diagnosable. If the full loop fails, the smaller component scenarios should reveal whether the issue is retrieval or tool-call behavior.

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
    kind: project
    content: User is building Memori, a durable memory layer for LLM conversations.
  - id: mem_running
    kind: preference
    content: User prefers running in the morning rather than in the evening.
turns:
  - role: user
    content: Can you help me think through the architecture for the memory system?
expected:
  injected_memory_ids:
    include:
      - mem_project
    exclude:
      - mem_running
    max_count: 3
  injected_memory_content:
    should_match:
      - regex: (?i)\bMemori\b.*\b(memory|memories)\b.*\b(LLM|LLMs|conversation)
```

Each memory carries a `kind` label (`preference`, `project`, `fact`, `note`) so retrieval and write-time tool decisions can reason about category, not just embedding similarity.

### Memory Tool Calls

Tool-call scenarios test whether the LLM maintains memory correctly when it sees a user message and optional injected memories.

They check whether the model should:

- call `memory.upsert` to create a new memory (no `memory_id`)
- call `memory.upsert` to replace an existing memory (with `memory_id`)
- call `memory.delete`
- avoid calling any memory tool

Example:

```yaml
type: memory_tool_call
initial_memories: []
turns:
  - role: user
    content: For code explanations, I prefer short but concrete answers.
expected:
  tool_calls:
    - name: memory.upsert
      arguments:
        memory_id: null
        content_regex: (?i)\bcode\b.*\b(short|concise|brief)\b.*\b(concrete|practical)\b
  forbidden_tool_calls:
    - name: memory.delete
  final_memory_count:
    min: 1
    max: 1
```

Updates target an existing memory by id (or a regex over ids in multi-session scenarios). `memory_id: null` asserts a create-style upsert; a specific id (or `memory_id_regex`) asserts a replace:

```yaml
initial_memories:
  - id: mem_report_style
    content: User prefers very detailed technical reports with many explanations.
turns:
  - role: user
    content: Actually, for technical reports, I now want something short, clear, and results-oriented.
expected:
  tool_calls:
    - name: memory.upsert
      arguments:
        memory_id: mem_report_style
        content_regex: (?i)\btechnical reports?\b.*\b(short|concise)\b.*\b(clear|results?-oriented|results?)\b
  forbidden_tool_calls:
    - name: memory.upsert
      arguments:
        memory_id: null
        content_regex: (?i)\btechnical reports?\b
```

Noise should produce no write:

```yaml
turns:
  - role: user
    content: I just opened my terminal, I am drinking coffee, and I put on a playlist.
expected:
  tool_calls: []
  forbidden_tool_calls:
    - name: memory.upsert
      arguments:
        content_regex: (?i)\bterminal\b|\bcoffee\b|\bplaylist\b
  final_memory_count:
    min: 0
    max: 0
```

### Full Loop

Full-loop scenarios chain several fresh-context chats and assert the final memory state:

```text
chat 1 -> automatic retrieval -> LLM memory tool calls
chat 2 with fresh context -> automatic retrieval -> LLM updates memory
chat 3 with fresh context -> automatic retrieval -> answer
end of run -> assertions over final_state
```

```yaml
type: full_loop
sessions:
  - id: chat_1_seed
    initial_memories: []
    expected_injected_memory_ids:
      include: []
      max_count: 0
    turns:
      - role: user
        content: For this project, answer in French. Also, Memori should be a CLI-first memory prototype.
    expected:
      tool_calls:
        - name: memory.upsert
          arguments:
            memory_id: null
            content_regex: (?i)\bFrench\b
        - name: memory.upsert
          arguments:
            memory_id: null
            content_regex: (?i)\bMemori\b.*\bCLI\b.*\bmemory\b
      final_memory_count: { min: 1, max: 2 }
  - id: chat_3_retrieve
    expected_injected_memory_ids:
      include: [mem_project_cli, mem_language]
      exclude: [mem_noise]
      max_count: 3
    turns:
      - role: user
        content: What should I show in the demo?
    expected:
      answer_traits:
        - The answer is in French.
        - The answer mentions comparing with-memory and without-memory behavior.
final_state:
  expected:
    final_memory_count: { min: 2, max: 3 }
    final_memories:
      should_match:
        - regex: (?i)\bFrench\b
        - regex: (?i)(?=.*\bMemori\b)(?=.*\bCLI\b)(?=.*\bdemo\b)
```

These scenarios are useful for the final demo, but they should not replace focused component tests.

Across all scenario types, expectations should avoid exact memory wording. A good memory system may phrase the same fact differently.

Instead, scenarios should check:

- how many memories were created
- whether created memories match expected regex patterns (use lookahead form `(?=.*A)(?=.*B)` to stay order-independent)
- whether noisy details were not stored
- whether retrieval included the right memory labels
- whether retrieval excluded irrelevant memories
- whether duplicate or obsolete memories were pruned at write time

This catches the important failure mode: if a scenario contains only two durable facts but the system creates ten memories, the benchmark should fail even if some of those memories are technically true.

## Implementation Status

The repository currently contains the benchmark spec, not the runtime:

- `benchmarks/` — nine scenario YAML files covering retrieval injection (×2), memory tool calls for write/update/delete and noise rejection (×6), and a multi-session full loop (×1).
- `src/benchmark/` — a loader (`loader.py`) that parses every YAML file in `benchmarks/` into a list of dicts, and a `main` entry point (`make benchmark`) that prints the scenario count. There is no execution or grading logic; the recent refactor explicitly removed it so the harness can be rebuilt around the agreed scenario format.
- `src/cli/` — placeholder only; the user-facing CLI is not implemented.
- `src/core/` — empty. No retriever, no memory store, no tool implementations yet.

The memory record schema in [Storage](#storage) (with `embedding`, `confidence`, `status`, etc.) is the target shape. Scenarios today only carry `id`, `kind`, and `content` — confidence and source metadata are deferred until the storage layer lands.

## Design Principle

Memori should not try to remember everything.

The system should remember information that improves future behavior and discard information that only describes the current moment. The hard part is not storing memories; the hard part is keeping the memory base useful.
