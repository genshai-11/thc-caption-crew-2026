export interface AdminRuntimeConfig {
  deepgramApiKey: string;
  captainDeepgramModel: string;
  crewDeepgramModel: string;
  router9ApiKey: string;
  router9BaseUrl: string;
  router9Model: string;
  router9FallbackModel: string;
}

const STORAGE_KEY = 'caption-crew-admin-runtime-config';

export const defaultAdminRuntimeConfig: AdminRuntimeConfig = {
  deepgramApiKey: '',
  captainDeepgramModel: 'nova-2',
  crewDeepgramModel: 'nova-2',
  router9ApiKey: '',
  router9BaseUrl: 'https://rqlaeq5.9router.com/v1',
  router9Model: '',
  router9FallbackModel: '',
};

export function loadAdminRuntimeConfig(): AdminRuntimeConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultAdminRuntimeConfig;
    return { ...defaultAdminRuntimeConfig, ...JSON.parse(raw) };
  } catch {
    return defaultAdminRuntimeConfig;
  }
}

export function saveAdminRuntimeConfig(config: AdminRuntimeConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}
