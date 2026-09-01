# Quality Dashboard — frontend

A React 18 + Vite single-page app that renders the Quality Dashboard:
portfolio risk overview, per-project gate status/metrics/findings, a
findings browser, and release-gate threshold editing for the
`ReleaseManager`/`QALead` Cognito groups. It talks to the API Gateway/Lambda
backend defined in `../template.yaml` and authenticates against the Cognito
user pool the same stack provisions.

No TypeScript, no CSS framework, no chart library, no AWS SDK — see the root
`README.md` "Frontend" section and `template.yaml` for why.

## Running locally

```bash
npm install
cp .env.example .env.local   # fill in the four VITE_ vars below
npm run dev                  # http://localhost:5173
```

## Environment variables (build-time, `VITE_`-prefixed)

| Variable | Source | Notes |
|---|---|---|
| `VITE_API_URL` | stack output `ApiUrl` | no trailing slash |
| `VITE_USER_POOL_ID` | stack output `UserPoolId` | |
| `VITE_USER_POOL_CLIENT_ID` | stack output `UserPoolClientId` | |
| `VITE_REGION` | fixed | `ap-southeast-1` |

Vite only exposes `VITE_`-prefixed vars via `import.meta.env`, and `vite
build` automatically loads `.env.production` at build time. `./deploy.sh`
(owned by a different part of this build) is expected to generate
`frontend/.env.production` from the stack outputs before running
`npm run build`.

## Build output contract

`npm run build` produces `frontend/dist/` (`index.html` + `assets/*`),
ready to be synced to the `FrontendBucket` S3 bucket and served through the
`CdnDistribution` CloudFront distribution — both already relative-path-safe
(`vite.config.js` sets `base: './'`).

## Routing

The app uses `HashRouter` (`react-router-dom`), so every URL looks like
`https://<cloudfront-domain>/#/projects/checkout-svc`. This sidesteps
needing any CloudFront/S3 rewrite rule beyond the `index.html` fallback
already configured for 403/404 in `template.yaml` — a hash never leaves the
browser, so there is nothing for CloudFront to 404 on. Findings-page filters
live in the hash query string (`#/findings?project_id=...&severity=high`),
managed with `useSearchParams`.

## Sign-up and sign-in

Auth is native Cognito `USER_PASSWORD_AUTH`, called directly with `fetch`
(see `src/auth/cognito.js`) — no OIDC federation (see "Known contract gaps"
below). New users self-sign-up:

1. **Sign up** with email + password → Cognito emails a 6-digit
   confirmation code (`AutoVerifiedAttributes: [email]`).
2. **Confirm** with that code → the account becomes usable.
3. **Sign in** with email + password → the app stores the refresh token
   (`localStorage['qd.refreshToken']`) and keeps the ID/access tokens in
   memory, refreshing proactively ~2 minutes before expiry.

There is no password-reset flow in this build (out of scope for a hackathon
prototype — see "Known contract gaps").

A newly self-signed-up user lands in **no Cognito group**, i.e. `Viewer`
only. To demo threshold editing, add that user to the `ReleaseManager` or
`QALead` group from the AWS Console (Cognito → User pools → your pool →
Users → select the user → Add to group) — no demo account is seeded, per
the platform contract.

## Design tokens

Every colour, spacing, radius, shadow and font value lives once in
`src/styles/tokens.css`; `src/styles/app.css` (the only other stylesheet)
references them via `var(--qd-*)` / `var(--sp-*)` exclusively.

| Token group | Values |
|---|---|
| Spacing | `--sp-1` 4px, `--sp-2` 8px, `--sp-3` 12px, `--sp-4` 16px, `--sp-5` 24px, `--sp-6` 32px, `--sp-7` 48px |
| Radius | `--radius-sm` 4px, `--radius` 6px, `--radius-lg` 8px, `--radius-pill` 999px |
| Neutrals | `--qd-bg` #f5f7fa, `--qd-surface` #ffffff, `--qd-surface-alt` #f0f3f7, `--qd-border` #d8dee8, `--qd-border-strong` #b9c2d0 |
| Text | `--qd-text` #0f172a, `--qd-text-muted` #5b6779, `--qd-text-faint` #8a94a6 |
| Accent | `--qd-accent` #1f5fd6, `--qd-accent-hover` #1a4fb4, `--qd-accent-soft` #e8f0fe |
| Sidebar | `--qd-sidebar-bg` #0f172a, `--qd-sidebar-text` #c6cede, `--qd-sidebar-active-bg` #1b2740 |
| Gate status (fg/bg/border) | pass #1a7f4b/#e6f5ec/#9ad3b0, fail #c0263c/#fdeaed/#f0b3bd, unknown #5b6779/#eef0f3/#cfd5de |
| Severity (fg/bg) | critical #7f1226/#fbe4e8, high #c0263c/#fdeaed, medium #b06a00/#fdf1dd, low #1f5fd6/#e8f0fe, info #5b6779/#eef0f3 |

Severity and gate status are never conveyed by colour alone — every
pill/badge also carries its text label.

## Tests

`npm test` runs Vitest against the pure-function modules only
(`src/lib/jwt.js`, `src/auth/session.js`'s `canEditThresholds`, and
`src/api/client.js`'s `buildQuery`/`authHeaders`/`normaliseList`). UI
correctness (routing, forms, the auth flow end-to-end) is verified by
browser click-through against the deployed stack rather than jsdom/component
tests, since the backend response shapes were still being built out
concurrently with this frontend and aren't pinned in any test fixture.

## Known contract gaps

1. `spec/requirements.md` 6.1 and `spec/design.md` describe corporate OIDC
   federation via Cognito, but `template.yaml` provisions no identity
   provider — only a native `USER_PASSWORD_AUTH` app client. This frontend
   implements native self-signup + sign-in instead, per `CLAUDE.md`'s Auth
   section ("No demo account is seeded. Let users self-signup..."), which
   supersedes the spec.
2. Notification subscription body shape: `spec/design.md` documents
   `{project_id, channel, target}`; the task contract documents
   `{project_id, email}`. `SubscribePanel`/`subscribeToProject()` sends the
   superset `{project_id, email, channel: 'email', target: email}` to
   satisfy either shape.
3. The exact pagination envelope and key names for `/findings`, and the
   exact field names inside `/portfolio/summary` and
   `/projects/{id}/dashboard`, are not pinned by any spec/schema file (the
   API Lambda handlers were still being built concurrently with this
   frontend). The client reads every field defensively via
   `normaliseList()`/`pickFirst()` in `src/api/client.js` rather than
   assuming one shape.
4. API Gateway's `DEFAULT_4XX` gateway responses have no CORS headers
   configured in `template.yaml`, so a Cognito-authorizer rejection can
   surface in the browser as an opaque network error (`TypeError` from
   `fetch`) rather than a readable 401. `src/api/client.js` mitigates this
   by proactively refreshing the ID token ~2 minutes before it expires, and
   treats an unreachable-API network error as a one-shot forced-refresh
   opportunity before giving up — but fixing the gateway responses
   themselves would require a `template.yaml` change outside this frontend
   task's scope.
5. No CloudFront distribution ID is exposed in the stack `Outputs`, which
   `deploy.sh` would need to invalidate the CDN cache after a redeploy —
   not something this frontend code can address.
