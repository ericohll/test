const { runApiIngest } = require('../ingest/apiPull');
const { fetchProject } = require('../ingest/sources/sonarqube');

exports.handler = async () => runApiIngest({ tool: process.env.TOOL, fetchProject });
