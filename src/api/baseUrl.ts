const DEFAULT_API_BASE_URL = '/api/v1';

export function getApiBaseUrl(): string {
  const configuredBaseUrl = import.meta.env?.VITE_API_URL;
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  return DEFAULT_API_BASE_URL;
}

export function joinApiBaseUrl(baseUrl: string, endpoint: string): string {
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  return `${normalizedBaseUrl}${normalizedEndpoint}`;
}
