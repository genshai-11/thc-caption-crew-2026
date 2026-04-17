# PRD + Full Specs (AI Studio Executable)

## Project
**Caption & Crew** (internal: THC)

Version: 2026-04-01 (execution-ready)

---

## 1) Product Intent
Caption & Crew is a mobile-first 2-player speaking game that measures whether meaning survives across languages under time pressure:
- Captain speaks **Vietnamese**
- Crew responds in **English**
- System evaluates **meaning match**, not literal translation

Core principle: **speech-first meaning transfer**.

---

## 2) Success Criteria
A round is successful when:
1. Captain and Crew can record quickly
2. Crew starts within delay window
3. Live transcript path runs with minimal post-stop wait
4. Meaning score appears in summary
5. Replay and history persist

Admin success:
1. Deepgram + Router9 config can be saved and loaded
2. STT tests (VI/EN) and Router tests pass
3. Runtime config is applied by backend functions

---

## 3) Scope

## In Scope
- Game flow (Captain → Crew → Analyze → Summary)
- Realtime waveform visualization
- Streaming-first transcription (with batch fallback verification)
- Meaning evaluation via Router9-compatible Chat Completions
- History persistence + audio upload
- Admin auth (Email/Password + allowlist)
- Admin runtime config + validation tools

## Out of Scope
- Classroom management / LMS
- Social multiplayer rooms
- Enterprise RBAC claims system
- Pronunciation scoring engine

---

## 4) User Roles
- **Captain**: speaks Vietnamese source meaning
- **Crew**: responds in English under time window
- **Admin**: sets provider keys/models and validates readiness

---

## 5) UX & Experience Requirements
- Minimal, touch-first, game-like UI
- Two role zones (Captain blue, Crew red)
- No transcript leakage during normal play
- Fast transition from speech to result
- Analysis appears on separate summary screen

---

## 6) App Routes / Screens
- `/` Game
- `/summary` Analysis Summary
- `/history` History
- `/settings` Timing/strictness settings
- `/admin-login` Admin auth
- `/admin` Admin runtime config + validation

Key files:
- [src/App.tsx](src/App.tsx)
- [src/pages/GamePage.tsx](src/pages/GamePage.tsx)
- [src/pages/AnalysisSummaryPage.tsx](src/pages/AnalysisSummaryPage.tsx)
- [src/pages/HistoryPage.tsx](src/pages/HistoryPage.tsx)
- [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx)
- [src/pages/AdminLoginPage.tsx](src/pages/AdminLoginPage.tsx)
- [src/pages/AdminPage.tsx](src/pages/AdminPage.tsx)

---

## 7) Gameplay State Machine
State values:
- `captain-ready`
- `captain-recording`
- `crew-waiting`
- `crew-timeout`
- `crew-recording`
- `crew-processing`
- `evaluating`
- `results`

Orchestration source:
- [src/hooks/useCaptionCrewRound.ts](src/hooks/useCaptionCrewRound.ts)

Flow:
1. Captain starts recording
2. Streaming session opens (VI), chunks sent while recording
3. Captain stops, countdown starts for Crew
4. Crew starts within allowed delay
5. Streaming session opens (EN), chunks sent while recording
6. Crew stops → finalize transcripts
7. Evaluate meaning with finalized transcripts
8. Save round + audio + optional verified transcripts
9. Navigate to summary

Timeout rule:
- If Crew starts after `maxCrewStartDelayMs` → auto timeout result

---

## 8) Recording & Audio Specs
Recorder hook:
- [src/hooks/useRoundRecorder.ts](src/hooks/useRoundRecorder.ts)

Requirements:
- Uses `MediaRecorder`
- Emits live chunks (`timeslice` ~250ms)
- Preserves full audio blob for upload/fallback
- Shows waveform via analyser node

Preferred MIME candidates:
- `audio/webm;codecs=opus`
- `audio/webm`
- `audio/mp4`
- `audio/ogg;codecs=opus`

---

## 9) Transcription Architecture

## Streaming-first path
Service:
- [src/services/deepgramStreamingService.ts](src/services/deepgramStreamingService.ts)

Behavior:
- Acquire temporary Deepgram token from backend
- Open WebSocket `wss://api.deepgram.com/v1/listen`
- Send audio chunks as user speaks
- Emit partial transcript updates
- On stop, send `Finalize`, then settle final transcript

