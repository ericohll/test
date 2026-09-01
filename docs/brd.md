# BRD: Quality Dashboard
Data Sensitivity: Public | Date: 2025-01-09 | Owner: Development / QA / Release Management
approved_at: 2025-01-09T00:00:00Z

## Functional Scope
| ID    | Capability        | Source   | Priority          |
|-------|-------------------|----------|-------------------|
| FR-01 | Ingest and normalise data from code quality tools (SonarQube) | Explicit | Must |
| FR-02 | Ingest and normalise data from security scanning tools (Fortify) | Explicit | Must |
| FR-03 | Ingest and normalise data from SCA tools (Trivy) | Explicit | Must |
| FR-04 | Ingest and normalise data from testing tools (Tricentis) | Explicit | Must |
| FR-05 | Ingest and normalise data from delivery/CI-CD tools (GitLab) | Explicit | Must |
| FR-06 | Display project-level quality metrics in dedicated dashboard view | Explicit | Must |
| FR-07 | Display release-level consolidated metrics and go/no-go status | Explicit | Must |
| FR-08 | Display portfolio-wide technical debt and security risk trends | Explicit | Must |
| FR-09 | Organise dashboard data by tool category (tabs: code quality, security, SCA, testing, delivery) | Explicit | Must |
| FR-10 | Allow teams to configure quality thresholds per project (e.g., fail if coverage < 80%) | Explicit | Must |
| FR-11 | Enforce release gates: block release if configured thresholds are breached | Explicit | Must |
| FR-12 | Track finding lifecycle (open → in-progress → resolved) with actor attribution | Explicit | Must |
| FR-13 | Support pull-based access: teams actively view dashboard status | Explicit | Must |
| FR-14 | Support push-based notifications: teams opt into alerts when thresholds breach | Explicit | Should |
| FR-15 | Enable role-based portfolio visibility: all authenticated users see entire portfolio | Explicit | Must |
| FR-16 | Provide executive summary: top 20 technical debt and security risks, ranked by severity | Explicit | Must |
| FR-17 | Normalise and aggregate metrics across five tool categories into unified data model | Inferred | Must |
| FR-18 | Support daily batch data ingestion from tools with APIs and file-based ingestion for tools without APIs | Explicit | Must |
| FR-19 | Display manual data aggregation effort reduction metrics (e.g., time saved per sprint) | Inferred | Should |

## User Base
| User Type | Internal/External | Est. Concurrent | Auth Method Expected |
|-----------|-------------------|-----------------|----------------------|
| Development teams | Internal | 50–100 | SSO (LDAP/OAuth) |
| QA teams | Internal | 20–50 | SSO (LDAP/OAuth) |
| Release managers | Internal | 5–20 | SSO (LDAP/OAuth) |
| Portfolio/executive stakeholders | Internal | 5–10 | SSO (LDAP/OAuth) |
| Security teams | Internal | 10–20 | SSO (LDAP/OAuth) |

## Scale & Usage Patterns
| Metric           | Baseline | Peak | Growth (12mo) |
|------------------|----------|------|---------------|
| Projects tracked | 10–100 | 150 | +50% |
| Data points per project per day | 100–500 | 1000 | +30% |
| Daily active users | 50 | 150 | +100% |
| Release decisions per week | 5–10 | 20 | +50% |
| Concurrent dashboard sessions | 10–20 | 50 | +100% |

## Data Characteristics
| Data Type | Sensitivity | Volume (est) | Retention | PII? |
|-----------|-------------|--------------|-----------|------|
| Code quality metrics (coverage, complexity, violations) | Public | 500 MB / month | 24 months | No |
| Security findings (CVEs, SAST results, risk scores) | Public | 200 MB / month | 24 months | No |
| SCA findings (dependency vulnerabilities, licenses) | Public | 150 MB / month | 24 months | No |
| Test execution results (pass/fail, coverage, defects) | Public | 300 MB / month | 24 months | No |
| Release pipeline data (build status, deployment logs, commits) | Public | 400 MB / month | 24 months | No |
| Finding lifecycle events (status changes, actor, timestamp) | Public | 50 MB / month | 24 months | No |
| User actions (dashboard views, threshold config changes) | Public | 10 MB / month | 12 months | No |

