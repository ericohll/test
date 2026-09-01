# Architecture: Quality Dashboard
Data Sensitivity: Public | Pattern: Event-driven serverless batch ETL + API-driven dashboard

## Solution Summary
The platform ingests daily batch data from five tool categories (SonarQube, Fortify, Trivy, Tricentis, GitLab) via REST API pulls and scheduled SFTP file pulls into an S3-based data lake, normalises it via Lambda/Step Functions into a unified relational model in RDS, and evaluates configurable release-gate thresholds. A CloudFront-fronted single-page app calls API Gateway/Lambda to render project, release, and portfolio dashboards, executive risk summaries, and finding lifecycle status. Users authenticate via Cognito federated to the existing corporate OIDC provider (Okta/Azure AD). Threshold breaches publish notifications via SNS (email/Slack). Raw and normalised data is retained 24 months in S3/RDS with lifecycle archival for cost efficiency.

## AWS Services
| Service | Purpose | Config Notes |
|---------|---------|---------------|
| Amazon Cognito | User auth, session management | Federates to corporate OIDC (Okta/Azure AD) as external IdP; no local users |
| Amazon API Gateway | REST API for dashboard backend | Cognito authorizer; throttling enabled |
| AWS Lambda | Ingestion connectors (SonarQube/GitLab API pull), SFTP pull (Fortify/Trivy/Tricentis), normalisation, threshold evaluation, API handlers | Scheduled + orchestrated via Step Functions |
| AWS Step Functions | Orchestrates daily batch pipeline: fetch → normalise → load → gate evaluation → notify | One state machine per nightly run |
| Amazon EventBridge | Triggers nightly batch pipeline | Cron schedule targeting ~02:00 to meet 06:00 SLA |
| Amazon S3 | Data lake: raw tool exports/API payloads, archived history | Lifecycle rules to transition/archive after active window |
| Amazon S3 (separate bucket) | Static hosting for dashboard frontend assets | Origin for CloudFront |
| Amazon CloudFront | CDN delivery of dashboard SPA | HTTPS only |
| Amazon RDS (db.t3.micro) | Unified normalised data model: metrics, findings, lifecycle, thresholds, gate results, user actions | Single Multi-AZ-off instance for MVP scale |
| Amazon SQS | Buffer/retry queue between per-tool ingestion Lambdas and normalisation step | DLQ for failed ingestion batches |
| Amazon SNS | Threshold-breach and release-gate alerts (email; Slack via subscriber Lambda) | Per-project/opt-in topics (FR-14) |
| AWS Secrets Manager | Tool API tokens, SFTP credentials, Slack webhook URL | Rotated periodically |
| AWS Systems Manager Parameter Store | Non-secret config: tool endpoints, default thresholds | Environment-scoped params |
| AWS IAM | Least-privilege roles for Lambda/Step Functions/API | Scoped per function |
| Amazon CloudWatch | Ingestion job logs, API/dashboard metrics, alarms on SLA breach | Log retention 12 months (NFR/Compliance) |
| AWS X-Ray | Trace API Gateway → Lambda → RDS calls | Enabled on API stage |

## Data Flow
**1. Nightly ingestion (batch)**
1. EventBridge triggers Step Functions nightly at ~02:00.
2. Parallel Lambda tasks: (a) call SonarQube/GitLab REST APIs; (b) SFTP-pull export files from Fortify/Trivy/Tricentis on-prem/self-hosted hosts using Secrets Manager credentials.
3. Raw payloads/files land in S3 data lake bucket, partitioned by tool/date; failures routed to SQS DLQ for retry/alerting.
4. Normalisation Lambdas parse raw S3 objects into the unified schema and upsert into RDS (metrics, findings, lifecycle events, commits/pipeline data).
5. Threshold-evaluation Lambda reads project-configured thresholds from RDS, computes release-gate status, writes results back to RDS (must complete within 5 min of ingestion per NFR-06).
6. On breach, Step Functions publishes to SNS; opted-in subscribers receive email; Slack subscriber Lambda posts to Slack webhook (secret from Secrets Manager).
7. CloudWatch alarms flag pipeline failures or SLA (06:00) risk.

**2. User-facing dashboard access**
1. User authenticates via Cognito, redirected to corporate OIDC (Okta/Azure AD) for login; Cognito issues session tokens.
2. Browser loads SPA from CloudFront/S3.
3. SPA calls API Gateway (Cognito-authorized) for project/release/portfolio views, drill-downs, executive top-20 summary, and finding lifecycle status — Lambda queries RDS.
4. Release managers view/update thresholds and gate status; changes written to RDS and logged as user actions.
5. Release gate check (CI/CD manual step or API call) reads current gate status from RDS via API Gateway to block/allow release (FR-11).

