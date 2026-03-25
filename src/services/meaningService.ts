import { MeaningEvaluation } from '@/types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export async function evaluateCaptionCrewMeaning(payload: {
  captainTranscript: string;
  crewTranscript: string;
  strictness: 'loose' | 'medium' | 'strict';
}) {
  if (!API_BASE_URL) {
    throw new Error('VITE_API_BASE_URL is not configured. Point it to your Firebase HTTPS functions base URL.');
  }

  const response = await fetch(`${API_BASE_URL}/evaluateCaptionCrewMeaning`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Meaning evaluation failed');
  }

  return {
    matchScore: Number(data.matchScore || 0),
    decision: data.decision || 'mismatch',
    reason: data.reason || 'Evaluation completed.',
    missingConcepts: Array.isArray(data.missingConcepts) ? data.missingConcepts : [],
    extraConcepts: Array.isArray(data.extraConcepts) ? data.extraConcepts : [],
  } as MeaningEvaluation;
}