import type { Env, Pending } from "./types";
import { escapeHtml } from "./util";
const api = (env: Env, method: string) =>
  `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
async function call(
  env: Env,
  method: string,
  payload: unknown,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(api(env, method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.ok
    ? ((await response.json()) as Record<string, unknown>)
    : null;
}
function message(p: Pending, state = "PENDING"): string {
  return `<b>Proxy access ${state}</b>\nRequest: <code>${escapeHtml(p.id)}</code>\nIP: <code>${escapeHtml(p.ip)}</code>\nBrowser: ${escapeHtml(p.browser)}\nPlatform: ${escapeHtml(p.platform)}\nUA: <code>${escapeHtml(p.userAgent)}</code>\nLanguage: ${escapeHtml(p.language)}\nTimezone: ${escapeHtml(p.timezone)}\nScreen: ${escapeHtml(p.screen)} @ ${escapeHtml(p.dpr)}x\nCPU: ${escapeHtml(p.cores)}; Memory: ${escapeHtml(p.memory)}; Touch: ${escapeHtml(p.touchPoints)}\nClient: <code>${escapeHtml(p.clientId)}</code>\nPath: <code>${escapeHtml(p.path)}</code>\nAt: ${new Date(p.createdAt).toISOString()}`;
}
export async function sendApproval(
  env: Env,
  p: Pending,
): Promise<number | undefined> {
  const result = await call(env, "sendMessage", {
    chat_id: env.TELEGRAM_CHAT_ID,
    text: message(p),
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Approve", callback_data: `approve:${p.id}` },
          { text: "Deny", callback_data: `deny:${p.id}` },
        ],
      ],
    },
  });
  const msg = result?.result as Record<string, unknown> | undefined;
  return typeof msg?.message_id === "number" ? msg.message_id : undefined;
}
export async function updateApprovalMessage(
  env: Env,
  p: Pending,
  state: "APPROVED" | "DENIED" | "EXPIRED",
): Promise<void> {
  if (!p.telegramMessageId) return;
  await call(env, "editMessageText", {
    chat_id: env.TELEGRAM_CHAT_ID,
    message_id: p.telegramMessageId,
    text: message(p, state),
    parse_mode: "HTML",
  });
}
export async function answerCallback(
  env: Env,
  callbackId: string,
  text: string,
): Promise<void> {
  await call(env, "answerCallbackQuery", {
    callback_query_id: callbackId,
    text,
  });
}
