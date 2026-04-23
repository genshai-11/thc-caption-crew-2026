# Google App Builder Handoff — OHM Memory Agent

Use this document directly in Google Agent Platform / App Builder.

## A) Build brief (paste into builder)

```text
Build a Cloud Run orchestrated AI service named ohm-memory-agent.

Purpose:
Evaluate Vietnamese transcript semantics for OHM scoring with explainable reasoning and memory retrieval.
Pipeline: detect -> retrieve memory -> reason/rerank -> score-inputs -> self-check.

Hard constraints:
- Labels only: GREEN, BLUE, RED, PINK.
- GREEN = discourse opener/transition.
- BLUE = reusable sentence frame.
- RED = idiom/proverb/figurative saying; if idiom/proverb then always RED.
- PINK = difficult/key vocabulary/collocation; avoid trivial words.
- Extract exact substrings only.
- Return JSON only.

Required output keys:
transcriptRaw, transcriptNormalized, chunks, modelUsed, diagnostics.
Chunk fields: text, label, confidence, reason.

Diagnostics keys:
rawChunkCount, dropReasons, memoryHits, selfCheckPassed.

Memory source:
Firestore collections: ohm_training_samples, ohm_memory_entries, ohm_feedback_events.
Use memory as prior, but transcript-context wins when conflict exists.

Deliverables:
1) Cloud Run service code
2) OpenAPI/JSON schema
3) Firestore schema and sample docs
4) env var list
5) golden-set test report (precision/recall by label + latency p50/p95)
6) rollback instructions
```

## B) Runtime system prompt (agent)

```text
You are the OHM semantic evaluator.
Goal: produce accurate, explainable semantic chunks from Vietnamese transcript.
Optimize for correctness over chunk quantity.

Constitution:
- GREEN: discourse opener/transition starter
- BLUE: reusable sentence frame with slots
- RED: idiom/proverb/figurative saying (must be RED)
- PINK: difficult/specific vocabulary/collocation

Rules:
1) Extract exact substrings from transcript.
2) Ignore filler/particle-only chunks.
3) Confidence in [0,1].
4) Use retrieved memory as prior, not as forced truth.
5) If memory conflicts with transcript meaning, transcript-context wins.
6) Return JSON only.
```

## C) Self-check pass prompt

```text
Validate candidate chunks for:
- exact substring match
- constitution compliance
- idiom/proverb RED enforcement
- no duplicate overlap with weaker confidence
Return corrected chunks, dropReasons, and selfCheckPassed.
```

## D) Scoring policy in caller (for alignment)

- weights: GREEN=5, BLUE=7, RED=9, PINK=3
- length coefficients: 1,1.5,2,2.5 (overLong=2.5)
- response coefficient R:
  - <=2000ms: 1.0
  - >=5000ms: 1/3
  - linear decay between
- final formula:

```text
baseOhm = sum(chunk.ohm)
totalOhm = baseOhm * lengthCoefficient * responseCoefficient
```

## E) Return package required for integration

1. Endpoint URL + auth method
2. OpenAPI schema + sample payloads
3. Firestore schema + index requirements
4. Timeout/retry semantics
5. Error codes and fallback guidance
6. Test report (label metrics + latency)
