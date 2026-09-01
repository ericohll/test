# Requirements: Quality Dashboard

## Introduction
The platform ingests daily batch data from five tool categories (SonarQube, Fortify, Trivy, Tricentis, GitLab) via REST API pulls and SFTP file pulls into an S3-based data lake, normalises it into a unified MySQL data model, and evaluates configurable release-gate thresholds. A CloudFront-fronted SPA calls API Gateway/Lambda to render dashboards and executive summaries, with Cognito-federated auth and SNS-based breach notifications.

## Requirements

### Requirement 1: Nightly ingestion pipeline
**User Story:** As a platform operator, I want tool data pulled automatically every night, so that dashboards reflect current quality/security state without manual intervention.

#### Acceptance Criteria
1. WHEN the EventBridge schedule fires at ~02:00 THE SYSTEM SHALL start the `qd-nightly-pipeline` Step Functions execution.
2. WHEN the pipeline runs THE SYSTEM SHALL invoke per-tool ingestion Lambdas (API pull for SonarQube/GitLab, SFTP pull for Fortify/Trivy/Tricentis) in parallel.
3. WHEN an ingestion Lambda successfully retrieves data THE SYSTEM SHALL write the payload to the `qd-datalake-{env}` bucket under a path keyed by tool, project, and run_date.
4. WHEN an ingestion batch is retried for the same tool/project/run_date THE SYSTEM SHALL overwrite the existing raw object and `ingestion_batches` row rather than create a duplicate.

### Requirement 2: Reliable buffering and retry
**User Story:** As a platform operator, I want ingestion failures buffered and retried, so that transient tool/network issues don't lose or duplicate data.

#### Acceptance Criteria
1. WHEN an ingestion Lambda completes a batch THE SYSTEM SHALL enqueue a batch reference message to `qd-ingest-queue-{env}`.
2. WHEN a queue message fails processing after the configured maximum receive count THE SYSTEM SHALL route it to `qd-ingest-dlq-{env}`.
3. WHEN a message lands in the DLQ THE SYSTEM SHALL trigger a CloudWatch alarm to `qd-ops-alerts-{env}`.

### Requirement 3: Normalisation into unified data model
**User Story:** As a QA/release stakeholder, I want raw tool data normalised into one relational model, so that I can view consistent metrics and findings across tools.

#### Acceptance Criteria
1. WHEN the normalisation Lambda receives a batch message THE SYSTEM SHALL read the corresponding raw S3 object and parse it into the unified schema.
2. WHEN normalised metric rows match an existing unique key (project_id, tool, run_date, metric_type) THE SYSTEM SHALL upsert rather than insert a duplicate row.
3. WHEN normalised finding rows match an existing deterministic finding_id (hash of tool, project_id, external_finding_id) THE SYSTEM SHALL update the existing finding and append a lifecycle event rather than create a duplicate finding.

### Requirement 4: Release-gate threshold evaluation
**User Story:** As a release manager, I want release-gate status computed automatically after ingestion, so that I can confirm a release is safe to ship.

#### Acceptance Criteria
1. WHEN normalisation for all tools in a nightly run completes THE SYSTEM SHALL invoke `qd-gate-eval` to compute gate status against configured thresholds.
2. WHEN gate evaluation completes THE SYSTEM SHALL persist the result to `gate_results` within 5 minutes of ingestion completion.
3. WHEN a computed metric breaches its configured threshold THE SYSTEM SHALL publish a breach event to the project's SNS alert topic.

### Requirement 5: Notification delivery
**User Story:** As a project stakeholder, I want to be notified when a release gate is breached, so that I can act before the release proceeds.

#### Acceptance Criteria
1. WHEN a breach event is published to a project's SNS topic THE SYSTEM SHALL deliver it to all opted-in email subscribers.
2. WHEN a breach event is published AND a Slack webhook subscription exists THE SYSTEM SHALL invoke `qd-notify-slack` to post the message to the configured Slack webhook.

### Requirement 6: Authenticated dashboard access
**User Story:** As an authenticated user, I want to log in via my corporate identity and view portfolio-wide quality data, so that I don't need a separate account.

#### Acceptance Criteria
1. WHEN a user accesses the SPA THE SYSTEM SHALL redirect unauthenticated sessions to the corporate OIDC provider via Cognito.
2. WHEN a user is authenticated THE SYSTEM SHALL issue a Cognito session token carrying the user's group claim.
3. WHEN any authenticated user calls a read-only dashboard endpoint (`/projects`, `/portfolio/summary`, `/findings`, `/releases/{id}/gate-status`) THE SYSTEM SHALL return the requested data regardless of Cognito group.

### Requirement 7: Restricted threshold configuration
**User Story:** As a release manager or QA lead, I want to configure release-gate thresholds, so that gate evaluation reflects our current quality bar.

#### Acceptance Criteria
1. WHEN a user without `ReleaseManager` or `QALead` group membership calls `PUT /projects/{id}/thresholds` THE SYSTEM SHALL reject the request with an authorization error.
2. WHEN a user with `ReleaseManager` or `QALead` group membership calls `PUT /projects/{id}/thresholds` with valid data THE SYSTEM SHALL persist the updated threshold and append a `user_actions` audit record.

### Requirement 8: CI/CD gate check integration
**User Story:** As a CI/CD pipeline, I want to query the current release-gate status, so that I can block or allow a release automatically.

#### Acceptance Criteria
1. WHEN a CI/CD caller invokes `GET /releases/{id}/gate-check` THE SYSTEM SHALL return the latest persisted `gate_results.status` for that release.
2. WHEN no gate evaluation has run yet for a release THE SYSTEM SHALL return a status of `unknown` rather than an error.

### Requirement 9: Observability and traceability
**User Story:** As a platform operator, I want pipeline and API failures logged, alarmed, and traceable, so that I can meet the SLA and diagnose issues quickly.

#### Acceptance Criteria
1. WHEN any Lambda in the platform executes THE SYSTEM SHALL emit structured logs to its component-specific CloudWatch Log Group.
2. WHEN a Step Functions execution fails or risks breaching the 06:00 SLA THE SYSTEM SHALL trigger a CloudWatch alarm to `qd-ops-alerts-{env}`.
3. WHEN a request traverses API Gateway to Lambda to RDS THE SYSTEM SHALL capture an X-Ray trace for that request.
