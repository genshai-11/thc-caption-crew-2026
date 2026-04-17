export type RoundState =
  | 'captain-ready'
  | 'captain-recording'
  | 'captain-processing'
  | 'crew-waiting'
  | 'crew-timeout'
  | 'crew-recording'
  | 'crew-processing'
  | 'evaluating'
  | 'results';

export type VisualTheme = 'minimal' | 'bold';

export interface GameSettings {
  maxCrewStartDelayMs: number;
  strictness: 'loose' | 'medium' | 'strict';
  showCountdown: boolean;
}

export type TranscriptSource = 'streaming' | 'batch' | 'streaming-fallback-batch';

export interface TranscriptResult {
  transcript: string;
  confidence: number;
  duration: number;
  source?: TranscriptSource;
  modelRequested?: string;
  modelUsed?: string;
  fallbackUsed?: boolean;
  requestId?: string;
  emptyTranscript?: boolean;
  roleReceived?: string;
  languageReceived?: string;
  contentTypeReceived?: string;
  transcriptProviderUsed?: string;
}

export interface MeaningEvaluation {
  matchScore: number;
  decision: 'match' | 'partial' | 'mismatch' | 'timeout';
  reason: string;
  missingConcepts?: string[];
  extraConcepts?: string[];
  grammarNote?: string;
  improvedTranscript?: string;
  grammarSeverity?: 'none' | 'minor' | 'medium' | 'major';
  feedbackType?: 'off' | 'gentle' | 'balanced' | 'detailed';
}

export interface OhmChunkResult {
  text: string;
  label: 'GREEN' | 'BLUE' | 'RED' | 'PINK';
  ohm: number;
}

export interface OhmResult {
  totalOhm: number;
  formula: string;
  voltage: number;
  current: number;
  difficulty: string;
  score: number;
  chunkCount: number;
  chunks: OhmChunkResult[];
}

export interface RoundRecord {
  id: string;
  createdAt: string;
  state: RoundState;
  captainTranscript?: TranscriptResult;
  crewTranscript?: TranscriptResult;
  captainVerifiedTranscript?: TranscriptResult;
  crewVerifiedTranscript?: TranscriptResult;
  ohmResult?: OhmResult;
  evaluation?: MeaningEvaluation;
  reactionDelayMs?: number;
  timeoutLost: boolean;
  captainAudioUrl?: string;
  crewAudioUrl?: string;
  captainAudioPath?: string;
  crewAudioPath?: string;
  captainAudioMimeType?: string;
  crewAudioMimeType?: string;
}

export interface SummaryLocationState {
  evaluation: MeaningEvaluation | null;
  reactionDelayMs: number | null;
  errorMessage?: string | null;
  captainTranscript?: TranscriptResult | null;
  crewTranscript?: TranscriptResult | null;
  captainVerifiedTranscript?: TranscriptResult | null;
  crewVerifiedTranscript?: TranscriptResult | null;
  ohmResult?: OhmResult | null;
  captainAudioBlob?: Blob | null;
  crewAudioBlob?: Blob | null;
  captainAudioUrl?: string | null;
  crewAudioUrl?: string | null;
}
