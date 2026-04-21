import { loadAdminRuntimeConfig } from '@/services/adminConfigRepository';
import { TranscriptResult } from '@/types';

const TRANSCRIBE_URL = import.meta.env.DEV ? '/api/transcribeRoundAudio' : (import.meta.env.VITE_TRANSCRIBE_URL || '');
const DEEPGRAM_TOKEN_URL = import.meta.env.DEV ? '/api/getDeepgramAccessToken' : (import.meta.env.VITE_DEEPGRAM_TOKEN_URL || '');

export async function transcribeRoundAudio(
  audioBlob: Blob,
  options: {
    role: 'captain' | 'crew';
    language: 'vi' | 'en';
    providerOverride?: 'deepgram' | 'google' | 'thirdparty';
    deepgramModelOverride?: string;
    googleModelOverride?: string;
    googleProjectIdOverride?: string;
    googleLocationOverride?: string;
    thirdPartyTranscriptModelOverride?: string;
    deepgramApiKeyOverride?: string;
    googleApiKeyOverride?: string;
    thirdPartyTranscriptApiKeyOverride?: string;
    thirdPartyTranscriptUrlOverride?: string;
    thirdPartyTranscriptAuthSchemeOverride?: 'none' | 'bearer' | 'x-api-key';
    preferServerConfig?: boolean;
  },
) {
  if (!TRANSCRIBE_URL) {
    throw new Error('VITE_TRANSCRIBE_URL is not configured.');
  }

  const config = loadAdminRuntimeConfig();
  const transcriptProvider = options.providerOverride || config.transcriptProvider || 'deepgram';
  const selectedDeepgramModel = options.deepgramModelOverride || (options.role === 'captain' ? config.captainDeepgramModel : config.crewDeepgramModel);
  const selectedGoogleModel = options.googleModelOverride || config.googleTranscriptModel || 'chirp_3';
  const selectedGoogleProjectId = options.googleProjectIdOverride || config.googleCloudProjectId || '';
  const selectedGoogleLocation = options.googleLocationOverride || config.googleTranscriptLocation || 'global';
  const selectedThirdPartyModel = options.thirdPartyTranscriptModelOverride || config.thirdPartyTranscriptModel || '';
  const selectedModel = transcriptProvider === 'google'
    ? selectedGoogleModel
    : transcriptProvider === 'thirdparty'
      ? selectedThirdPartyModel
      : selectedDeepgramModel;

  const mimeType = audioBlob.type || 'audio/webm;codecs=opus';
  const preferServerConfig = options.preferServerConfig === true;
  const headers: Record<string, string> = {
    'Content-Type': mimeType,
  };

  const hasAnyOverride = !!(
    options.providerOverride ||
    options.deepgramModelOverride ||
    options.googleModelOverride ||
    options.googleProjectIdOverride ||
    options.googleLocationOverride ||
    options.thirdPartyTranscriptModelOverride ||
    options.deepgramApiKeyOverride ||
    options.googleApiKeyOverride ||
    options.thirdPartyTranscriptApiKeyOverride ||
    options.thirdPartyTranscriptUrlOverride ||
    options.thirdPartyTranscriptAuthSchemeOverride
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
    if (selectedGoogleProjectId) {
      headers['x-google-project-id'] = selectedGoogleProjectId;
    }
    if (selectedGoogleLocation) {
      headers['x-google-location'] = selectedGoogleLocation;
    }
    const googleApiKey = options.googleApiKeyOverride || config.googleApiKey;
    if (googleApiKey) {
      headers['x-google-api-key'] = googleApiKey;
    }

    if (selectedThirdPartyModel) {
      headers['x-thirdparty-transcript-model'] = selectedThirdPartyModel;
    }
    const thirdPartyApiKey = options.thirdPartyTranscriptApiKeyOverride || config.thirdPartyTranscriptApiKey;
    if (thirdPartyApiKey) {
      headers['x-thirdparty-transcript-api-key'] = thirdPartyApiKey;
    }
    const thirdPartyUrl = options.thirdPartyTranscriptUrlOverride || config.thirdPartyTranscriptUrl;
    if (thirdPartyUrl) {
      headers['x-thirdparty-transcript-url'] = thirdPartyUrl;
    }
    const thirdPartyAuthScheme = options.thirdPartyTranscriptAuthSchemeOverride || config.thirdPartyTranscriptAuthScheme;
    if (thirdPartyAuthScheme) {
      headers['x-thirdparty-transcript-auth-scheme'] = thirdPartyAuthScheme;
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
