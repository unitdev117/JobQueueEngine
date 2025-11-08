import {
  enqueueController,
  statusController,
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
import { listJobIdsByState } from "../services/jobService.js";

// I set up the CLI commands here in a very straight-forward way.
export function makeRoutes(cli, opts = {}) {
  const markLongRunning =
    typeof opts.markLongRunningCommand === "function"
      ? opts.markLongRunningCommand
      : null;

  cli.command(
    "enqueue [job]",
    "Enqueue a job (JSON or -c string)",
    (y) =>
      y
        .positional("job", { type: "string", describe: "job JSON" })
        .option("c", {
          alias: "command",
          type: "string",
          describe: "shell-like command string",
        })
        .option("id", { type: "string", describe: "optional job id" }),
    async (argv) => {
      let raw = argv.job || null;
      if (argv.c) {
        raw = JSON.stringify(
          argv.id ? { id: argv.id, command: argv.c } : { command: argv.c }
        );
      }
      if (!raw && Array.isArray(argv.__rawArgs)) {
        const ix = argv.__rawArgs.findIndex(
          (a) => a.toLowerCase() === "enqueue"
        );
        if (ix >= 0) raw = argv.__rawArgs.slice(ix + 1).join(" ");
      }
      if (!raw) return;
      const job = await enqueueController(argv.__config, raw);
      console.log(job.id);
    }
  );

  cli.command(
    "worker [action]",
    "Start or stop workers",
    (y) =>
      y
        .positional("action", {
          choices: ["start", "stop"],
          type: "string",
          default: "start",
        })
        .option("count", {
          type: "number",
          describe: "Number of workers (for start)",
        })
        .option("detach", {
          type: "boolean",
          describe: "Run workers in background and return",
        }),
    async (argv) => {
      const action = (argv.action || "start").toLowerCase();
      if (action === "stop") {
        const r = workerStopController(argv.__config);
        console.log(r.message);
        return;
      }
      const workerOpts = argv.detach ? { detach: true } : {};
      if (!argv.detach && markLongRunning) {
        markLongRunning();
      }
      await workerStartController(argv.__config, argv.count, workerOpts);
    }
  );

  cli.command(
    "status",
    "Show queue status",
    () => {},
    async (argv) => {
      const s = await statusController(argv.__config);
      const w = await workersInfoController(argv.__config);
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
  );

  cli.command(
    "list",
    "List jobs by state",
    (y) =>
      y.option("state", {
        choices: ["pending", "processing", "completed", "failed", "dead"],
        demandOption: true,
      }),
    async (argv) => {
      const ids = await listJobIdsByState(argv.__config, argv.state);
      console.log(`Jobs (state=${argv.state}):`);
      if (ids.length === 0) console.log("  <none>");
      else ids.forEach((id) => console.log(`  - ${id}`));
    }
  );

  cli.command(
    "dlq <action> [id]",
    "DLQ operations (list, retry)",
    (y) =>
      y
        .positional("action", { choices: ["list", "retry"], type: "string" })
        .positional("id", { type: "string" }),
    async (argv) => {
      if (argv.action === "list") {
        const ids = await dlqListController(argv.__config);
        console.log("DLQ Jobs:");
        if (ids.length === 0) console.log("  <none>");
        else ids.forEach((id) => console.log(`  - ${id}`));
      } else if (argv.action === "retry") {
        if (!argv.id) return;
        const r = await dlqRetryController(argv.__config, argv.id);
        console.log(`Requeued DLQ job: ${r.id}`);
      }
    }
  );

  cli.command(
    "config set <key> <value>",
    "Configure via .env or flags",
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
