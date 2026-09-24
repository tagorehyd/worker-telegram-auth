import type { Pending, Session } from "./types";
import { PENDING_MS, SESSION_MS } from "./util";
export class AuthManager implements DurableObject {
  constructor(private state: DurableObjectState) {}
  async getSession(): Promise<Session | null> {
    const s = await this.state.storage.get<Session>("session");
    if (!s) return null;
    if (s.expiresAt <= Date.now()) {
      await this.clearSession();
      return null;
    }
    return s;
  }
  async touchSession(): Promise<Session | null> {
    const s = await this.getSession();
    if (!s) return null;
    s.expiresAt = Date.now() + SESSION_MS;
    await this.state.storage.put("session", s);
    return s;
  }
  async clearSession(): Promise<void> {
    await this.state.storage.delete("session");
  }
  async getPending(): Promise<Pending | null> {
    const p = await this.state.storage.get<Pending>("pending");
    if (!p) return null;
    if (p.status === "pending" && p.expiresAt <= Date.now()) {
      await this.clearPending();
      return null;
    }
    return p;
  }
  async createApproval(
    input: Omit<Pending, "id" | "createdAt" | "expiresAt" | "status">,
  ): Promise<Pending> {
    const existing = await this.getPending();
    if (existing?.status === "pending") return existing;
    const now = Date.now();
    const pending: Pending = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      expiresAt: now + PENDING_MS,
      status: "pending",
    };
    await this.state.storage.put("pending", pending);
    return pending;
  }
  async approve(
    id: string,
  ): Promise<{ pending: Pending; session: Session } | null> {
    const p = await this.getPending();
    if (
      !p ||
      p.status !== "pending" ||
      p.id !== id ||
      p.expiresAt <= Date.now()
    )
      return null;
    const session: Session = {
      ip: p.ip,
      userAgent: p.userAgent,
      clientId: p.clientId,
      platform: p.platform,
      token: crypto.randomUUID(),
      expiresAt: Date.now() + SESSION_MS,
    };
    p.status = "approved";
    await this.state.storage.put({ session, pending: p });
    return { pending: p, session };
  }
  async deny(id: string): Promise<Pending | null> {
    const p = await this.getPending();
    if (!p || p.status !== "pending" || p.id !== id) return null;
    p.status = "denied";
    await this.state.storage.put("pending", p);
    return p;
  }
  async clearPending(): Promise<void> {
    await this.state.storage.delete("pending");
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const body =
      request.method === "POST"
        ? ((await request.json().catch(() => null)) as Record<
            string,
            unknown
          > | null)
        : null;
    let result: unknown;
    switch (url.pathname) {
      case "/session":
        result = await this.getSession();
        break;
      case "/touch":
        result = await this.touchSession();
        break;
      case "/pending":
        result = await this.getPending();
        break;
      case "/create":
        result = body
          ? await this.createApproval(
              body as Omit<
                Pending,
                "id" | "createdAt" | "expiresAt" | "status"
              >,
            )
          : null;
        break;
      case "/approve":
        result =
          typeof body?.id === "string" ? await this.approve(body.id) : null;
        break;
      case "/deny":
        result = typeof body?.id === "string" ? await this.deny(body.id) : null;
        break;
      case "/telegram-message": {
        const p = await this.getPending();
        if (p && body?.id === p.id && typeof body.messageId === "number") {
          p.telegramMessageId = body.messageId;
          await this.state.storage.put("pending", p);
          result = p;
        } else result = null;
        break;
      }
      default:
        return new Response("Not found", { status: 404 });
    }
    return new Response(JSON.stringify(result), {
      headers: { "content-type": "application/json" },
    });
  }
}
