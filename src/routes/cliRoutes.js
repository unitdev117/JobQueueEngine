import {
  enqueueController,
  statusController,
  showJobController,
} from "../controllers/jobController.js";
import {
  workerStartController,
  workerStopController,
  workersInfoController,
} from "../controllers/workerController.js";
import {
  dlqListController,
  dlqRetryController,
} from "../controllers/dlqController.js";
import { configSetController } from "../controllers/configController.js";
import { logJson } from "../utils/logger.js";

// I set up the CLI commands here in a very straightforward way.
export function makeRoutes(cli) {
  cli
    .command(
      "enqueue [job]",
      "Enqueue a job (JSON or -c string)",
      (y) =>
        y
          .positional("job", { type: "string", describe: "job JSON" })
          .option("c", { alias: "command", type: "string", describe: "shell-like command string" })
          .option("id", { type: "string", describe: "optional job id" }),
      async (argv) => {
        let raw = null;
        if (argv.c) {
          const obj = argv.id ? { id: argv.id, command: argv.c } : { command: argv.c };
          raw = JSON.stringify(obj);
        } else {
          raw = argv.job;
          if (!raw) {
            // Try to reconstruct from raw args after the word 'enqueue'
            const ix = argv.__rawArgs.findIndex((a) => a.toLowerCase() === 'enqueue');
            if (ix >= 0) raw = argv.__rawArgs.slice(ix + 1).join(' ');
          }
        }
        if (!raw) {
          console.error("Usage: queuectl enqueue '{\"id\":\"job1\",\"command\":\"sleep 2\"}' or queuectl enqueue -c \"sleep 2\" [--id job1]");
          process.exitCode = 1;
          return;
        }
        try {
          const job = enqueueController(argv.__config, raw);
          console.log(`Enqueued job ${job.id} with command: ${JSON.stringify(job.command)}`);
          console.log(job.id);
        } catch (e) {
          console.error(String(e.message || e));
          process.exitCode = 1;
        }
      }
    )
    .command(
      "worker [action]",
      "Start or stop workers",
      (y) =>
        y
          .positional("action", { choices: ["start", "stop"], type: "string", default: "start" })
          .option("count", { type: "number", describe: "number of workers (for start)" })
          .option("detach", { type: "boolean", describe: "run workers in background and return" }),
      async (argv) => {
        if ((argv.action || "start") === "start") {
          await workerStartController(argv.__config, argv.count, { detach: argv.detach });
        } else {
          const r = workerStopController(argv.__config);
          console.log(r.message);
        }
      }
    )
  .command(
      "status",
      "Show queue status",
      () => {},
      async (argv) => {
        const s = statusController(argv.__config);
        const w = workersInfoController(argv.__config);
        try { logJson({ at: new Date().toISOString(), type: 'command', cmd: 'status_cli' }); } catch {}
        console.log("Queue Status:");
        console.log(`  pending:   ${s.counts.pending}`);
        console.log(`  failed:    ${s.counts.failed}`);
        console.log(`  processing: ${s.counts.processing}`);
        console.log(`  completed: ${s.counts.completed}`);
        console.log(`  dead:      ${s.counts.dead}`);
        if (w && w.pid) {
          console.log(`Workers running: pid=${w.pid}, count=${w.count}`);
        } else {
          console.log("Workers not running");
        }
      }
    )
    .command(
      "job show <id>",
      "Show a job by id across states",
      (y) => y.positional("id", { type: "string" }),
      async (argv) => {
        const r = showJobController(argv.__config, argv.id);
        if (!r.found) {
          console.error(`Job not found: ${argv.id}`);
          process.exitCode = 1;
          return;
        }
        console.log(`Job ${r.id}`);
        console.log(`Location: ${r.file}`);
        console.log(JSON.stringify(r.job, null, 2));
      }
    )
    .command(
      "list",
      "List jobs by state",
      (y) =>
        y.option("state", {
          choices: ["pending", "processing", "completed", "failed", "dead"],
          demandOption: true,
        }),
      async (argv) => {
        try { logJson({ at: new Date().toISOString(), type: 'command', cmd: 'list', state: argv.state }); } catch {}
        const { listJobs, queuePaths } = await import("../queues/index.js");
        const { readJson } = await import("../utils/fsAtomic.js");
        const state = argv.state;
        let files = [];
        if (state === 'processing') {
          files = listJobs(argv.__config, 'processing');
        } else if (state === 'completed') {
          files = listJobs(argv.__config, 'archive');
        } else if (state === 'dead') {
          files = listJobs(argv.__config, 'dlq');
        } else if (state === 'pending' || state === 'failed') {
          const qfiles = listJobs(argv.__config, 'queue');
          const qdir = queuePaths(argv.__config).queue;
          for (const fname of qfiles) {
            try {
              const j = readJson(`${qdir}/${fname}`);
              const s = j.state || 'pending';
              if (s === state) files.push(fname);
            } catch {}
          }
        }
        const ids = files.map((f) => f.replace(/\.json$/i, ""));
        console.log(`Jobs (state=${argv.state}):`);
        if (ids.length === 0) console.log("  <none>");
        else ids.forEach((id) => console.log(`  - ${id}`));
      }
    )
  .command(
      "dlq <action> [id]",
      "DLQ operations (list, retry)",
      (y) =>
        y
          .positional("action", { choices: ["list", "retry"], type: "string" })
          .positional("id", { type: "string" }),
      async (argv) => {
        if (argv.action === "list") {
          const ids = dlqListController(argv.__config);
          console.log("DLQ Jobs:");
          if (ids.length === 0) console.log("  <none>");
          else ids.forEach((id) => console.log(`  - ${id}`));
        } else if (argv.action === "retry") {
          if (!argv.id) {
            console.error("Provide a job id: queuectl dlq retry <id>");
            process.exitCode = 1;
            return;
          }
          const r = dlqRetryController(argv.__config, argv.id);
          console.log(`Requeued DLQ job: ${r.id}`);
        }
      }
    )
    .command(
      "config set <key> <value>",
      "Configure via .env or flags (no file edit)",
      (y) =>
        y
          .positional("key", { type: "string" })
          .positional("value", { type: "string" }),
      async (argv) => {
        const r = configSetController(argv.key, argv.value);
        console.log(r.message);
      }
    );
}
