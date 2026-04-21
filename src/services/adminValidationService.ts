import { loadAdminRuntimeConfig } from '@/services/adminConfigRepository';

const FETCH_MODELS_URL = import.meta.env.DEV ? '/api/fetchRouterModels' : (import.meta.env.VITE_FETCH_MODELS_URL || '');
const TEST_ROUTER_URL = import.meta.env.DEV ? '/api/testRouterCompletion' : (import.meta.env.VITE_TEST_ROUTER_URL || '');
const FETCH_GOOGLE_STT_MODELS_URL = import.meta.env.DEV ? '/api/fetchGoogleSttModels' : (import.meta.env.VITE_FETCH_GOOGLE_STT_MODELS_URL || '');
const TEST_GOOGLE_STT_MODELS_URL = import.meta.env.DEV ? '/api/testGoogleSttModels' : (import.meta.env.VITE_TEST_GOOGLE_STT_MODELS_URL || '');

export interface RouterModelInfo {
  id: string;
  object?: string;
  owned_by?: string;
}

export interface GoogleSttModelInfo {
  id: string;
  label?: string;
  category?: string;
  recommended?: boolean;
  description?: string;
}

export interface GoogleSttModelTestResult {
  model: string;
  ok: boolean;
  transcript: string;
  emptyTranscript: boolean;
  confidence: number;
  duration: number;
  elapsedMs: number;
  requestId?: string;
  error?: string;
}

export async function fetchRouterModels() {
  const config = loadAdminRuntimeConfig();
  if (!FETCH_MODELS_URL) throw new Error('VITE_FETCH_MODELS_URL is not configured.');

  const response = await fetch(FETCH_MODELS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      routerApiKey: config.router9ApiKey,
      routerBaseUrl: config.router9BaseUrl,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to fetch Router9 models');
  return Array.isArray(data.models) ? data.models as RouterModelInfo[] : [];
}

export async function fetchGoogleSttModels() {
  if (!FETCH_GOOGLE_STT_MODELS_URL) throw new Error('VITE_FETCH_GOOGLE_STT_MODELS_URL is not configured.');

  const response = await fetch(FETCH_GOOGLE_STT_MODELS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to fetch Google STT models');
  return {
    models: Array.isArray(data.models) ? data.models as GoogleSttModelInfo[] : [],
    recommendedModel: typeof data.recommendedModel === 'string' ? data.recommendedModel : 'chirp_3',
    configuredModel: typeof data.configuredModel === 'string' ? data.configuredModel : '',
  };
}

export async function testGoogleSttModels(
  audioBlob: Blob,
  options: {
    language: 'vi' | 'en';
    role: 'captain' | 'crew';
    googleApiKey: string;
    googleProjectId?: string;
    googleLocation?: string;
    models?: string[];
  },
) {
  if (!TEST_GOOGLE_STT_MODELS_URL) throw new Error('VITE_TEST_GOOGLE_STT_MODELS_URL is not configured.');

  const headers: Record<string, string> = {
    'Content-Type': audioBlob.type || 'audio/webm;codecs=opus',
    ...(options.googleApiKey ? { 'x-google-api-key': options.googleApiKey } : {}),
    ...(options.googleProjectId ? { 'x-google-project-id': options.googleProjectId } : {}),
    ...(options.googleLocation ? { 'x-google-location': options.googleLocation } : {}),
    ...(Array.isArray(options.models) && options.models.length > 0 ? { 'x-google-models': options.models.join(',') } : {}),
  };

  const response = await fetch(`${TEST_GOOGLE_STT_MODELS_URL}?role=${options.role}&language=${options.language}`, {
    method: 'POST',
    headers,
    body: audioBlob,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Google STT model tests failed');

  return {
    role: typeof data.role === 'string' ? data.role : options.role,
    language: typeof data.language === 'string' ? data.language : options.language,
    totalModels: Number(data.totalModels || 0),
    passedModels: Array.isArray(data.passedModels) ? data.passedModels as string[] : [],
    elapsedMs: Number(data.elapsedMs || 0),
    results: Array.isArray(data.results) ? data.results as GoogleSttModelTestResult[] : [],
  };
}

export async function testRouterCompletion() {
  const config = loadAdminRuntimeConfig();
  if (!TEST_ROUTER_URL) throw new Error('VITE_TEST_ROUTER_URL is not configured.');

  const response = await fetch(TEST_ROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      routerApiKey: config.router9ApiKey,
      routerBaseUrl: config.router9BaseUrl,
      model: config.router9Model,
      fallbackModel: config.router9FallbackModel,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Router9 test failed');
  return data;
}
