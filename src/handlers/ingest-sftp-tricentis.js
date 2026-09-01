const { runSftpIngest } = require('../ingest/sftpPull');

exports.handler = async () => runSftpIngest({ tool: process.env.TOOL });
