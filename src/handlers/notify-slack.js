// SNS-triggered. Posts a plain-text Slack message for every record in the
// batch. Fires for every publish to the shared AlertsTopic (unlike the
// per-user email subscriptions created by api-notifications, this function
// has no FilterPolicy).

const { getSecretJson } = require('../lib/secrets');

function formatBreach(p) {
  const lines = [];
  lines.push(`Gate FAIL: ${p.project_name || p.project_id} (${p.project_id})`);
  lines.push(`Release: ${p.release_id}  Run date: ${p.run_date}`);
  const failed = Array.isArray(p.failed_metrics) ? p.failed_metrics : [];
  if (failed.length === 0) {
    lines.push('(no metric detail supplied)');
  } else {
    for (const m of failed) {
      lines.push(`- ${m.metric_type}: ${m.value} (needs ${m.operator} ${m.threshold_value})`);
    }
  }
  if (p.dashboard_url) lines.push(`Dashboard: ${p.dashboard_url}`);
  return lines.join('\n');
}

function fallbackText(sns) {
  return sns.Subject ? `${sns.Subject}\n${sns.Message}` : String(sns.Message);
}

exports.handler = async (event = {}) => {
  const { webhookUrl } = await getSecretJson(process.env.SLACK_SECRET_ARN);
  const records = event.Records || [];

  if (!webhookUrl || webhookUrl === 'REPLACE_ME') {
    console.warn(JSON.stringify({
      level: 'warn', msg: 'Slack webhook not configured, skipping delivery', count: records.length,
    }));
    return { skipped: records.length, delivered: 0 };
  }

  let delivered = 0;
  for (const record of records) {
    const sns = record.Sns || {};
    let payload = null;
    try {
      payload = JSON.parse(sns.Message);
    } catch {
      // Not JSON -- fall back to a raw text rendering below.
    }
    const text = (payload && payload.type === 'gate_breach') ? formatBreach(payload) : fallbackText(sns);

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      throw new Error(`Slack webhook returned ${res.status}`);
    }
    delivered += 1;
  }

  return { delivered, skipped: 0 };
};

module.exports.formatBreach = formatBreach;
