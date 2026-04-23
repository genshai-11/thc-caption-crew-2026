import { loadAdminRuntimeConfig } from '@/services/adminConfigRepository';

export interface SemanticChunk {
  text: string;
  label: 'GREEN' | 'BLUE' | 'RED' | 'PINK' | 'NONE';
  ohm: number;
  confidence: number;
  reason: string;
}

export interface OhmAnalysisResult {
  transcriptRaw: string;
  transcriptNormalized: string;
  chunks: SemanticChunk[];
  formula: string;
  totalOhm: number;
  modelUsed?: string;
  analysisSource?: string;
  responseCoefficient?: number;
  responseCoefficientApplied?: boolean;
  agentDiagnostics?: {
    enabled?: boolean;
    shadowMode?: boolean;
    elapsedMs?: number;
    memoryHits?: number;
    rawChunkCount?: number;
    selfCheckPassed?: boolean;
    error?: string;
  };
  baseOhm?: number;
  lengthBucket?: 'veryShort' | 'short' | 'medium' | 'long' | 'overLong';
  lengthCoefficient?: number;
  verifierAppliedCount?: number;
  uncertainChunkCount?: number;
  chunkDiagnostics?: Array<{
    text: string;
    normalized: string;
    source: string;
    inputLabel: string;
    finalLabel: string;
    verifierDecision: string;
    verifierReason: string;
    evidenceScore: number;
    verifierScore: number;
    needsReview: boolean;
  }>;
}

const ANALYZE_OHM_URL = import.meta.env.DEV
  ? '/api/analyzeTranscriptOhm'
  : (import.meta.env.VITE_ANALYZE_OHM_URL || '');

export async function analyzeTranscript(
  transcript: string,
  options?: {
    model?: string;
    fallbackModel?: string;
    reactionDelayMs?: number | null;
    useMemoryAssist?: boolean;
    returnDebug?: boolean;
    sessionId?: string;
    roundId?: string;
    userId?: string;
  },
): Promise<OhmAnalysisResult> {
  if (!ANALYZE_OHM_URL) {
    throw new Error('VITE_ANALYZE_OHM_URL is not configured.');
  }

  const config = loadAdminRuntimeConfig();

  const response = await fetch(ANALYZE_OHM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transcript,
      model: options?.model || config.ohmModel || config.router9Model,
      fallbackModel: options?.fallbackModel || config.ohmFallbackModel || config.router9FallbackModel,
      reactionDelayMs: typeof options?.reactionDelayMs === 'number' ? options.reactionDelayMs : undefined,
      useMemoryAssist: options?.useMemoryAssist ?? config.ohmAgentEnabled,
      returnDebug: options?.returnDebug ?? true,
      agentShadowMode: config.ohmAgentShadowMode,
      sessionId: options?.sessionId,
      roundId: options?.roundId,
      userId: options?.userId,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Transcript analysis failed');

  return {
    transcriptRaw: String(data.transcriptRaw || transcript),
    transcriptNormalized: String(data.transcriptNormalized || ''),
    chunks: Array.isArray(data.chunks) ? data.chunks : [],
    formula: String(data.formula || '0'),
    totalOhm: Number(data.totalOhm || 0),
    modelUsed: typeof data.modelUsed === 'string' ? data.modelUsed : undefined,
    analysisSource: typeof data.analysisSource === 'string' ? data.analysisSource : undefined,
    responseCoefficient: typeof data.responseCoefficient === 'number' ? data.responseCoefficient : undefined,
    responseCoefficientApplied: data.responseCoefficientApplied === true,
    agentDiagnostics: data.agentDiagnostics && typeof data.agentDiagnostics === 'object' ? data.agentDiagnostics : undefined,
    baseOhm: typeof data.baseOhm === 'number' ? data.baseOhm : undefined,
    lengthBucket: typeof data.lengthBucket === 'string' ? data.lengthBucket : undefined,
    lengthCoefficient: typeof data.lengthCoefficient === 'number' ? data.lengthCoefficient : undefined,
    verifierAppliedCount: typeof data.verifierAppliedCount === 'number' ? data.verifierAppliedCount : undefined,
    uncertainChunkCount: typeof data.uncertainChunkCount === 'number' ? data.uncertainChunkCount : undefined,
    chunkDiagnostics: Array.isArray(data.chunkDiagnostics) ? data.chunkDiagnostics : undefined,
  };
}
