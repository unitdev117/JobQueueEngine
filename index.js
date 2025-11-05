#!/usr/bin/env node
// This is the main CLI entry for queuectl. It parses flags and runs commands.
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { loadConfig } from './src/config/index.js';
import { makeRoutes } from './src/routes/cliRoutes.js';
import { initLogger } from './src/utils/logger.js';

const cli = yargs(hideBin(process.argv))
  .option('QUEUE_ROOT', { type: 'string' })
  .option('LOG_DIR', { type: 'string' })
  .option('CONCURRENCY', { type: 'number' })
  .option('MAX_RETRIES', { type: 'number' })
  .option('BACKOFF_BASE', { type: 'number' })
  .option('MAX_BACKOFF_SEC', { type: 'number' })
  .option('JOB_TIMEOUT_MS', { type: 'number' })
  .middleware([(argv) => {
    const config = loadConfig(argv);
    initLogger(config.LOG_DIR);
    argv.__config = config;
    argv.__rawArgs = process.argv.slice(2);
  }])
  .scriptName('queuectl')
  .usage('$0 <cmd> [args]')
  .help(false)
  .version(false);
makeRoutes(cli);
cli.demandCommand(1).strict().parse();