## Design Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data lake for raw ingestion | Amazon S3 (partitioned by tool/date), not Redshift | C-02; only S3-class storage in allowed service set; supports 24-month retention (NFR-08) |
| Query/aggregation engine | RDS (db.t3.micro) instead of Glue/Athena | Glue/Athena not in allowed service list; RDS relational model supports joins needed for release/portfolio rollups (FR-06–FR-09, FR-16); substitution noted per constraint |
| File-based ingestion | Scheduled Lambda-based SFTP pull into S3 (not push/upload) | C-01; user requirement for pull-based SFTP from on-prem sources |
| Orchestration | Step Functions + EventBridge schedule | NFR-01/NFR-05: guarantees ordered fetch→normalise→gate pipeline completes before 06:00 |
| Authentication | Cognito federated to existing OIDC provider (Okta/Azure AD) | Out-of-scope: no new IdP/LDAP build; user base expects SSO (User Base table) |
| Release gate enforcement | Threshold results persisted in RDS, exposed via API for CI/CD to query | FR-11, C-06: blocking gate must be authoritative and queryable |
| Notifications | SNS (email + Slack via subscriber Lambda) | FR-14; Should priority, low-cost async fan-out |
| Retry/decoupling | SQS between ingestion and normalisation | C-01/C-07: tolerate inconsistent file-based tool availability |
| Frontend hosting | S3 + CloudFront | NFR-03/NFR-04: low-latency static delivery for dashboard views |
| Storage tiering | S3 lifecycle rules for archive of older data | NFR-08: 24-month retention with cost efficiency |

## Security Design
| Concern | Approach |
|---------|----------|
| Authentication | Cognito User Pool federated to corporate OIDC (Okta/Azure AD); no local credentials |
| Authorisation | Cognito groups mapped from IdP roles; API Gateway authorizer enforces; FR-15 grants all authenticated users portfolio-wide read access, threshold config restricted to release manager/QA roles at app layer |
| Data at rest | S3 default encryption (SSE-S3/KMS-managed), RDS storage encryption enabled |
| Data in transit | TLS enforced on API Gateway, CloudFront, Cognito, SFTP (SSH/SFTP) pulls, and outbound tool API calls |
| Network boundary | Lambda functions operate within existing pre-provisioned VPC private subnets for RDS/SFTP access; API Gateway/CloudFront public edge only; no new VPC/subnet/NAT created |
| Secrets | All tool API tokens, SFTP keys, Slack webhook stored in Secrets Manager; retrieved at runtime via IAM role, never hardcoded |
| Audit trail | User actions (views, threshold changes) logged to RDS per FR-19/data table; CloudWatch captures ingestion/API logs at 12-month retention (Compliance) |

## Integration Confirmation
| System | Direction | Endpoint Type | Auth | Notes |
|--------|-----------|---------------|------|-------|
| SonarQube | Inbound | REST API (Lambda poller) | API token (Secrets Manager) | Matches BRD |
| Fortify | Inbound | SFTP pull (Lambda scheduled) into S3 | SSH key (Secrets Manager) | Changed from generic "REST/File export" to explicit scheduled SFTP pull per user feedback |
| Trivy | Inbound | SFTP pull (Lambda scheduled) into S3 | SSH key (Secrets Manager) | Same change as above |
| Tricentis | Inbound | SFTP pull (Lambda scheduled) into S3 | SSH key (Secrets Manager) | Same change as above |
| GitLab | Inbound | REST API (Lambda poller) | Personal/API token (Secrets Manager) | Webhooks deferred to Phase 2 (C-04); MVP uses polling |
| Data Platform (warehouse/lake) | Internal (replaces outbound) | S3 data lake + RDS | IAM roles | BRD described outbound ETL to external warehouse; MVP builds the platform in-house (C-02) — no external system exists to send to |
| Notification service (Slack/email) | Outbound | SNS → Slack webhook (Lambda) / SNS email | Webhook URL secret / SNS native | Matches BRD intent; implemented via SNS instead of direct SaaS API call |
| User authentication service | Inbound | OIDC (via Cognito federation) | OAuth2/OIDC | Changed from LDAP/OAuth generic to Cognito-mediated OIDC federation per user feedback; no LDAP build |
