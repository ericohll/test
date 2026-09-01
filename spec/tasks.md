# Implementation Tasks: Quality Dashboard

- [x] 1. Create `qd-datalake-{env}` S3 bucket
  - Partitioned layout `raw/{tool}/{project}/{run_date}/`; lifecycle rules per NFR-08
  - _Requirements: 1_
  - _Verify: sam validate succeeds on the template defining this bucket resource_

- [x] 2. Create `qd-frontend-{env}` S3 bucket and `qd-cdn-{env}` CloudFront distribution
  - Static SPA hosting with CloudFront as origin, HTTPS only
  - _Requirements: 6_
  - _Verify: sam validate succeeds on the template defining these resources_

- [x] 3. Create `qd-userpool-{env}` Cognito User Pool with OIDC federation and groups
  - Groups `Viewer`, `ReleaseManager`, `QALead`; federated to corporate OIDC (Okta/Azure AD)
  - _Requirements: 6, 7_
  - _Verify: unit test asserts the Cognito User Pool resource in the template declares all three group names_

- [x] 4. Create `qd-api-{env}` API Gateway REST API with Cognito authorizer
  - Routes for `/projects`, `/projects/{id}/dashboard`, `/portfolio/summary`, `/findings`, `/releases/{id}/gate-status`, `/releases/{id}/gate-check`, `/projects/{id}/thresholds`, `/notifications/subscriptions`
  - _Requirements: 6, 7, 8_
  - _Verify: sam validate succeeds and a unit test confirms each route path is defined in the template_

- [x] 5. Implement `qd-ingest-api-sonarqube-{env}` and `qd-ingest-api-gitlab-{env}` Lambdas
  - Pull REST API data, write to `qd-datalake-{env}` under deterministic batch-key path
  - _Requirements: 1_
  - _Verify: unit test invokes the handler with a mocked API client and asserts the S3 key matches the `{tool}/{project}/{run_date}` pattern_

- [x] 6. Implement `qd-ingest-sftp-fortify-{env}`, `qd-ingest-sftp-trivy-{env}`, `qd-ingest-sftp-tricentis-{env}` Lambdas
  - SFTP-pull using Secrets Manager SSH key, write to `qd-datalake-{env}` under batch-key path
  - _Requirements: 1_
  - _Verify: unit test invokes the handler with a mocked SFTP client and asserts the S3 key matches the batch-key pattern_

- [x] 7. Create `qd-ingest-queue-{env}` SQS queue and `qd-ingest-dlq-{env}` with redrive policy
  - Max receive count 3, DLQ target
  - _Requirements: 2_
  - _Verify: unit test parses the template and asserts the queue's RedrivePolicy references the DLQ ARN_

- [x] 8. Implement `qd-normalize-{tool}-{env}` Lambdas
  - Parse raw S3 objects, upsert `metrics`/`findings`/`finding_lifecycle_events` on unique keys, update `ingestion_batches`
  - _Requirements: 1, 3_
  - _Verify: unit test runs the upsert logic twice with identical input and asserts row count is unchanged (idempotency)_

- [x] 9. Create `qd-db-{env}` RDS MySQL instance and schema migrations
  - Tables: `projects`, `releases`, `ingestion_batches`, `metrics`, `findings`, `finding_lifecycle_events`, `thresholds`, `gate_results`, `user_actions`
  - _Requirements: 3, 4, 7, 9_
  - _Verify: unit test loads the migration SQL file and asserts each named table is created with its documented primary/unique key_

- [x] 10. Implement `qd-gate-eval-{env}` Lambda
  - Reads thresholds, writes `gate_results`, publishes breach to `qd-alerts-{project}-{env}`
  - _Requirements: 4_
  - _Verify: unit test feeds a metric value exceeding a mock threshold and asserts a breach publish call is made_

- [x] 11. Create `qd-alerts-{project}-{env}` and `qd-ops-alerts-{env}` SNS topics
  - Per-project opt-in breach topics; separate ops/pipeline-failure topic
  - _Requirements: 4, 5, 2, 9_
  - _Verify: sam validate succeeds on the template defining these SNS topic resources_

- [x] 12. Implement `qd-notify-slack-{env}` Lambda
  - SNS-triggered, posts to Slack webhook URL retrieved from Secrets Manager
  - _Requirements: 5_
  - _Verify: unit test invokes the handler with a mocked SNS event and asserts the mocked HTTP client is called with the webhook URL from a mocked secrets client_

