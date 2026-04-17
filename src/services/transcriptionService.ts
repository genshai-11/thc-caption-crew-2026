import { loadAdminRuntimeConfig } from '@/services/adminConfigRepository';
import { TranscriptResult } from '@/types';

const TRANSCRIBE_URL = import.meta.env.DEV ? '/api/transcribeRoundAudio' : (import.meta.env.VITE_TRANSCRIBE_URL || '');
const DEEPGRAM_TOKEN_URL = import.meta.env.DEV ? '/api/getDeepgramAccessToken' : (import.meta.env.VITE_DEEPGRAM_TOKEN_URL || '');

export async function transcribeRoundAudio(
  audioBlob: Blob,
  options: {
    role: 'captain' | 'crew';
    language: 'vi' | 'en';
    providerOverride?: 'deepgram' | 'google';
    deepgramModelOverride?: string;
    googleModelOverride?: string;
    deepgramApiKeyOverride?: string;
    googleApiKeyOverride?: string;
    preferServerConfig?: boolean;
  },
) {
  if (!TRANSCRIBE_URL) {
    throw new Error('VITE_TRANSCRIBE_URL is not configured.');
  }

  const config = loadAdminRuntimeConfig();
  const transcriptProvider = options.providerOverride || config.transcriptProvider || 'deepgram';
  const selectedDeepgramModel = options.deepgramModelOverride || (options.role === 'captain' ? config.captainDeepgramModel : config.crewDeepgramModel);
  const selectedGoogleModel = options.googleModelOverride || config.googleTranscriptModel || 'gemini-1.5-flash';
  const selectedModel = transcriptProvider === 'google' ? selectedGoogleModel : selectedDeepgramModel;
  const mimeType = audioBlob.type || 'audio/webm;codecs=opus';
  const preferServerConfig = options.preferServerConfig === true;
  const headers: Record<string, string> = {
    'Content-Type': mimeType,
  };

  const hasAnyOverride = !!(
    options.providerOverride ||
    options.deepgramModelOverride ||
    options.googleModelOverride ||
    options.deepgramApiKeyOverride ||
    options.googleApiKeyOverride
  );

  if (!preferServerConfig || hasAnyOverride) {
    headers['x-transcript-provider'] = transcriptProvider;
    if (selectedDeepgramModel) {
      headers['x-deepgram-model'] = selectedDeepgramModel;
    }
    const deepgramApiKey = options.deepgramApiKeyOverride || config.deepgramApiKey;
    if (deepgramApiKey) {
      headers['x-deepgram-api-key'] = deepgramApiKey;
    }
    if (selectedGoogleModel) {
      headers['x-google-model'] = selectedGoogleModel;
    }
    const googleApiKey = options.googleApiKeyOverride || config.googleApiKey;
    if (googleApiKey) {
      headers['x-google-api-key'] = googleApiKey;
    }
  }

  const response = await fetch(`${TRANSCRIBE_URL}?role=${options.role}&language=${options.language}`, {
    method: 'POST',
    headers,
    body: audioBlob,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Transcription failed');
  }

  return {
    transcript: String(data.transcript || ''),
    confidence: Number(data.confidence || 0),
    duration: Number(data.duration || 0),
    source: 'batch',
    modelRequested: typeof data.modelRequested === 'string' ? data.modelRequested : selectedModel,
    modelUsed: typeof data.modelUsed === 'string' ? data.modelUsed : selectedModel,
    fallbackUsed: data.fallbackUsed === true,
    requestId: typeof data.requestId === 'string' ? data.requestId : '',
    emptyTranscript: !String(data.transcript || '').trim(),
    roleReceived: typeof data.roleReceived === 'string' ? data.roleReceived : options.role,
    languageReceived: typeof data.languageReceived === 'string' ? data.languageReceived : options.language,
    contentTypeReceived: typeof data.contentTypeReceived === 'string' ? data.contentTypeReceived : mimeType,
    transcriptProviderUsed: typeof data.transcriptProviderUsed === 'string' ? data.transcriptProviderUsed : transcriptProvider,
  } as TranscriptResult;
}

export async function getDeepgramAccessToken() {
  if (!DEEPGRAM_TOKEN_URL) {
    throw new Error('VITE_DEEPGRAM_TOKEN_URL is not configured.');
  }

  const config = loadAdminRuntimeConfig();
  const response = await fetch(DEEPGRAM_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.deepgramApiKey ? { 'x-deepgram-api-key': config.deepgramApiKey } : {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Could not create Deepgram access token');
  }

  const accessToken = typeof data.accessToken === 'string' ? data.accessToken : '';
  if (!accessToken) {
    throw new Error('Deepgram access token was empty');
  }

  return {
    accessToken,
    expiresIn: Number(data.expiresIn || 0),
  };
}
