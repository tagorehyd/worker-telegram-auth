export const SESSION_SECONDS = 20 * 60;
export const PENDING_MS = 2 * 60 * 1000;
export const SESSION_MS = SESSION_SECONDS * 1000;
export function json(
  data: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}
export function parseCookies(value: string | null): Record<string, string> {
  return Object.fromEntries(
    (value ?? "")
      .split(";")
      .map((v) => v.trim().split(/=(.*)/s, 2))
      .filter(([k]) => k)
      .map(([k, v]) => [k, decodeURIComponent(v ?? "")]),
  );
}
export function secureEqual(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        char
      ]!,
  );
}
export function cookie(
  name: string,
  value: string,
  maxAge = SESSION_SECONDS,
  httpOnly = false,
): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; Secure; SameSite=Lax${httpOnly ? "; HttpOnly" : ""}`;
}
