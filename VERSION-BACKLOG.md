# THC Caption Crew 2026 — Version Backlog

## Released

### 2026-04-21 — STT Control v1
- Tag: `prod-2026-04-21-stt-control-v1`
- Commit: `ae11e09`
- Notes:
  - Added single-transcript mode toggle (`partialTranscriptEnabled`)
  - Improved STT flow controls in Admin

### 2026-04-21 — Google Model Test v1
- Tag: `prod-2026-04-21-google-model-test-v1`
- Commit: `79f56cc`
- Notes:
  - Added Google STT model fetch/test utilities
  - Added model sanitization and location handling

## Ready to Release

### 2026-04-21 — OHM Router9 Single Engine v2
- Tag: `prod-2026-04-21-ohm-router9-v2`
- Scope:
  - OHM analysis moved to single engine Router9
  - Dedicated OHM model settings (`ohmModel`, `ohmFallbackModel`)
  - Dynamic OHM settings (`ohmWeights`, `ohmLengthConstraints`, `ohmLengthCoefficients`)
  - Coefficient set fixed to `1, 1.5, 2, 2.5` with `overLong=2.5`
  - Runbook updated to OHM v2 operational flow
- Validation:
  - `npm run build` passed
  - `node --check functions/src/index.js` passed

## Next Backlog

### v2.1 (planned)
- Add OHM confidence guardrails for low-confidence chunk classification
- Add Admin warning when coefficient set drifts from allowed values
- Add golden-set regression test for OHM scoring consistency

### v2.2 (planned)
- Add OHM decision evidence viewer in Admin (match phrases + length bucket)
- Add structured export for OHM scoring diagnostics
