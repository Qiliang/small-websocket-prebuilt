/** Basic auth from Vite env. Values live in gitignored client/.env.local. */
export function basicAuthHeaders(
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const username = import.meta.env.VITE_AUTH_USERNAME ?? "";
  const password = import.meta.env.VITE_AUTH_PASSWORD ?? "";
  if (!username && !password) return headers;
  headers.Authorization = `Basic ${btoa(`${username}:${password}`)}`;
  return headers;
}
