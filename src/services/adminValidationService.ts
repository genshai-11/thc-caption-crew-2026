import { loadAdminRuntimeConfig } from '@/services/adminConfigRepository';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export interface RouterModelInfo {
  id: string;
  object?: string;
  owned_by?: string;
}

export async function fetchRouterModels() {
  const config = loadAdminRuntimeConfig();
  if (!API_BASE_URL) throw new Error('VITE_API_BASE_URL is not configured.');

  const response = await fetch(`${API_BASE_URL}/fetchRouterModels`, {
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

export async function testRouterCompletion() {
  const config = loadAdminRuntimeConfig();
  if (!API_BASE_URL) throw new Error('VITE_API_BASE_URL is not configured.');

  const response = await fetch(`${API_BASE_URL}/testRouterCompletion`, {
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
