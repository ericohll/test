const {
  latestByMetricType, evaluateGate, describeMetrics, parseFailedMetrics,
} = require('../src/lib/gate');

function metric(overrides) {
  return {
    project_id: 'proj-1', tool: 'sonarqube', run_date: '2026-09-01',
    metric_type: 'coverage', release_id: null, value: 90, unit: '%', ...overrides,
  };
}

function threshold(overrides) {
  return {
    project_id: 'proj-1', metric_type: 'coverage', operator: 'gte', threshold_value: 80,
    updated_by: 'a@b.com', updated_at: '2026-09-01', ...overrides,
  };
}

describe('gate.latestByMetricType', () => {
  test('highest run_date wins per metric_type; last row wins on a tie', () => {
    const rows = [
      metric({ metric_type: 'coverage', run_date: '2026-08-30', value: 50 }),
      metric({ metric_type: 'coverage', run_date: '2026-09-01', value: 91 }),
      metric({ metric_type: 'coverage', run_date: '2026-09-01', value: 92 }),
    ];
    const map = latestByMetricType(rows);
    expect(map.get('coverage').value).toBe(92);
  });
});

describe('gate.evaluateGate', () => {
  test('fails when a metric breaches gte threshold (coverage=62 vs gte 80)', () => {
    const result = evaluateGate(
      [metric({ metric_type: 'coverage', value: 62 })],
      [threshold({ metric_type: 'coverage', operator: 'gte', threshold_value: 80 })]
    );
    expect(result.status).toBe('fail');
    expect(result.failed_metrics).toHaveLength(1);
    expect(Object.keys(result.failed_metrics[0]).sort()).toEqual(
      ['metric_type', 'operator', 'run_date', 'threshold_value', 'tool', 'value'].sort()
    );
  });

  test('fails the other direction (critical_findings=9 vs lte 5)', () => {
    const result = evaluateGate(
      [metric({ metric_type: 'critical_findings', value: 9 })],
      [threshold({ metric_type: 'critical_findings', operator: 'lte', threshold_value: 5 })]
    );
    expect(result.status).toBe('fail');
    expect(result.failed_metrics[0]).toMatchObject({
      metric_type: 'critical_findings', operator: 'lte', threshold_value: 5, value: 9,
    });
  });

  test('passes when all thresholds are met', () => {
    const result = evaluateGate(
      [metric({ metric_type: 'coverage', value: 91 })],
      [threshold({ metric_type: 'coverage', operator: 'gte', threshold_value: 80 })]
    );
    expect(result.status).toBe('pass');
    expect(result.failed_metrics).toEqual([]);
  });

  test('status is unknown with zero thresholds', () => {
    const result = evaluateGate([metric({ metric_type: 'coverage', value: 91 })], []);
    expect(result.status).toBe('unknown');
  });

  test('status is unknown when a threshold has no matching metric', () => {
    const result = evaluateGate([], [threshold({ metric_type: 'coverage' })]);
    expect(result.status).toBe('unknown');
    expect(result.missing_metrics).toEqual(['coverage']);
    expect(result.results[0].passing).toBeNull();
  });

  test('duplicate metric rows for one metric_type: highest run_date wins', () => {
    const result = evaluateGate(
      [
        metric({ metric_type: 'coverage', run_date: '2026-08-01', value: 10 }),
        metric({ metric_type: 'coverage', run_date: '2026-09-01', value: 91 }),
      ],
      [threshold({ metric_type: 'coverage', operator: 'gte', threshold_value: 80 })]
    );
    expect(result.status).toBe('pass');
    expect(result.results[0].value).toBe(91);
  });

  test('string value / threshold_value are coerced to numbers', () => {
    const result = evaluateGate(
      [metric({ metric_type: 'coverage', value: '62' })],
      [threshold({ metric_type: 'coverage', operator: 'gte', threshold_value: '80' })]
    );
    expect(result.status).toBe('fail');
    expect(result.failed_metrics[0].value).toBe(62);
    expect(result.failed_metrics[0].threshold_value).toBe(80);
    expect(typeof result.failed_metrics[0].value).toBe('number');
  });

  test('a fail takes priority over missing metrics for overall status', () => {
    const result = evaluateGate(
      [metric({ metric_type: 'coverage', value: 62 })],
      [
        threshold({ metric_type: 'coverage', operator: 'gte', threshold_value: 80 }),
        threshold({ metric_type: 'critical_findings', operator: 'lte', threshold_value: 5 }),
      ]
    );
    expect(result.status).toBe('fail');
    expect(result.missing_metrics).toEqual(['critical_findings']);
  });
});

describe('gate.describeMetrics', () => {
  test('includes one entry per latest metric, even with no configured threshold', () => {
    const rows = [
      metric({ metric_type: 'coverage', value: 91 }),
      metric({ metric_type: 'duplication', value: 3, unit: '%' }),
    ];
    const thresholdRows = [threshold({ metric_type: 'coverage', operator: 'gte', threshold_value: 80 })];
    const described = describeMetrics(rows, thresholdRows);
    expect(described).toHaveLength(2);
    const dup = described.find((d) => d.metric_type === 'duplication');
    expect(dup.threshold).toBeNull();
    expect(dup.passing).toBeNull();
    const cov = described.find((d) => d.metric_type === 'coverage');
    expect(cov.threshold).toEqual({ operator: 'gte', threshold_value: 80 });
    expect(cov.passing).toBe(true);
  });
});

describe('gate.parseFailedMetrics', () => {
  test('array in, array out', () => {
    expect(parseFailedMetrics([{ metric_type: 'coverage' }])).toEqual([{ metric_type: 'coverage' }]);
  });
  test('JSON string is parsed', () => {
    expect(parseFailedMetrics('[{"metric_type":"coverage"}]')).toEqual([{ metric_type: 'coverage' }]);
  });
  test('null/undefined become []', () => {
    expect(parseFailedMetrics(null)).toEqual([]);
    expect(parseFailedMetrics(undefined)).toEqual([]);
  });
  test('malformed string becomes []', () => {
    expect(parseFailedMetrics('{not json')).toEqual([]);
  });
});
