import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPortfolioSummary } from '../api/endpoints.js';
import { normaliseList, pickFirst } from '../api/client.js';
import { Card, CardHeader } from '../components/Card.jsx';
import MetricTile from '../components/MetricTile.jsx';
import DataTable from '../components/DataTable.jsx';
import StatusPill from '../components/StatusPill.jsx';
import { Banner, Spinner, RawJson } from '../components/Feedback.jsx';
import { formatDate } from '../lib/format.js';

export default function PortfolioPage() {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const navigate = useNavigate();

  const load = useCallback(() => {
    setState({ status: 'loading', data: null, error: null });
    getPortfolioSummary(20)
      .then((data) => setState({ status: 'ready', data, error: null }))
      .catch((err) => setState({ status: 'error', data: null, error: err }));
  }, []);

  useEffect(load, [load]);

  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'error') {
    return (
      <Banner variant="error" onRetry={load}>
        {state.error.message || 'Could not load the portfolio summary.'}
      </Banner>
    );
  }

  const payload = state.data;
  const projects = normaliseList(payload, 'projects');

  const projectsTracked = pickFirst(payload, ['projects_tracked', 'project_count'], projects.length);
  const gatesFailing = pickFirst(payload, ['gates_failing', 'failing_count']);
  const gatesPassing = pickFirst(payload, ['gates_passing', 'passing_count']);
  const criticalHigh = pickFirst(payload, ['critical_high_findings', 'critical_and_high']);

  const columns = [
    {
      key: 'project',
      header: 'Project',
      render: (row) => (
        <div>
          <div>{pickFirst(row, ['name', 'project_name'], '—')}</div>
          <div className="qd-mono qd-table-caption">{pickFirst(row, ['project_id', 'id'], '—')}</div>
        </div>
      ),
    },
    {
      key: 'gate',
      header: 'Gate',
      render: (row) => <StatusPill status={pickFirst(row, ['gate_status', 'status'], 'unknown')} />,
    },
    {
      key: 'failing',
      header: 'Failing metrics',
      render: (row) => {
        const metrics = normaliseList(pickFirst(row, ['failed_metrics', 'failing_metrics'], []));
        return <span title={metrics.map((m) => pickFirst(m, ['metric_type', 'name'], String(m))).join(', ')}>{metrics.length}</span>;
      },
    },
    { key: 'critical', header: 'Critical', render: (row) => pickFirst(row, ['critical'], '—') },
    { key: 'high', header: 'High', render: (row) => pickFirst(row, ['high'], '—') },
    { key: 'medium', header: 'Medium', render: (row) => pickFirst(row, ['medium'], '—') },
    {
      key: 'last_evaluated',
      header: 'Last evaluated',
      render: (row) => formatDate(pickFirst(row, ['evaluated_at', 'last_evaluated_at'], null)),
    },
  ];

  return (
    <div className="qd-stack">
      <div className="qd-page-header">
        <h1 className="qd-page-title">Portfolio</h1>
      </div>

      <div className="qd-grid-metrics">
        <MetricTile label="Projects tracked" value={projectsTracked ?? '—'} />
        <MetricTile label="Gates failing" value={gatesFailing ?? '—'} />
        <MetricTile label="Gates passing" value={gatesPassing ?? '—'} />
        <MetricTile label="Critical + High findings" value={criticalHigh ?? '—'} />
      </div>

      <Card>
        <CardHeader title="Risk-ranked projects" />
        <DataTable
          columns={columns}
          rows={projects}
          emptyMessage="No projects have been ingested yet."
          onRowClick={(row) => {
            const id = pickFirst(row, ['project_id', 'id'], null);
            if (id) navigate(`/projects/${encodeURIComponent(id)}`);
          }}
        />
      </Card>

      {import.meta.env.DEV ? <RawJson data={payload} /> : null}
    </div>
  );
}
