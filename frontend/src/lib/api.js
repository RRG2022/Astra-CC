export const BASE_URL = 'http://localhost:8789';
const TOKEN = import.meta.env.VITE_ASTRA_TOKEN || '';

export async function apiFetch(path, options = {}) {
  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${TOKEN}`
  };
  return fetch(`${BASE_URL}${path}`, { ...options, headers });
}

export function getAuthToken() {
  return TOKEN;
}

export function getWsUrl(path) {
  const url = new URL(`ws://localhost:8789${path}`);
  url.searchParams.set('token', TOKEN);
  return url.toString();
}

export function getSseUrl(path) {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('token', TOKEN);
  return url.toString();
}
