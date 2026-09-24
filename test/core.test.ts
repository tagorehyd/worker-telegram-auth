import { describe, expect, it, vi } from "vitest";
import { AuthManager } from "../src/auth-manager";
import { sameIdentity, validateBrowserInfo } from "../src/identity";
import { proxyRequest } from "../src/proxy";
import type { BrowserInfo, Identity } from "../src/types";
class MemoryStorage {
  data = new Map<string, unknown>();
  async get<T>(key: string) {
    return this.data.get(key) as T | undefined;
  }
  async put(key: string | Record<string, unknown>, value?: unknown) {
    if (typeof key === "string") this.data.set(key, value);
    else Object.entries(key).forEach(([k, v]) => this.data.set(k, v));
  }
  async delete(key: string) {
    this.data.delete(key);
  }
}
const info: BrowserInfo = {
  clientId: "a".repeat(32),
  platform: "Linux",
  browser: "Firefox",
  language: "en",
  timezone: "UTC",
  screen: "1x1",
  dpr: "1",
  cores: "2",
  memory: "2",
  touchPoints: "0",
};
const identity: Identity = {
  ip: "203.0.113.8",
  userAgent: "UA",
  clientId: info.clientId,
  platform: info.platform,
};
function manager() {
  return new AuthManager({
    storage: new MemoryStorage(),
  } as unknown as DurableObjectState);
}
describe("AuthManager global session state", () => {
  it("has no session initially and approves a pending request", async () => {
    const m = manager();
    expect(await m.getSession()).toBeNull();
    const p = await m.createApproval({ ...info, ...identity, path: "/" });
    const approved = await m.approve(p.id);
    expect(approved?.session.clientId).toBe(info.clientId);
    expect(await m.getSession()).not.toBeNull();
  });
  it("denies, expires, and replaces global sessions", async () => {
    const m = manager();
    const denied = await m.createApproval({ ...info, ...identity, path: "/" });
    expect((await m.deny(denied.id))?.status).toBe("denied");
    const expired = await m.createApproval({ ...info, ...identity, path: "/" });
    expired.expiresAt = Date.now() - 1;
    expect(await m.approve(expired.id)).toBeNull();
    const one = await m.createApproval({ ...info, ...identity, path: "/" });
    await m.approve(one.id);
    const two = await m.createApproval({
      ...info,
      ...identity,
      clientId: "b".repeat(32),
      path: "/new",
    });
    await m.approve(two.id);
    expect((await m.getSession())?.clientId).toBe("b".repeat(32));
  });
});
describe("identity validation", () => {
  it("rejects wrong IP, client id, and user-agent", () => {
    expect(sameIdentity(identity, { ...identity, ip: "203.0.113.9" })).toBe(
      false,
    );
    expect(
      sameIdentity(identity, { ...identity, clientId: "b".repeat(32) }),
    ).toBe(false);
    expect(sameIdentity(identity, { ...identity, userAgent: "other" })).toBe(
      false,
    );
  });
  it("limits untrusted browser fields", () => {
    expect(validateBrowserInfo(info)).toEqual(info);
    expect(validateBrowserInfo({ ...info, clientId: "bad" })).toBeNull();
  });
});
describe("streaming proxy", () => {
  it("preserves POST, Range, and Upgrade request headers", async () => {
    const mock = vi.fn(async (r: Request) => new Response(r.body));
    vi.stubGlobal("fetch", mock);
    const request = new Request("https://worker.example/video?a=1", {
      method: "POST",
      headers: { Range: "bytes=0-5", Upgrade: "websocket" },
      body: "data",
      duplex: "half",
    } as RequestInit);
    await proxyRequest(request, {
      UPSTREAM_URL: "https://origin.example/base",
    } as never);
    const sent = mock.mock.calls[0][0] as Request;
    expect(sent.url).toBe("https://origin.example/video?a=1");
    expect(sent.headers.get("range")).toBe("bytes=0-5");
    expect(sent.headers.get("upgrade")).toBe("websocket");
    expect(await sent.text()).toBe("data");
    vi.unstubAllGlobals();
  });
});
