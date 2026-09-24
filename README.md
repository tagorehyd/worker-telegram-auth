# Telegram-approved Cloudflare Worker reverse proxy

This repository deploys a streaming reverse proxy guarded by a **single global**, SQLite-backed Durable Object session. New browser/device access requires an inline Telegram approval. The existing active browser is displaced as soon as another request is approved. This is suitable for a personal Jellyfin or web-service proxy, not as a replacement for upstream authorization.

## What is included

- `AuthManager` is a new SQLite Durable Object provisioned declaratively by `wrangler.jsonc`; no Dashboard Durable Object creation is needed.
- One object is always addressed as `env.AUTH_MANAGER.getByName("global")`.
- Session state stays in Durable Object storage, lasts 20 minutes, and slides on every authenticated request.
- Identity validation compares Worker-observed public IP, User-Agent, the persistent browser client ID, and platform. Browser details beyond these are informational, not cryptographic proof.
- Proxy requests retain their method, headers, body stream, path, query string, Range requests, and upgrade headers. Responses are returned directly without response buffering or caching.

## Files

```text
.
├── src/
│   ├── auth-manager.ts       # SQLite-backed global session/pending request state
│   ├── identity.ts           # bounded browser data and identity checks
│   ├── index.ts              # Worker routes and access flow
│   ├── page.ts               # dependency-free approval page
│   ├── proxy.ts              # streaming reverse proxy
│   ├── telegram.ts           # Bot API calls and message editing
│   ├── types.ts
│   └── util.ts
├── test/core.test.ts
├── package.json
├── tsconfig.json
└── wrangler.jsonc
```

## Local setup

1. Install Node.js 20+ and run `npm install`.
2. Edit **only the placeholder** `UPSTREAM_URL` in `wrangler.jsonc` for local/default deployment, e.g. `https://jellyfin.example.net`. It must be an absolute HTTPS URL. For an operational secret/private origin, prefer setting `UPSTREAM_URL` as a Worker variable in the Dashboard instead.
3. Authenticate with `npx wrangler login` and run `npm run typecheck`, `npm test`, then `npx wrangler deploy`.
4. Set secrets before real traffic (below). A deployment without the Telegram secrets cannot approve new sessions.

## Cloudflare Dashboard settings

1. In **Workers & Pages → Create application → Workers → Import a repository**, select this GitHub repository.
2. Select the branch you want released (normally `main`; use your protected production branch if it differs). Cloudflare Workers Builds will redeploy that branch on each push.
3. Build command: `npm install && npm run typecheck && npm test`.
4. Deploy command: `npx wrangler deploy`. The root directory is the repository root.
5. Under **Settings → Variables and Secrets**, add a plaintext variable named `UPSTREAM_URL` with your full origin URL. Dashboard variables override the checked-in placeholder.
6. Add these three **encrypted secrets** (not variables): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `TELEGRAM_WEBHOOK_SECRET`. Alternatively run `npx wrangler secret put TELEGRAM_BOT_TOKEN`, `npx wrangler secret put TELEGRAM_CHAT_ID`, and `npx wrangler secret put TELEGRAM_WEBHOOK_SECRET` locally.
7. Deploy once. Wrangler reads the `durable_objects.bindings` and `migrations` entry and creates the new SQLite-backed `AuthManager` namespace automatically. In **Workers & Pages → your worker → Bindings**, verify `AUTH_MANAGER` is listed as a Durable Object binding. Do not add a namespace manually.
8. Add a custom hostname from **Workers & Pages → your worker → Settings → Domains & Routes → Add**. Use that HTTPS hostname as `<WORKER-DOMAIN>` below.

