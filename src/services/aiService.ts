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
  baseOhm?: number;
  lengthBucket?: 'veryShort' | 'short' | 'medium' | 'long' | 'overLong';
  lengthCoefficient?: number;
}

const ANALYZE_OHM_URL = import.meta.env.DEV
  ? '/api/analyzeTranscriptOhm'
  : (import.meta.env.VITE_ANALYZE_OHM_URL || '');

export async function analyzeTranscript(
  transcript: string,
  options?: {
    model?: string;
    fallbackModel?: string;
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
    baseOhm: typeof data.baseOhm === 'number' ? data.baseOhm : undefined,
    lengthBucket: typeof data.lengthBucket === 'string' ? data.lengthBucket : undefined,
    lengthCoefficient: typeof data.lengthCoefficient === 'number' ? data.lengthCoefficient : undefined,
  };
}
