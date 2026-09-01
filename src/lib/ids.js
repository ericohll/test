const crypto = require('crypto');

const FIELD_SEP = '\x1f';

function findingId(tool, projectId, externalFindingId) {
  return crypto
    .createHash('sha256')
    .update(`${tool}${FIELD_SEP}${projectId}${FIELD_SEP}${externalFindingId}`)
    .digest('hex');
}

function batchKey(tool, projectId, runDate) {
  return `${tool}#${projectId}#${runDate}`;
}

function s3RawKey(tool, projectId, runDate) {
  return `raw/${tool}/${projectId}/${runDate}/data.json`;
}

module.exports = { findingId, batchKey, s3RawKey };