## Batch fallback/verification path
Service:
- [src/services/transcriptionService.ts](src/services/transcriptionService.ts)

Endpoint:
- `transcribeRoundAudio`

Usage:
- If streaming fails/empty, fallback to batch
- Save verified transcript for diagnostics

Transcript source flags:
- `streaming`
- `batch`
- `streaming-fallback-batch`

---

## 10) Meaning Evaluation Specs
Service:
- [src/services/meaningService.ts](src/services/meaningService.ts)

Backend endpoint:
- `evaluateCaptionCrewMeaning`

Input:
- `captainTranscript`
- `crewTranscript`
- strictness/feedback config

Output:
- `matchScore` (0-100)
- `decision` (`match|partial|mismatch|timeout`)
- `reason`
- optional feedback fields (`grammarNote`, `improvedTranscript`, etc.)

Policy:
- Meaning preservation prioritized over literal overlap
- Minor grammar not penalized unless clarity affected

---

## 11) Backend API Contracts (Firebase Functions)
Source:
- [functions/src/index.js](functions/src/index.js)

## 11.1 `POST /getDeepgramAccessToken`
Purpose:
- Mint short-lived JWT for browser-safe streaming auth

Body (optional):
```json
{ "ttlSeconds": 90 }
```
Response:
```json
{ "accessToken": "...", "expiresIn": 90 }
```

## 11.2 `POST /transcribeRoundAudio?role={captain|crew}&language={vi|en}`
Headers:
- `Content-Type: audio/*`
- optional `x-deepgram-model`
- optional `x-deepgram-api-key` (diagnostic override)

Body:
- raw audio bytes

Response (normalized):
```json
{
  "transcript": "...",
  "words": [],
  "confidence": 0.0,
  "duration": 0.0,
  "modelRequested": "nova-3",
  "modelUsed": "nova-3",
  "fallbackUsed": false,
  "roleReceived": "captain",
  "languageReceived": "vi",
  "contentTypeReceived": "audio/webm",
  "requestId": "..."
}
```

## 11.3 `POST /fetchRouterModels`
Response:
```json
{ "models": [{ "id": "..." }] }
```

## 11.4 `POST /testRouterCompletion`
Response:
```json
{ "ok": true, "content": "Router9 connection OK", "model": "..." }
```

## 11.5 `POST /evaluateCaptionCrewMeaning`
Response includes:
- `matchScore`, `decision`, `reason`
- optional concept/feedback fields

---

## 12) Data Models
Reference:
- [src/types.ts](src/types.ts)

Key entities:
- `TranscriptResult`
- `MeaningEvaluation`
- `RoundRecord`
- `GameSettings`

`RoundRecord` should include:
- primary transcripts
- verified transcripts (optional)
- evaluation
- reaction delay
- audio URLs/paths/mime types

---

## 13) Storage & Persistence

## Round history and settings
- Local cache + optional cloud path in repository service
- Audio files uploaded to Firebase Storage path:
  - `rounds/{roundId}/{role}.{ext}`

Audio upload service:
- [src/services/roundAudioStorage.ts](src/services/roundAudioStorage.ts)

## Admin runtime config (current implementation target)
- Save shared runtime config as JSON in Firebase Storage:
  - `admin-runtime/shared.json`
- Save public theme as JSON in Firebase Storage:
  - `public-settings/app-theme.json`

Repository:
- [src/services/adminConfigRepository.ts](src/services/adminConfigRepository.ts)

Backend shared config loader reads same JSON via Admin SDK bucket access.

---

## 14) Security Rules (Required)
Current Storage rules file:
- [storage.rules](storage.rules)

Required behavior:
1. `rounds/**` write/read allowed per product policy (currently permissive for MVP)
2. `admin-runtime/shared.json` read/write: authenticated only
3. `public-settings/app-theme.json` read public, write authenticated
4. deny everything else

---

