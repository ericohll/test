import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listProjects } from '../api/endpoints.js';
import { pickFirst } from '../api/client.js';
import { Card } from '../components/Card.jsx';
import DataTable from '../components/DataTable.jsx';
import { TextInput, Field } from '../components/Form.jsx';
import { Banner, Spinner } from '../components/Feedback.jsx';

export default function ProjectsPage() {
  const [state, setState] = useState({ status: 'loading', data: [], error: null });
  const [filter, setFilter] = useState('');
  const navigate = useNavigate();

  const load = useCallback(() => {
    setState({ status: 'loading', data: [], error: null });
    listProjects()
      .then((data) => setState({ status: 'ready', data, error: null }))
      .catch((err) => setState({ status: 'error', data: [], error: err }));
  }, []);

  useEffect(load, [load]);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return state.data;
    return state.data.filter((row) => {
      const name = String(pickFirst(row, ['name', 'project_name'], '')).toLowerCase();
      const id = String(pickFirst(row, ['project_id', 'id'], '')).toLowerCase();
      return name.includes(needle) || id.includes(needle);
    });
  }, [state.data, filter]);

  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'error') {
    return (
      <Banner variant="error" onRetry={load}>
        {state.error.message || 'Could not load projects.'}
      </Banner>
    );
  }

  const columns = [
    { key: 'name', header: 'Project', render: (row) => pickFirst(row, ['name', 'project_name'], '—') },
    {
      key: 'id',
      header: 'Project ID',
      render: (row) => <span className="qd-mono">{pickFirst(row, ['project_id', 'id'], '—')}</span>,
    },
    {
      key: 'repo',
      header: 'Repository',
      render: (row) => {
        const url = pickFirst(row, ['repo_url', 'repository_url'], null);
        return url ? (
          <a href={url} target="_blank" rel="noreferrer">
            {url}
          </a>
        ) : (
          '—'
        );
      },
    },
    {
      key: 'action',
      header: '',
      render: (row) => {
        const id = pickFirst(row, ['project_id', 'id'], null);
        return (
          <button
            className="qd-button-link"
            disabled={!id}
            onClick={() => id && navigate(`/projects/${encodeURIComponent(id)}`)}
          >
            View dashboard
          </button>
        );
      },
    },
  ];

  return (
    <div className="qd-stack">
      <div className="qd-page-header">
        <h1 className="qd-page-title">Projects</h1>
      </div>

      <Field label="Filter by name or ID">
        <TextInput value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search projects…" />
      </Field>

      <Card>
        <DataTable columns={columns} rows={filtered} emptyMessage="No projects match your filter." />
      </Card>
    </div>
  );
}
