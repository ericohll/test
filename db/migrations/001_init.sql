-- migrations/001_init.sql (MySQL 8.0)
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS projects (
  project_id VARCHAR(64)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name       VARCHAR(255)  NOT NULL,
  repo_url   VARCHAR(1024) NULL,
  created_at DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS releases (
  release_id   VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  project_id   VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  release_name VARCHAR(255) NOT NULL,
  target_date  DATE NULL,
  status       ENUM('open','released','cancelled') NOT NULL DEFAULT 'open',
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  open_project_marker VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin
    GENERATED ALWAYS AS (IF(status = 'open', project_id, NULL)) STORED,
  PRIMARY KEY (release_id),
  UNIQUE KEY uq_releases_one_open_per_project (open_project_marker),
  KEY idx_releases_project_status (project_id, status),
  CONSTRAINT fk_releases_project FOREIGN KEY (project_id)
    REFERENCES projects (project_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ingestion_batches (
  batch_key     VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tool          VARCHAR(32)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  project_id    VARCHAR(64)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  run_date      DATE NOT NULL,
  s3_path       VARCHAR(1024) NOT NULL,
  status        ENUM('pending','ingested','normalized','failed') NOT NULL DEFAULT 'pending',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 1,
  error_message TEXT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                  ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (batch_key),
  KEY idx_batches_project_run (project_id, run_date),
  KEY idx_batches_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS metrics (
  metric_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id  VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tool        VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  run_date    DATE NOT NULL,
  metric_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  release_id  VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  value       DECIMAL(20,6) NOT NULL,
  unit        VARCHAR(32) NULL,
  batch_key   VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (metric_id),
  UNIQUE KEY uq_metrics_natural (project_id, tool, run_date, metric_type),
  KEY idx_metrics_project_run (project_id, run_date),
  KEY idx_metrics_release (release_id),
  CONSTRAINT fk_metrics_project FOREIGN KEY (project_id)
    REFERENCES projects (project_id) ON DELETE CASCADE,
  CONSTRAINT fk_metrics_release FOREIGN KEY (release_id)
    REFERENCES releases (release_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS findings (
  finding_id          CHAR(64)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tool                VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  project_id          VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_finding_id VARCHAR(255) NOT NULL,
  title               VARCHAR(512) NULL,
  severity            ENUM('critical','high','medium','low','info') NOT NULL DEFAULT 'info',
  status              ENUM('open','confirmed','resolved','false_positive','reopened')
                        NOT NULL DEFAULT 'open',
  first_seen          DATETIME(3) NOT NULL,
  last_seen           DATETIME(3) NOT NULL,
  last_run_date       DATE NOT NULL,
  raw_ref             VARCHAR(1024) NULL,
  PRIMARY KEY (finding_id),
  UNIQUE KEY uq_findings_source (tool, project_id, external_finding_id),
  KEY idx_findings_project_sev_status (project_id, severity, status),
  KEY idx_findings_project_run (project_id, last_run_date),
  CONSTRAINT fk_findings_project FOREIGN KEY (project_id)
    REFERENCES projects (project_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS finding_lifecycle_events (
  event_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  finding_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type ENUM('created','seen','severity_changed','status_changed','resolved','reopened')
               NOT NULL,
  event_ts   DATETIME(3) NOT NULL,
  source_run VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  detail     JSON NULL,
  PRIMARY KEY (event_id),
  UNIQUE KEY uq_fle_replay (finding_id, source_run, event_type),
  KEY idx_fle_finding_ts (finding_id, event_ts),
  CONSTRAINT fk_fle_finding FOREIGN KEY (finding_id)
    REFERENCES findings (finding_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- Append-only: INSERT / INSERT IGNORE only. Never UPDATE or ON DUPLICATE KEY UPDATE.

CREATE TABLE IF NOT EXISTS thresholds (
  threshold_id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id      VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  metric_type     VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operator        ENUM('lt','lte','gt','gte','eq') NOT NULL,
  threshold_value DECIMAL(20,6) NOT NULL,
  updated_by      VARCHAR(255) NOT NULL,
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (threshold_id),
  KEY idx_thresholds_current (project_id, metric_type, updated_at DESC, threshold_id DESC),
  CONSTRAINT fk_thresholds_project FOREIGN KEY (project_id)
    REFERENCES projects (project_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- OED-03 RESOLVED: append-only version history. Deliberately NO unique key on
-- (project_id, metric_type) -- every PUT inserts a new version row.

CREATE TABLE IF NOT EXISTS gate_results (
  gate_result_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  release_id     VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  project_id     VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  run_date       DATE NOT NULL,
  status         ENUM('pass','fail','unknown') NOT NULL,
  failed_metrics JSON NOT NULL,
  evaluated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (gate_result_id),
  UNIQUE KEY uq_gate_release_run (release_id, run_date),
  KEY idx_gate_release_latest (release_id, run_date DESC),
  KEY idx_gate_project_run (project_id, run_date),
  CONSTRAINT fk_gate_release FOREIGN KEY (release_id)
    REFERENCES releases (release_id) ON DELETE CASCADE,
  CONSTRAINT fk_gate_project FOREIGN KEY (project_id)
    REFERENCES projects (project_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_actions (
  action_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     VARCHAR(255) NOT NULL,
  action_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_ref  VARCHAR(512) NOT NULL,
  detail      JSON NULL,
  ts          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (action_id),
  KEY idx_user_actions_user_ts (user_id, ts),
  KEY idx_user_actions_type_ts (action_type, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- Append-only audit log: INSERT only.

INSERT IGNORE INTO schema_migrations (version) VALUES ('001_init');
