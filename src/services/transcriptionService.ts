import { TranscriptResult } from '@/types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export async function transcribeRoundAudio(audioBlob: Blob, options: { role: 'captain' | 'crew'; language: 'vi' | 'en' }) {
  if (!API_BASE_URL) {
    throw new Error('VITE_API_BASE_URL is not configured. Point it to your Firebase HTTPS functions base URL.');
  }

  const arrayBuffer = await audioBlob.arrayBuffer();
  const response = await fetch(`${API_BASE_URL}/transcribeRoundAudio?role=${options.role}&language=${options.language}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
    },
    body: arrayBuffer,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Transcription failed');
  }

  return {
    transcript: String(data.transcript || ''),
    confidence: Number(data.confidence || 0),
    duration: Number(data.duration || 0),
  } as TranscriptResult;
}