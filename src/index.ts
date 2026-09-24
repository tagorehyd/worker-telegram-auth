import { AuthManager } from "./auth-manager";
import { requestIdentity, sameIdentity, validateBrowserInfo } from "./identity";
import { accessPage } from "./page";
import { proxyRequest } from "./proxy";
import {
  answerCallback,
  sendApproval,
  updateApprovalMessage,
} from "./telegram";
import type { Env, Pending, Session } from "./types";
import { cookie, json, parseCookies, secureEqual } from "./util";
export { AuthManager };
const manager = (env: Env) => env.AUTH_MANAGER.getByName("global");
async function doCall<T>(env: Env, path: string, body?: unknown): Promise<T> {
  const r = await manager(env).fetch(
    `https://auth-manager${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  return r.json() as Promise<T>;
}
async function validSession(
  request: Request,
  env: Env,
): Promise<Session | null> {
  const session = await doCall<Session | null>(env, "/session");
  const token = parseCookies(request.headers.get("cookie"))[
    "__Host-proxy_session"
  ];
  if (
    !session ||
    !token ||
    !secureEqual(token, session.token) ||
    !sameIdentity(requestIdentity(request), session)
  )
    return null;
  return doCall<Session | null>(env, "/touch");
}
function html(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}
async function client(request: Request, env: Env): Promise<Response> {
  const data = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const info = validateBrowserInfo(data);
  const path =
    typeof data?.path === "string" &&
    data.path.startsWith("/") &&
    !data.path.startsWith("//") &&
    data.path.length <= 2048
      ? data.path
      : null;
  if (!info || !path)
    return json({ error: "Invalid browser information" }, 400);
  const identity = {
    ...requestIdentity(request),
    clientId: info.clientId,
    platform: info.platform,
  };
  const old = await doCall<Pending | null>(env, "/pending");
  if (old?.status === "pending" && !sameIdentity(old, identity))
    return json({ error: "Another device approval is pending" }, 409);
  const pending = await doCall<Pending>(env, "/create", {
    ...info,
    ...identity,
    path,
  });
  if (!old || old.status !== "pending") {
    const messageId = await sendApproval(env, pending);
    if (messageId)
      await doCall(env, "/telegram-message", { id: pending.id, messageId });
  }
  const response = json({ id: pending.id }, 201);
  response.headers.append(
    "set-cookie",
    cookie("__Host-proxy_client", info.clientId, 60 * 60 * 24 * 365),
  );
  response.headers.append(
    "set-cookie",
    cookie("__Host-proxy_platform", info.platform, 60 * 60 * 24 * 365),
  );
  return response;
}
async function status(request: Request, env: Env): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  const pending = await doCall<Pending | null>(env, "/pending");
  if (!id || !pending || pending.id !== id) return json({ status: "expired" });
  if (!sameIdentity(pending, requestIdentity(request)))
    return json({ status: "expired" });
  return json({ status: pending.status });
}
async function telegram(request: Request, env: Env): Promise<Response> {
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (
    !env.TELEGRAM_WEBHOOK_SECRET ||
    !secureEqual(secret, env.TELEGRAM_WEBHOOK_SECRET)
  )
    return new Response("Unauthorized", { status: 401 });
  const update = (await request.json().catch(() => null)) as {
    callback_query?: {
      id?: string;
      data?: string;
      message?: { chat?: { id?: number | string } };
    };
  } | null;
  const cb = update?.callback_query;
  const chatId = cb?.message?.chat?.id;
  if (!cb?.id || String(chatId) !== env.TELEGRAM_CHAT_ID)
    return new Response("Forbidden", { status: 403 });
  const matched = /^(approve|deny):([0-9a-f-]{36})$/.exec(cb.data ?? "");
  if (!matched) {
    await answerCallback(env, cb.id, "Invalid approval request.");
    return new Response("OK");
  }
  const [, action, id] = matched;
  if (action === "approve") {
    const result = await doCall<{ pending: Pending; session: Session } | null>(
      env,
      "/approve",
      { id },
    );
    if (!result) {
      await answerCallback(
        env,
        cb.id,
        "This request expired or was already used.",
      );
      return new Response("OK");
    }
    await updateApprovalMessage(env, result.pending, "APPROVED");
    await answerCallback(env, cb.id, "Approved.");
  } else {
    const p = await doCall<Pending | null>(env, "/deny", { id });
    if (!p) {
      await answerCallback(
        env,
        cb.id,
        "This request expired or was already used.",
      );
      return new Response("OK");
    }
    await updateApprovalMessage(env, p, "DENIED");
    await answerCallback(env, cb.id, "Denied.");
  }
  return new Response("OK");
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__access") {
      const next = url.searchParams.get("next") || "/";
      return html(
        accessPage(next.startsWith("/") && !next.startsWith("//") ? next : "/"),
      );
    }
    if (url.pathname === "/__access/client" && request.method === "POST")
      return client(request, env);
    if (url.pathname === "/__access/status" && request.method === "GET")
      return status(request, env);
    if (url.pathname === "/__access/telegram" && request.method === "POST")
      return telegram(request, env);
    if (url.pathname.startsWith("/__access"))
      return new Response("Not found", { status: 404 });
    if (await validSession(request, env)) return proxyRequest(request, env);
    if (request.method === "GET" || request.method === "HEAD")
      return Response.redirect(
        new URL(
          `/__access?next=${encodeURIComponent(url.pathname + url.search)}`,
          url.origin,
        ).toString(),
        302,
      );
    return json(
      { error: "Authentication required. Open this URL in a browser first." },
      401,
    );
  },
} satisfies ExportedHandler<Env>;
