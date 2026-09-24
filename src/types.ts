export interface Env {
  AUTH_MANAGER: DurableObjectNamespace;
  UPSTREAM_URL: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  TELEGRAM_WEBHOOK_SECRET: string;
}
export interface BrowserInfo {
  clientId: string;
  platform: string;
  browser: string;
  language: string;
  timezone: string;
  screen: string;
  dpr: string;
  cores: string;
  memory: string;
  touchPoints: string;
}
export interface Identity {
  ip: string;
  userAgent: string;
  clientId: string;
  platform: string;
}
export interface Session extends Identity {
  token: string;
  expiresAt: number;
}
export interface Pending extends Identity, BrowserInfo {
  id: string;
  path: string;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "approved" | "denied";
  telegramMessageId?: number;
}
