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

export interface GameSettings {
  maxCrewStartDelayMs: number;
  strictness: 'loose' | 'medium' | 'strict';
  showCountdown: boolean;
}

export interface TranscriptResult {
  transcript: string;
  confidence: number;
  duration: number;
}

export interface MeaningEvaluation {
  matchScore: number;
  decision: 'match' | 'partial' | 'mismatch' | 'timeout';
  reason: string;
  missingConcepts?: string[];
  extraConcepts?: string[];
}

export interface RoundRecord {
  id: string;
  createdAt: string;
  state: RoundState;
  captainTranscript?: TranscriptResult;
  crewTranscript?: TranscriptResult;
  evaluation?: MeaningEvaluation;
  reactionDelayMs?: number;
  timeoutLost: boolean;
}