## Telegram setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token into the `TELEGRAM_BOT_TOKEN` secret.
2. Send the bot a message, then call `getUpdates` with your token locally and read `message.chat.id`; put that numeric value (including a leading `-` for groups) in `TELEGRAM_CHAT_ID`. Do not commit either value.
3. **Create the webhook secret.** This is a random shared password between Telegram and this Worker; it is **not** your bot token and it is not a URL. Generate it once on your own computer:

   ```bash
   openssl rand -hex 32
   ```

   Copy the single 64-character output immediately. Keep it private; anyone who knows both the Worker URL and this secret could imitate Telegram's webhook header.

4. **Store that exact value in Cloudflare.** In **Workers & Pages → your Worker → Settings → Variables and Secrets**, click **Add**, choose **Secret**, name it `TELEGRAM_WEBHOOK_SECRET`, paste the generated value, and save/deploy. You can instead run this command and paste the generated value when prompted (the value is not echoed):

   ```bash
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
   ```

5. **Tell Telegram the same value.** After the Worker is live, run the following command in a terminal. Replace the three placeholders locally. The value passed as `secret_token` must be exactly the same value stored in the Worker in step 4:

   ```bash
   curl -fsS -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
     --data-urlencode "url=https://<WORKER-DOMAIN>/__access/telegram" \
     --data-urlencode "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
     --data-urlencode 'allowed_updates=["callback_query"]'
   ```

6. **What happens next.** Telegram saves the URL and shared secret. On every later callback it sends the secret in `X-Telegram-Bot-Api-Secret-Token`. The Worker compares that header to its `TELEGRAM_WEBHOOK_SECRET` using a constant-time comparison before it reads the Telegram action, and then separately checks `TELEGRAM_CHAT_ID`.

### Rotate or troubleshoot the webhook secret

If you believe the secret was exposed, generate a new one, replace the Worker secret, deploy, then run `setWebhook` again with the new exact value. During the short period between those two actions Telegram callbacks will return `401`; this is expected. To verify Telegram accepted the configuration without revealing the secret, run:

```bash
curl -fsS "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

Confirm that `url` is `https://<WORKER-DOMAIN>/__access/telegram` and review `last_error_message` if callbacks are not arriving. Never paste your bot token or webhook secret into Git, issues, chat messages, or screenshots.

## Test the flow

Open the Worker URL in a normal browser. It redirects to `/__access`, generates/reuses a localStorage browser ID, sends the details to the Worker, and waits. Press **Approve** in Telegram; the page reloads the original URL with the HttpOnly `__Host-proxy_session` cookie. Press **Deny** to refuse it. Only one pending request exists globally; a second device is told to wait rather than causing Telegram spam. Pending requests expire after about two minutes. A new approval replaces the old global session.

Non-GET/HEAD clients receive `401` without their request body being read. Authenticate in a browser first. Cookie attributes are `__Host-`, `Path=/`, `HttpOnly`, `Secure`, `SameSite=Lax`, and `Max-Age=1200`; session tokens never enter localStorage.

## Operations and troubleshooting

- To change origins, change the `UPSTREAM_URL` Worker variable and redeploy. Keep the origin scheme/host only; all incoming paths and query strings are preserved.
- To update safely, use a branch/preview, run the commands below, merge into the selected production branch, then let Workers Builds deploy. Do not remove or rename the existing `v1` migration after production deployment.
- If deployment says the class or binding is unknown, ensure `AuthManager` is exported from `src/index.ts`, `AUTH_MANAGER` is spelled identically in code/configuration, and deploy with the current `wrangler.jsonc`. Do **not** create an old namespace or use `new_classes`; `new_sqlite_classes` is required for this new SQLite class.
- If buttons do nothing, check the webhook URL is public HTTPS, compare the secret exactly, run `getWebhookInfo`, and ensure the approved chat ID is correct.
- If requests keep prompting, check IP/UA/client/platform cookies are not changing (VPNs and privacy tools can cause this), and use the same HTTPS hostname. This deliberate binding is why an old device loses access after a replacement approval.

## Commands

```bash
npm install
npm run typecheck
npm run lint
npm test
npx wrangler deploy --dry-run
npx wrangler deploy
```
