import type { BrowserInfo, Identity } from "./types";
import { parseCookies } from "./util";
// Browser input is normalized before inclusion in Telegram HTML.
/* eslint-disable no-control-regex */
const LIMITS: Record<keyof BrowserInfo, number> = {
  clientId: 128,
  platform: 160,
  browser: 200,
  language: 64,
  timezone: 100,
  screen: 50,
  dpr: 32,
  cores: 20,
  memory: 20,
  touchPoints: 20,
};
export function publicIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP")?.slice(0, 64) || "unknown";
}
export function requestIdentity(request: Request): Identity {
  const c = parseCookies(request.headers.get("cookie"));
  return {
    ip: publicIp(request),
    userAgent: (request.headers.get("user-agent") ?? "").slice(0, 512),
    clientId: c["__Host-proxy_client"] ?? "",
    platform: c["__Host-proxy_platform"] ?? "",
  };
}
export function validateBrowserInfo(input: unknown): BrowserInfo | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const out = {} as BrowserInfo;
  for (const [key, limit] of Object.entries(LIMITS) as [
    keyof BrowserInfo,
    number,
  ][]) {
    const value = source[key];
    if (typeof value !== "string" || !value || value.length > limit)
      return null;
    out[key] = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  }
  return /^[a-zA-Z0-9_-]{20,128}$/.test(out.clientId) ? out : null;
}
export function sameIdentity(a: Identity, b: Identity): boolean {
  return (
    a.ip === b.ip &&
    a.userAgent === b.userAgent &&
    a.clientId === b.clientId &&
    a.platform === b.platform
  );
}