## 15) Environment Variables
Frontend (`.env`):
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_TRANSCRIBE_URL`
- `VITE_DEEPGRAM_TOKEN_URL`
- `VITE_FETCH_MODELS_URL`
- `VITE_TEST_ROUTER_URL`
- `VITE_EVALUATE_MEANING_URL`
- `VITE_ADMIN_EMAILS`

Backend (Functions env or cloud config JSON):
- `DEEPGRAM_API_KEY`
- `ROUTER9_API_KEY`
- `ROUTER9_BASE_URL`
- `ROUTER9_MODEL`
- `ROUTER9_FALLBACK_MODEL`

---

## 16) Deployment Topology
- Hosting target: `cc-faceoff` (public URL `cc-faceoff.web.app`)
- Functions codebase: `ccfaceoff`
- Region: `us-central1` (HTTP functions)

Config files:
- [firebase.json](firebase.json)
- [vite.config.ts](vite.config.ts)
- [vite.config.js](vite.config.js)

Important cache policy:
- `index.html` must be `no-cache, no-store, must-revalidate`
- assets immutable long-cache

---

## 17) Known Infrastructure Risks / Preconditions
1. **Firebase Storage must be provisioned in project console**
   - Without one-time Storage setup, admin config cloud save cannot work.
2. Project mode mismatches (Datastore vs Firestore Native) can break Firestore-document-based config storage.
3. Streaming requires backend token minting to succeed (`DEEPGRAM_API_KEY` present).
4. Browser cache can pin stale JS bundle; keep index uncached.

---

## 18) Acceptance Test Checklist (Executable)

## A. Game loop
- [ ] Captain can record with waveform
- [ ] Crew waiting countdown appears
- [ ] Timeout triggers correctly
- [ ] Crew can record and stop
- [ ] Summary screen renders evaluation

## B. Streaming STT
- [ ] Transcript text appears while speaking
- [ ] Final transcript stabilizes quickly on stop
- [ ] Fallback to batch if streaming fails

## C. Admin
- [ ] Admin login works for allowlisted email
- [ ] Save config succeeds (cloud-backed)
- [ ] Reload preserves config from cloud
- [ ] Vietnamese STT test passes
- [ ] English STT test passes
- [ ] Router models fetch passes
- [ ] Router completion test passes

## D. Backend
- [ ] `getDeepgramAccessToken` returns token
- [ ] `transcribeRoundAudio` returns transcript JSON
- [ ] `evaluateCaptionCrewMeaning` returns valid score/decision

## E. Persistence
- [ ] Round audio uploads to Storage
- [ ] History list shows recent rounds

---

## 19) AI Studio Rebuild Plan (from scratch)

## Phase 1 — Scaffold
1. Create React + TS + Vite app
2. Add routes and baseline shell
3. Add Firebase SDK integration

## Phase 2 — Core game
1. Implement recorder hook + waveform
2. Implement round state machine
3. Implement Captain/Crew role panels

## Phase 3 — Backend APIs
1. Implement Firebase HTTP functions listed above
2. Add Deepgram batch STT integration
3. Add Router9 evaluation integration

## Phase 4 — Streaming
1. Add token endpoint
2. Add browser WebSocket streaming service
3. Wire chunking + finalize + fallback

## Phase 5 — Admin + Config
1. Add admin auth and allowlist
2. Add admin config + validation UI
3. Add cloud persistence for runtime config (Storage JSON path)

## Phase 6 — Deploy + harden
1. Configure hosting target/codebase
2. Deploy functions + hosting
3. Verify cache headers
4. Run acceptance checklist

---

## 20) Definition of Done
Project is considered fully executable when:
1. Public game URL works
2. Admin can authenticate and save config
3. Streaming + fallback transcription both work
4. Meaning evaluation works end-to-end
5. History + audio persistence works
6. All checklist items in Section 18 pass

---

## Appendix A — Key Source-of-Truth Files
- [src/hooks/useCaptionCrewRound.ts](src/hooks/useCaptionCrewRound.ts)
- [src/hooks/useRoundRecorder.ts](src/hooks/useRoundRecorder.ts)
- [src/services/deepgramStreamingService.ts](src/services/deepgramStreamingService.ts)
- [src/services/transcriptionService.ts](src/services/transcriptionService.ts)
- [src/services/meaningService.ts](src/services/meaningService.ts)
- [src/services/adminConfigRepository.ts](src/services/adminConfigRepository.ts)
- [functions/src/index.js](functions/src/index.js)
- [firebase.json](firebase.json)
- [storage.rules](storage.rules)
- [PRD.md](PRD.md)
- [PURPOSE.md](PURPOSE.md)
