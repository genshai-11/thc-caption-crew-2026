# Caption & Crew (THC)

A new standalone mobile-first speaking game project.

## Core loop
- Captain speaks in Vietnamese first.
- Deepgram **streaming** Vietnamese STT starts building transcript while Captain is speaking.
- Crew must start in time, then reply in English.
- Deepgram **streaming** English STT builds the Crew transcript during speech.
- Router9-backed LLM evaluates meaning match from the finalized live transcript.
- The existing batch `transcribeRoundAudio` function still runs as verification / fallback / replay support.

## Stack
- React + TypeScript + Vite
- Firebase (new project config)
- Cloud Functions scaffold for Deepgram + Router9

## Local setup
1. Copy `.env.example` to `.env`
2. Fill in your **new Firebase** project config
3. Install frontend dependencies: `npm install`
4. Install functions dependencies: `cd functions && npm install`
5. Deploy or emulate Functions so the project can call:
   - `transcribeRoundAudio`
   - `getDeepgramAccessToken`
   - `fetchRouterModels`
   - `testRouterCompletion`
   - `evaluateCaptionCrewMeaning`
6. Run frontend: `npm run dev`

## Streaming-first transcript design
- Browser audio is recorded once but split into two paths:
  - **live chunks** → Deepgram streaming for low-latency transcript
  - **full audio blob** → existing batch function for verify/fallback/replay
- The browser obtains a short-lived Deepgram token from `getDeepgramAccessToken`.
- Meaning analysis starts from the finalized live transcript so users no longer wait for full post-recording STT before analysis begins.

## Important
This is a **new project**. It reuses ideas and selected code patterns from Voice Energy Trainer, but it is not coupled to that codebase.

## Product Docs
- [PRD.md](./PRD.md)
- [PURPOSE.md](./PURPOSE.md)
