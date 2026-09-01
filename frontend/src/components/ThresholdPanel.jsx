import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { putThreshold } from '../api/endpoints.js';
import { pickFirst } from '../api/client.js';
import { Card, CardHeader } from './Card.jsx';
import DataTable from './DataTable.jsx';
import { Field, Select, NumberInput, TextInput, Button, ButtonRow } from './Form.jsx';
import { Banner } from './Feedback.jsx';
import { formatDate, prettyOperator } from '../lib/format.js';

// thresholds.operator enum (db/migrations/001_init.sql): lt|lte|gt|gte|eq.
// src/lib/operators.js's passes() expresses the pass condition for each, so
// the option labels below spell out that semantics rather than the bare code.
const OPERATOR_OPTIONS = [
  { value: 'lt', label: 'lt — passes when value < threshold' },
  { value: 'lte', label: 'lte — passes when value ≤ threshold' },
  { value: 'gt', label: 'gt — passes when value > threshold' },
  { value: 'gte', label: 'gte — passes when value ≥ threshold' },
  { value: 'eq', label: 'eq — passes when value = threshold' },
];

const OTHER = '__other__';

export default function ThresholdPanel({ projectId, thresholds, metricTypes, onSaved }) {
  const { canEditThresholds } = useAuth();
  const [metricType, setMetricType] = useState(metricTypes[0] || OTHER);
  const [customMetricType, setCustomMetricType] = useState('');
  const [operator, setOperator] = useState('gte');
  const [thresholdValue, setThresholdValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const columns = [
    { key: 'metric_type', header: 'Metric', render: (row) => pickFirst(row, ['metric_type'], '—') },
    { key: 'operator', header: 'Passes when', render: (row) => prettyOperator(pickFirst(row, ['operator'], null)) },
    { key: 'value', header: 'Value', render: (row) => pickFirst(row, ['threshold_value'], '—') },
    { key: 'updated_by', header: 'Updated by', render: (row) => pickFirst(row, ['updated_by'], '—') },
    { key: 'updated_at', header: 'Updated at', render: (row) => formatDate(pickFirst(row, ['updated_at'], null)) },
  ];

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const finalMetricType = metricType === OTHER ? customMetricType.trim() : metricType;
    if (!finalMetricType || thresholdValue === '') {
      setError('Metric type and threshold value are required.');
      return;
    }
    setBusy(true);
    try {
      await putThreshold(projectId, {
        metric_type: finalMetricType,
        operator,
        threshold_value: Number(thresholdValue),
      });
      setSuccess('Threshold saved.');
      setThresholdValue('');
      onSaved?.();
    } catch (err) {
      if (err.status === 403) {
        setError('Your account is not in ReleaseManager or QALead.');
      } else {
        setError(err.message || 'Could not save the threshold.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Release-gate thresholds" />
      <DataTable columns={columns} rows={thresholds} emptyMessage="No thresholds configured for this project." />

      {!canEditThresholds ? (
        <Banner variant="info">Editing release-gate thresholds requires the ReleaseManager or QALead group.</Banner>
      ) : (
        <form onSubmit={submit} className="qd-threshold-form">
          {error ? <Banner variant="error">{error}</Banner> : null}
          {success ? <Banner variant="success">{success}</Banner> : null}

          <Field label="Metric type">
            <Select
              value={metricType}
              onChange={(e) => setMetricType(e.target.value)}
              options={[...metricTypes.map((m) => ({ value: m, label: m })), { value: OTHER, label: 'Other…' }]}
            />
          </Field>
          {metricType === OTHER ? (
            <Field label="Custom metric type">
              <TextInput value={customMetricType} onChange={(e) => setCustomMetricType(e.target.value)} required />
            </Field>
          ) : null}

          <Field label="Operator">
            <Select value={operator} onChange={(e) => setOperator(e.target.value)} options={OPERATOR_OPTIONS} />
          </Field>

          <Field label="Threshold value">
            <NumberInput value={thresholdValue} onChange={(e) => setThresholdValue(e.target.value)} required />
          </Field>

          <ButtonRow>
            <Button type="submit" disabled={busy}>
              Save threshold
            </Button>
          </ButtonRow>
        </form>
      )}
    </Card>
  );
}
