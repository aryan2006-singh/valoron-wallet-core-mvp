# n8n automations

Two ready-to-import [n8n](https://n8n.io) workflows that run alongside the wallet. The app works without them; they add email automations on top.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `workflows/weekly-insights-email.json` | Every Monday 09:00 (n8n's timezone) | Calls `GET /api/n8n/weekly-insights` and emails each active user their weekly summary. |
| `workflows/large-transfer-alert.json` | Webhook, called by the app after every transfer | Verifies the event signature and emails the sender when a transfer is $500 or more. |

## How the app talks to n8n

- **App → n8n (events).** After a transfer commits, the app POSTs `{ type, occurredAt, data }` to `N8N_WEBHOOK_URL`. The body is signed with HMAC-SHA256 using `N8N_WEBHOOK_SECRET` and sent in the `x-valoron-signature` header. Sending is fire-and-forget with a 3 second timeout, so an n8n outage never slows down or fails a transfer.
  - `transfer.completed` data: `userId`, `userEmail`, `recipient` (masked), `amountCents`, `note`, `category`.
- **n8n → app (digest feed).** `GET /api/n8n/weekly-insights?page=N` with `Authorization: Bearer <N8N_API_SECRET>` returns `{ page, nextPage, users: [...] }`, 50 users per page. Each user has `email`, `fullName`, `weekStart`, `summary`, `thisWeek` and `lastWeek` totals in cents. Users with no activity in the last two weeks are skipped. The route never calls the AI model itself; it reuses the summary the user already saw on their dashboard, or a plain-text one. It returns 404 when `N8N_API_SECRET` isn't set.

## Setup

1. **Get an n8n instance**: n8n Cloud, or self-hosted (Docker, Render, Railway…). Self-hosted needs `NODE_FUNCTION_ALLOW_BUILTIN=crypto` so the signature check can run.
2. **Make two secrets**, for example with `openssl rand -hex 32`, one for `N8N_WEBHOOK_SECRET` and one for `N8N_API_SECRET`.
3. **Import the workflows**: in n8n, open *Workflows → Import from file* and pick each JSON file.
4. **Large transfer alert**
   - Open *Verify signature* and replace `REPLACE_WITH_N8N_WEBHOOK_SECRET` with your webhook secret.
   - Open *Email the sender*, attach an SMTP credential and set the from address. You can change the $500 threshold in the IF node (it's in cents: `50000`).
   - Activate the workflow and copy the webhook node's **Production URL**.
5. **Weekly insights email**
   - In *Config*, set `appUrl` to your deployed URL and `fromEmail` to your sender address.
   - Create a *Header Auth* credential named `Valoron n8n API secret` with name `Authorization` and value `Bearer <N8N_API_SECRET>`, and attach it to *Fetch weekly insights*.
   - Attach the SMTP credential to *Send summary email* and activate.
6. **Configure the app** (Render → Environment): set `N8N_WEBHOOK_URL` to the production URL from step 4, plus `N8N_WEBHOOK_SECRET` and `N8N_API_SECRET`. Redeploy.

## Testing

- Send a transfer of $500 or more from a test account; the sender should get an email, and the execution shows up in n8n.
- Run the weekly workflow by hand with *Execute workflow*. A user needs at least one transaction in the last two weeks to appear.