## Integration Points
| System | Direction | Protocol | Hosted | Data Exchanged |
|--------|-----------|----------|--------|----------------|
| SonarQube | Inbound | REST API | Self-hosted / Cloud | Code quality metrics, violations, complexity, coverage |
| Fortify | Inbound | REST API / File export | Self-hosted / Cloud | SAST findings, severity, status, risk scores |
| Trivy | Inbound | REST API / File export | Cloud / CLI | Container image SCA results, CVE data, license info |
| Tricentis | Inbound | REST API / File export | Self-hosted / Cloud | Test execution results, defect tracking, coverage |
| GitLab | Inbound | REST API / Webhooks | Cloud / Self-hosted | CI/CD pipeline status, deployment info, commits, release tags |
| Data Platform (warehouse/lake) | Outbound | ETL/ELT (batch) | Self-hosted / Cloud | Normalised, aggregated metrics (daily snapshot) |
| Notification service (Slack / email) | Outbound | REST API / SMTP | SaaS | Alert payloads when thresholds breach |
| User authentication service | Inbound | LDAP / OAuth 2.0 | Self-hosted / Cloud | User identity, roles, group membership |

## Non-Functional Requirements
| ID     | Requirement  | Target Metric | Priority |
|--------|--------------|---------------|----------|
| NFR-01 | Data refresh frequency | Daily batch ingestion (overnight sync); data available by 06:00 AM | Must |
| NFR-02 | Dashboard availability | 99.5% uptime during business hours (Mon–Fri, 08:00–18:00) | Must |
| NFR-03 | Dashboard response time (dashboard load) | <3 seconds for project-level view; <5 seconds for portfolio view | Must |
| NFR-04 | Dashboard response time (metric drill-down) | <2 seconds to load detailed metrics for a single project | Must |
| NFR-05 | Data ingestion latency | All five tools' data ingested and normalised within 12 hours of collection | Must |
| NFR-06 | Threshold evaluation latency | Release gate status computed and displayed within 5 minutes of data ingestion | Must |
| NFR-07 | Alert delivery latency | Breach notifications sent within 10 minutes of threshold violation | Should |
| NFR-08 | Storage efficiency | Retain 24 months of historical data in queryable form; archive older data | Should |
| NFR-09 | Scalability (projects) | Support up to 500 projects without performance degradation | Should |
| NFR-10 | Scalability (users) | Support 500+ concurrent dashboard sessions | Should |

## Compliance & Audit Requirements
- [ ] Full audit trail required: No
- [ ] Data residency: Not specified (assume internal infrastructure)
- [ ] Regulation: None (Public data only)
- [ ] Log retention: 12 months application logs; 24 months data history

## Constraints
| ID   | Constraint | Type |
|------|------------|------|
| C-01 | Some tools (Fortify, Trivy, Tricentis) require file-based or manual export for data extraction; no real-time APIs available | Technical/Integration |
| C-02 | No existing unified data platform; must be built as part of this project | Infrastructure |
| C-03 | Daily batch ingestion only for MVP; real-time refresh is phase 2 | Timeline/Scope |
| C-04 | Testing and delivery tools (Tricentis, GitLab delivery metrics) added in MVP; real-time CI/CD webhooks are phase 2 | Scope |
| C-05 | 4–6 month MVP timeline to deliver all five tool categories + release gate enforcement | Timeline |
| C-06 | Release gate enforcement is blocking: must prevent releases if configured thresholds are violated | Business/Regulatory |
| C-07 | Finding lifecycle tracking requires coordination with source tools; not all tools may provide lifecycle data natively | Integration |

## Out of Scope
- Real-time data refresh (phase 2 enhancement)
- CI/CD webhook-based triggers for release gates (phase 2)
- Custom report builder or BI tool integration (future phase)
- Single sign-on setup or authentication infrastructure (assume existing SSO available)
- Data governance or master data management policies (owned by separate initiative)
- Machine learning or anomaly detection (future phase)
- Mobile app (desktop/web only for MVP)
- Automated remediation or self-healing workflows (future phase)