- [x] 13. Create `qd-nightly-pipeline-{env}` Step Functions state machine and `qd-nightly-trigger-{env}` EventBridge rule
  - Orchestrates fetch → normalise → gate-eval → notify; cron ~02:00
  - _Requirements: 1, 4_
  - _Verify: sam validate succeeds on the state machine ASL definition and the EventBridge rule resource_

- [x] 14. Implement API handler Lambdas `qd-api-{resource}-{env}`
  - Handlers for projects, releases, portfolio, findings, thresholds resource groups
  - _Requirements: 6, 7, 8_
  - _Verify: unit test invokes each handler with a mocked event and asserts a 200 response shape matching its documented contract_

- [x] 15. Configure Secrets Manager entries
  - `qd/{tool}/credentials-{env}`, `qd/slack/webhook-{env}`, `qd/db/app-user-{env}`
  - _Requirements: 1, 5, 3_
  - _Verify: unit test asserts the deployment template references each named secret by its naming pattern_

- [x] 16. Configure SSM Parameter Store config entries
  - `/qd/{env}/config/{key}` for tool endpoints and default thresholds
  - _Requirements: 1, 4_
  - _Verify: sam validate succeeds on the template defining these parameters_

- [x] 17. Configure CloudWatch Log Groups, alarms, and X-Ray tracing
  - `/qd/{component}-{env}` log groups (12-month retention); alarms on Step Functions failure, Lambda errors, DLQ depth; X-Ray on `qd-api-{env}` stage
  - _Requirements: 2, 9_
  - _Verify: unit test parses the template and asserts each named log group has RetentionInDays set and the API stage has TracingEnabled true_

- [x] 18. Wire IAM role for `qd-ingest-api-*` / `qd-ingest-sftp-*` Lambdas
  - Scoped `s3:PutObject` on `qd-datalake-{env}` raw prefix, `secretsmanager:GetSecretValue` on tool secret, `sqs:SendMessage` on ingest queue
  - _Requirements: 1, 2_
  - _Verify: unit test parses the IAM policy document and asserts only the listed actions/resources are present_

- [x] 19. Wire IAM role for `qd-normalize-*` Lambdas
  - `s3:GetObject` on raw prefix, `secretsmanager:GetSecretValue` on DB secret, `rds-db:connect`, SQS receive/delete on ingest queue and DLQ
  - _Requirements: 3_
  - _Verify: unit test parses the IAM policy document and asserts only the listed actions/resources are present_

- [x] 20. Wire IAM role for `qd-gate-eval` Lambda
  - `rds-db:connect` on `qd-db-{env}`, `sns:Publish` on `qd-alerts-*`
  - _Requirements: 4_
  - _Verify: unit test parses the IAM policy document and asserts only the listed actions/resources are present_

- [x] 21. Wire IAM role for `qd-notify-slack` Lambda
  - `secretsmanager:GetSecretValue` on Slack webhook secret
  - _Requirements: 5_
  - _Verify: unit test parses the IAM policy document and asserts only the listed action/resource is present_

- [x] 22. Wire IAM role for `qd-api-*` Lambdas and Cognito group authorization
  - Scoped `rds-db:connect`; Lambda-layer check of Cognito group claim for `ReleaseManager`/`QALead` on threshold write path
  - _Requirements: 6, 7, 8_
  - _Verify: unit test calls the threshold-write handler with a mocked JWT lacking the required group claim and asserts a 403 response_

- [x] 23. Wire IAM role for `qd-nightly-pipeline` Step Functions state machine
  - `lambda:InvokeFunction` on all pipeline Lambdas, `states:StartExecution` trigger from EventBridge
  - _Requirements: 1, 4_
  - _Verify: unit test parses the IAM policy document and asserts only the listed actions/resources are present_

- [x] 24. Wire CI/CD external caller access to `/releases/{id}/gate-check`
  - Read-only `execute-api:Invoke` grant / API key or Cognito token validation
  - _Requirements: 8_
  - _Verify: unit test invokes the gate-check handler with a valid mocked token and asserts a 200 response containing a status field_

- [x] 25. Resolve OED-03 threshold versioning approach before implementing threshold write path
  - Decide overwrite-in-place vs. append-only history table for `thresholds`
  - _Requirements: 7_
  - _Blocked by: OED-03_
