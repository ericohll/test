import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getProjectDashboard, getGateStatus } from '../api/endpoints.js';
import { normaliseList, pickFirst } from '../api/client.js';
import { Card, CardHeader } from '../components/Card.jsx';
import StatusPill from '../components/StatusPill.jsx';
import SeverityBadge, { SEVERITIES, SeverityBar } from '../components/SeverityBadge.jsx';
import MetricTile from '../components/MetricTile.jsx';
import ThresholdPanel from '../components/ThresholdPanel.jsx';
import SubscribePanel from '../components/SubscribePanel.jsx';
import { Banner, Spinner } from '../components/Feedback.jsx';
import { formatDate, prettyOperator } from '../lib/format.js';

export default function ProjectPage() {
  const { projectId } = useParams();
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [gate, setGate] = useState({ status: 'idle', data: null, error: null });

  const load = useCallback(() => {
    setState({ status: 'loading', data: null, error: null });
    getProjectDashboard(projectId)
      .then((data) => {
        setState({ status: 'ready', data, error: null });
        const releaseId = pickFirst(data, ['release_id'], null) || pickFirst(data.release || {}, ['release_id'], null) || pickFirst(data.gate || {}, ['release_id'], null);
        if (releaseId) {
          setGate({ status: 'loading', data: null, error: null });
          getGateStatus(releaseId)
            .then((g) => setGate({ status: 'ready', data: g, error: null }))
            .catch((err) => setGate({ status: 'error', data: null, error: err }));
        }
      })
      .catch((err) => setState({ status: 'error', data: null, error: err }));
  }, [projectId]);

  useEffect(load, [load]);

  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'error') {
    return (
      <Banner variant="error" onRetry={load}>
        {state.error.message || 'Could not load this project.'}
      </Banner>
    );
  }

  const dashboard = state.data;
  const name = pickFirst(dashboard, ['name', 'project_name'], projectId);
  const repoUrl = pickFirst(dashboard, ['repo_url', 'repository_url'], null);

  const gateData = gate.data || dashboard.gate || {};
  const gateStatus = pickFirst(gateData, ['status', 'gate_status'], 'unknown');
  const evaluatedAt = pickFirst(gateData, ['evaluated_at'], null);
  const failedMetrics = normaliseList(pickFirst(gateData, ['failed_metrics'], []));

  const metrics = normaliseList(pickFirst(dashboard, ['metrics', 'latest_metrics'], []));
  const thresholds = normaliseList(pickFirst(dashboard, ['thresholds'], []));
  const metricTypes = [...new Set(metrics.map((m) => pickFirst(m, ['metric_type'], null)).filter(Boolean))];

  const findingsSummary = pickFirst(dashboard, ['findings_summary', 'findings'], {});
  const severityCounts = {};
  SEVERITIES.forEach((sev) => {
    severityCounts[sev] = Number(pickFirst(findingsSummary, [sev], 0)) || 0;
  });

  return (
    <div className="qd-stack">
      <div className="qd-page-header">
        <div>
          <h1 className="qd-page-title">{name}</h1>
          <div className="qd-page-subtitle qd-mono">{projectId}</div>
          {repoUrl ? (
            <a href={repoUrl} target="_blank" rel="noreferrer">
              {repoUrl}
            </a>
          ) : null}
        </div>
        <Link className="qd-button qd-button-secondary" to={`/findings?project_id=${encodeURIComponent(projectId)}`}>
          View all findings
        </Link>
      </div>

      <Card>
        <CardHeader title="Release gate" right={<StatusPill status={gateStatus} />} />
        {gate.status === 'error' ? (
          <Banner variant="info">Could not load the latest gate evaluation for this release.</Banner>
        ) : null}
        {gateStatus === 'unknown' ? (
          <p>No gate evaluation has run for this release yet.</p>
        ) : (
          <>
            <p className="qd-table-caption">Evaluated {formatDate(evaluatedAt)}</p>
            {failedMetrics.length > 0 ? (
              <ul>
                {failedMetrics.map((m, idx) => (
                  <li key={idx}>
                    {pickFirst(m, ['metric_type', 'name'], 'metric')}: actual {pickFirst(m, ['actual_value', 'value'], '—')}{' '}
                    ({prettyOperator(pickFirst(m, ['operator'], null))}, threshold {pickFirst(m, ['threshold_value', 'threshold'], '—')})
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </Card>

      <Card>
        <CardHeader title="Latest metrics" />
        {metrics.length === 0 ? (
          <p className="qd-empty-state">No metrics have been ingested for this project yet.</p>
        ) : (
          <div className="qd-grid-metrics">
            {metrics.map((m, idx) => {
              const metricType = pickFirst(m, ['metric_type'], `metric-${idx}`);
              const threshold = thresholds.find((t) => pickFirst(t, ['metric_type'], null) === metricType);
              return (
                <MetricTile
                  key={idx}
                  label={metricType}
                  value={pickFirst(m, ['value'], null)}
                  unit={pickFirst(m, ['unit'], '')}
                  caption={
                    threshold
                      ? `${pickFirst(m, ['tool'], '')} · threshold ${prettyOperator(pickFirst(threshold, ['operator'], null))} ${pickFirst(threshold, ['threshold_value'], '')}`
                      : pickFirst(m, ['tool'], '')
                  }
                />
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Findings by severity" />
        <SeverityBar counts={severityCounts} />
        <div className="qd-severity-legend">
          {SEVERITIES.map((sev) => (
            <Link
              key={sev}
              className="qd-severity-legend-item"
              to={`/findings?project_id=${encodeURIComponent(projectId)}&severity=${sev}`}
            >
              <SeverityBadge severity={sev} count={severityCounts[sev]} />
            </Link>
          ))}
        </div>
      </Card>

      <div className="qd-row">
        <ThresholdPanel projectId={projectId} thresholds={thresholds} metricTypes={metricTypes} onSaved={load} />
        <SubscribePanel projectId={projectId} />
      </div>
    </div>
  );
}
