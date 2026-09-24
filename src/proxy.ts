import type { Env } from "./types";
export async function proxyRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  let upstream: URL;
  try {
    upstream = new URL(env.UPSTREAM_URL);
  } catch {
    return new Response("UPSTREAM_URL is not configured", { status: 500 });
  }
  const incoming = new URL(request.url);
  upstream.pathname = incoming.pathname;
  upstream.search = incoming.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("cookie");
  headers.delete("cf-connecting-ip");
  headers.set("host", upstream.host);
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }
  return fetch(new Request(upstream.toString(), init));
}
