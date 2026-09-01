const { runApiIngest } = require('../ingest/apiPull');
const { fetchProject } = require('../ingest/sources/gitlab');

exports.handler = async () => runApiIngest({ tool: process.env.TOOL, fetchProject });
