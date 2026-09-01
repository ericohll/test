let mockConn;
jest.mock('../../src/lib/db', () => ({
  withConnection: (fn) => fn(mockConn),
  withTransaction: (fn) => fn(mockConn),
}));

const { createFakeDb } = require('../helpers/fakeDb');
const { apiEvent, claimsFor } = require('../helpers/apiEvent');
const { seedProject } = require('../helpers/seed');
const { handler } = require('../../src/handlers/api-thresholds');

beforeEach(() => {
  mockConn = createFakeDb();
});

function putEvent({ claims, body, id = 'proj-1' } = {}) {
  return apiEvent({
    method: 'PUT',
    resource: '/projects/{id}/thresholds',
    pathParameters: { id },
    claims,
    body: body === undefined ? { metric_type: 'coverage', operator: 'gte', threshold_value: 80 } : body,
  });
}

describe('PUT /projects/{id}/thresholds', () => {
  test('spec criterion: Viewer group -> 403, thresholds and user_actions stay empty', async () => {
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    const res = await handler(putEvent({ claims: claimsFor({ groups: 'Viewer' }) }));
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/ReleaseManager/);
    expect(body.error).toMatch(/QALead/);
    expect(mockConn._tables.thresholds).toHaveLength(0);
    expect(mockConn._tables.user_actions).toHaveLength(0);
  });

  test('no cognito:groups key at all -> 403', async () => {
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    const res = await handler(putEvent({ claims: claimsFor({}) }));
    expect(res.statusCode).toBe(403);
  });

  test('403 even when project does not exist and body is invalid -- group check precedes both', async () => {
    const res = await handler(putEvent({
      id: 'does-not-exist',
      claims: claimsFor({ groups: 'Viewer' }),
      body: { operator: 'bogus' },
    }));
    expect(res.statusCode).toBe(403);
  });

  test('cognito:groups as an array -> 200', async () => {
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    const res = await handler(putEvent({ claims: claimsFor({ groups: ['ReleaseManager'] }) }));
    expect(res.statusCode).toBe(200);
  });

  test('cognito:groups as a comma-string -> 200', async () => {
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    const res = await handler(putEvent({ claims: claimsFor({ groups: 'Viewer,QALead' }) }));
    expect(res.statusCode).toBe(200);
  });

  test('happy path: 200 body shape, one threshold row, one audit row with previous:null', async () => {
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    const claims = claimsFor({ email: 'rm@example.com', groups: 'ReleaseManager' });
    const res = await handler(putEvent({ claims }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.threshold.metric_type).toBe('coverage');
    expect(body.threshold.operator).toBe('gte');
    expect(typeof body.threshold.threshold_value).toBe('number');
    expect(body.threshold.updated_by).toBe('rm@example.com');

    expect(mockConn._tables.thresholds).toHaveLength(1);
    expect(mockConn._tables.user_actions).toHaveLength(1);
    const audit = mockConn._tables.user_actions[0];
    expect(audit.action_type).toBe('threshold_update');
    expect(audit.target_ref).toBe('project:proj-1:coverage');
    expect(audit.detail.previous).toBeNull();
  });

  test('second PUT on the same metric_type appends a new version (append-only)', async () => {
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    const claims = claimsFor({ email: 'rm@example.com', groups: 'ReleaseManager' });
    await handler(putEvent({ claims, body: { metric_type: 'coverage', operator: 'gte', threshold_value: 80 } }));
    await handler(putEvent({ claims, body: { metric_type: 'coverage', operator: 'gte', threshold_value: 85 } }));
    expect(mockConn._tables.thresholds).toHaveLength(2);
    const secondAudit = mockConn._tables.user_actions[1];
    expect(secondAudit.detail.previous).toMatchObject({ operator: 'gte', threshold_value: 80 });
  });

  describe('body validation (400)', () => {
    const claims = claimsFor({ groups: 'ReleaseManager' });
    beforeEach(async () => {
      await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    });

    test('invalid operator', async () => {
      const res = await handler(putEvent({ claims, body: { metric_type: 'coverage', operator: 'ne', threshold_value: 80 } }));
      expect(res.statusCode).toBe(400);
    });

    test('missing metric_type', async () => {
      const res = await handler(putEvent({ claims, body: { operator: 'gte', threshold_value: 80 } }));
      expect(res.statusCode).toBe(400);
    });

    test('non-numeric threshold_value', async () => {
      const res = await handler(putEvent({ claims, body: { metric_type: 'coverage', operator: 'gte', threshold_value: 'abc' } }));
      expect(res.statusCode).toBe(400);
    });

    test('malformed JSON string body', async () => {
      const res = await handler(putEvent({ claims, body: '{not json' }));
      expect(res.statusCode).toBe(400);
    });
  });

  test('REQUIRED_GROUPS env respected: set to QALead only, ReleaseManager caller -> 403', async () => {
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    const original = process.env.REQUIRED_GROUPS;
    process.env.REQUIRED_GROUPS = 'QALead';
    try {
      const res = await handler(putEvent({ claims: claimsFor({ groups: 'ReleaseManager' }) }));
      expect(res.statusCode).toBe(403);
    } finally {
      if (original === undefined) {
        delete process.env.REQUIRED_GROUPS;
      } else {
        process.env.REQUIRED_GROUPS = original;
      }
    }
  });

  test('ReleaseManager + unseeded project id -> 404', async () => {
    const res = await handler(putEvent({ id: 'does-not-exist', claims: claimsFor({ groups: 'ReleaseManager' }) }));
    expect(res.statusCode).toBe(404);
  });
});
