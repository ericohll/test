// Self-service SNS email subscriptions: a signed-in user subscribes their own
// address to gate-breach alerts for one project, scoped via a FilterPolicy on
// the shared AlertsTopic's `project_id` message attribute (see gate-eval.js's
// publishBreach). Subscribing someone else's address is not allowed.

const { SNSClient, SubscribeCommand } = require('@aws-sdk/client-sns');
const { createApiHandler, requiredString } = require('../lib/apiHandler');
const { created, forbidden, badRequest, notFound } = require('../lib/http');
const { getIdentity } = require('../lib/auth');
const { getProject } = require('../repo/projects');
const { logAction } = require('../repo/userActions');

const sns = new SNSClient({});

async function subscribeRoute(req, conn) {
  const identity = getIdentity(req.event);
  const project_id = requiredString(req.body, 'project_id');

  const requestedEmail = typeof req.body.email === 'string' && req.body.email.trim() !== ''
    ? req.body.email.trim()
    : identity.email;

  if (!requestedEmail) {
    return badRequest('email is required');
  }
  if (identity.email && requestedEmail !== identity.email) {
    return forbidden('You may only subscribe your own email address');
  }

  const project = await getProject(conn, project_id);
  if (!project) return notFound('Project not found');

  const result = await sns.send(new SubscribeCommand({
    TopicArn: process.env.ALERTS_TOPIC_ARN,
    Protocol: 'email',
    Endpoint: requestedEmail,
    Attributes: {
      FilterPolicy: JSON.stringify({ project_id: [project_id] }),
      FilterPolicyScope: 'MessageAttributes',
    },
    ReturnSubscriptionArn: true,
  }));

  await logAction(conn, {
    user_id: identity.sub,
    action_type: 'notification_subscribe',
    target_ref: `project:${project_id}`,
    detail: { email: requestedEmail },
  });

  return created({
    project_id,
    email: requestedEmail,
    subscription_arn: result.SubscriptionArn,
  });
}

exports.handler = createApiHandler({
  'POST /notifications/subscriptions': { handle: subscribeRoute, tx: true },
});

module.exports.subscribeRoute = subscribeRoute;
