import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listFindings, listProjectsCached } from '../api/endpoints.js';
import { pickFirst } from '../api/client.js';
import { Card } from '../components/Card.jsx';
import DataTable from '../components/DataTable.jsx';
import SeverityBadge from '../components/SeverityBadge.jsx';
import { Field, Select, Button } from '../components/Form.jsx';
import { Banner, Spinner } from '../components/Feedback.jsx';
import { formatDate, titleCase } from '../lib/format.js';

// findings.status enum (db/migrations/001_init.sql)
const STATUSES = ['open', 'confirmed', 'resolved', 'false_positive', 'reopened'];
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const PAGE_SIZES = [25, 50, 100];

export default function FindingsPage() {
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState([]);
  const [state, setState] = useState({ status: 'loading', items: [], raw: null, error: null });

  const projectId = params.get('project_id') || '';
  const status = params.get('status') || '';
  const severity = params.get('severity') || '';
  const limit = Number(params.get('limit')) || 25;
  const offset = Number(params.get('offset')) || 0;

  useEffect(() => {
    listProjectsCached()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  const load = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading', error: null }));
    listFindings({ projectId, status, severity, limit, offset })
      .then(({ items, raw }) => setState({ status: 'ready', items, raw, error: null }))
      .catch((err) => setState({ status: 'error', items: [], raw: null, error: err }));
  }, [projectId, status, severity, limit, offset]);

  useEffect(load, [load]);

  const updateFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.set('offset', '0');
    setParams(next);
  };

  const setPage = (nextOffset) => {
    const next = new URLSearchParams(params);
    next.set('offset', String(Math.max(0, nextOffset)));
    setParams(next);
  };

  const columns = [
    { key: 'severity', header: 'Severity', render: (row) => <SeverityBadge severity={pickFirst(row, ['severity'], 'info')} /> },
    { key: 'status', header: 'Status', render: (row) => titleCase(pickFirst(row, ['status'], '—')) },
    {
      key: 'title',
      header: 'Title',
      render: (row) => {
        const title = pickFirst(row, ['title', 'name'], '—');
        return <span title={title}>{title.length > 60 ? `${title.slice(0, 60)}…` : title}</span>;
      },
    },
    { key: 'tool', header: 'Tool', render: (row) => pickFirst(row, ['tool'], '—') },
    { key: 'project', header: 'Project', render: (row) => pickFirst(row, ['project_id', 'project_name'], '—') },
    {
      key: 'external_id',
      header: 'External ID',
      render: (row) => <span className="qd-mono">{pickFirst(row, ['external_finding_id', 'external_id'], '—')}</span>,
    },
    { key: 'last_seen', header: 'Last seen', render: (row) => formatDate(pickFirst(row, ['last_seen'], null)) },
  ];

  const total = state.raw && typeof state.raw === 'object' ? pickFirst(state.raw, ['total', 'total_count'], null) : null;
  const pageStart = offset + 1;
  const pageEnd = offset + state.items.length;

  return (
    <div className="qd-stack">
      <div className="qd-page-header">
        <h1 className="qd-page-title">Findings</h1>
      </div>

      <Card>
        <div className="qd-row">
          <Field label="Project">
            <Select
              value={projectId}
              onChange={(e) => updateFilter('project_id', e.target.value)}
              options={[
                { value: '', label: 'All projects' },
                ...projects.map((p) => ({
                  value: pickFirst(p, ['project_id', 'id'], ''),
                  label: pickFirst(p, ['name', 'project_name'], pickFirst(p, ['project_id', 'id'], '')),
                })),
              ]}
            />
          </Field>
          <Field label="Status">
            <Select
              value={status}
              onChange={(e) => updateFilter('status', e.target.value)}
              options={[{ value: '', label: 'Any' }, ...STATUSES.map((s) => ({ value: s, label: titleCase(s) }))]}
            />
          </Field>
          <Field label="Severity">
            <Select
              value={severity}
              onChange={(e) => updateFilter('severity', e.target.value)}
              options={[{ value: '', label: 'Any' }, ...SEVERITIES.map((s) => ({ value: s, label: titleCase(s) }))]}
            />
          </Field>
          <Field label="Page size">
            <Select
              value={String(limit)}
              onChange={(e) => updateFilter('limit', e.target.value)}
              options={PAGE_SIZES.map((s) => ({ value: String(s), label: String(s) }))}
            />
          </Field>
        </div>
      </Card>

      {state.status === 'loading' ? <Spinner /> : null}

      {state.status === 'error' ? (
        <Banner variant="error" onRetry={load}>
          {state.error.message || 'Could not load findings.'}
        </Banner>
      ) : null}

      {state.status === 'ready' ? (
        <Card>
          <DataTable columns={columns} rows={state.items} emptyMessage="No findings match these filters." />
          <div className="qd-button-row">
            <Button variant="secondary" disabled={offset === 0} onClick={() => setPage(offset - limit)}>
              Previous
            </Button>
            <span className="qd-table-caption">
              {state.items.length === 0 ? 'Showing 0 of 0' : total != null ? `Showing ${pageStart}–${pageEnd} of ${total}` : `Showing ${pageStart}–${pageEnd}`}
            </span>
            <Button
              variant="secondary"
              disabled={state.items.length < limit}
              onClick={() => setPage(offset + limit)}
            >
              Next
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
