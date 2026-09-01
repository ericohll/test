const WRITE_GROUPS = ['ReleaseManager', 'QALead'];

function getIdentity(event) {
  const claims = event?.requestContext?.authorizer?.claims || {};
  const rawGroups = claims['cognito:groups'];
  let groups = [];
  if (Array.isArray(rawGroups)) {
    groups = rawGroups;
  } else if (typeof rawGroups === 'string' && rawGroups.length > 0) {
    groups = rawGroups.replace(/^\[|\]$/g, '').split(',').map((g) => g.trim()).filter(Boolean);
  }
  return {
    sub: claims.sub || null,
    email: claims.email || null,
    groups,
  };
}

function hasAnyGroup(identity, groups) {
  return identity.groups.some((g) => groups.includes(g));
}

module.exports = { getIdentity, hasAnyGroup, WRITE_GROUPS };
