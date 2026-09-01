# Resource Inventory
| Resource | AWS Service | Naming Pattern | Purpose |
|----------|-------------|-----------------|---------|
| Data lake bucket | Amazon S3 | `qd-datalake-{env}` | Raw tool payloads/files, partitioned `raw/{tool}/{project}/{run_date}/` |
| Frontend hosting bucket | Amazon S3 | `qd-frontend-{env}` | Static SPA assets, CloudFront origin |
| CDN distribution | Amazon CloudFront | `qd-cdn-{env}` | HTTPS delivery of SPA |
| User pool | Amazon Cognito | `qd-userpool-{env}` | Federated auth via OIDC (Okta/Azure AD); groups `Viewer`/`ReleaseManager`/`QALead` |
| REST API | Amazon API Gateway | `qd-api-{env}` | Dashboard backend, Cognito authorizer |
| Ingestion Lambda (API pull) | AWS Lambda | `qd-ingest-api-{tool}-{env}` (sonarqube, gitlab) | Pull REST APIs into S3 |
| Ingestion Lambda (SFTP pull) | AWS Lambda | `qd-ingest-sftp-{tool}-{env}` (fortify, trivy, tricentis) | SFTP-pull exports into S3 |
| Normalisation Lambda | AWS Lambda | `qd-normalize-{tool}-{env}` | Parse raw S3 objects, upsert RDS |
| Threshold evaluation Lambda | AWS Lambda | `qd-gate-eval-{env}` | Compute gate status, write `gate_results` |
| Slack subscriber Lambda | AWS Lambda | `qd-notify-slack-{env}` | SNS → Slack webhook post |
| API handler Lambdas | AWS Lambda | `qd-api-{resource}-{env}` (projects, releases, portfolio, findings, thresholds) | API Gateway integration per resource group |
| Orchestrator | AWS Step Functions | `qd-nightly-pipeline-{env}` | fetch → normalise → gate-eval → notify |
| Scheduler | Amazon EventBridge | `qd-nightly-trigger-{env}` | Cron ~02:00 daily |
| Ingestion buffer/DLQ | Amazon SQS | `qd-ingest-queue-{env}` / `qd-ingest-dlq-{env}` | Buffer + retry between ingestion and normalisation |
| Alerting topics | Amazon SNS | `qd-alerts-{project}-{env}` (per-project opt-in), `qd-ops-alerts-{env}` (pipeline/ops) | Threshold-breach and pipeline-failure notifications |
| Unified data store | Amazon RDS (MySQL, db.t3.micro) | `qd-db-{env}` | Metrics, findings, lifecycle, thresholds, gate results, user actions |
| Secrets | AWS Secrets Manager | `qd/{tool}/credentials-{env}`, `qd/slack/webhook-{env}`, `qd/db/app-user-{env}` | Tool tokens, SFTP keys, Slack webhook, DB creds |
| Config params | SSM Parameter Store | `/qd/{env}/config/{key}` | Tool endpoints, default thresholds |
| Log groups | Amazon CloudWatch | `/qd/{component}-{env}` | Ingestion/API logs, 12-month retention |
| Tracing | AWS X-Ray | n/a (enabled on API stage `qd-api-{env}`) | API Gateway → Lambda → RDS trace |
