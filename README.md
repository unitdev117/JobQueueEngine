queuectl — Mongo powered job queue
==================================

This is a simple CLI that drops shell commands into MongoDB, spins up a couple of Node workers, and shows a tiny dashboard served from the same process. Recent changes moved all Mongo helpers into `src/db/mongo.js` and split the schemas into `src/models/Job.js`, `src/models/Log.js`, and `src/models/WorkerRuntime.js`, so the codebase stays small but a little more organized.

Local setup
-----------
I run these steps on a fresh machine:

1. Install Node.js 18+ and npm.
2. Make sure MongoDB is running locally or that you have a URI you can reach.
3. Clone the repo and `cd` into it.
4. Install dependencies: `npm install`.
5. Create a `.env` file in the project root (copy the snippet below). The CLI auto-loads it on each run.
   ```
   MONGODB_URI=mongodb://127.0.0.1:27017/queuectl
   PORT=9000
   CONCURRENCY=2
   MAX_RETRIES=3
   BACKOFF_BASE=2
   MAX_BACKOFF_SEC=60
   JOB_TIMEOUT_MS=30000
   REFRESH_MS=20000
   ```
6. Start workers in one terminal: `queuectl worker start --count 1`.
7. Use a second terminal for quick commands like `queuectl enqueue ...` or `queuectl status`.

Everyday commands
-----------------
- `queuectl enqueue '{"id":"job1","command":"sleep 2"}'` — enqueue from JSON.
- `queuectl enqueue -c "echo hi there" --id hi1` — same thing but let the CLI split the command string.
- `queuectl status` — print counts for each state plus worker info.
- `queuectl list --state failed` — show job IDs in a given state.
- `queuectl dlq list` and `queuectl dlq retry <id>` — basic dead-letter queue helpers.
- `queuectl worker stop` — set the stop flag so busy workers wind down.

Dashboard
---------
Set `PORT` in `.env` (example: `PORT=9000`). When workers run in the foreground, the CLI hosts `src/public` and logs the dashboard URL. You can also run `queuectl dashboard` to serve the UI without workers. The browser hits:
- `GET /api/status` for counts and refresh timing.
- `GET /api/list?state=pending` to list IDs.

How things are wired
--------------------
- `src/db/mongo.js` keeps a single shared mongoose connection (`connectMongo`/`disconnectMongo`). Normal commands connect on start and disconnect after the CLI returns. Long-running commands such as `worker start` and `dashboard` mark themselves so we skip the disconnect until they exit.
- `src/models/*.js` only define schemas: Jobs, Logs, and WorkerRuntime. `src/models/index.js` just re-exports them.
- `src/services/jobService.js` and `src/services/workerService.js` import the models and call `connectMongo` whenever they touch the database.
- `src/routes/cliRoutes.js` wires up the CLI commands with plain `cli.command` calls. I removed the old “job show” command to keep the interface small.
- Logs land in the Mongo `logs` collection through `src/utils/logger.js`, so you can inspect history with `mongosh`.

Quick test script
-----------------
This is how I usually verify the queue:
1. `mongosh queuectl --eval "db.jobs.deleteMany({}); db.logs.deleteMany({}); db.workerruntimes.deleteMany({});"`
2. `queuectl worker start --count 1` in Terminal A.
3. `queuectl enqueue -c "echo hello" --id quick1` in Terminal B → run `queuectl list --state completed`.
4. `queuectl enqueue -c 'node -e "process.exit(1)"' --id fail1` → watch it fail a few times, then `queuectl dlq retry fail1`.
5. Open `http://localhost:9000` (or your port) and confirm the dashboard updates.

Troubleshooting
---------------
- `connect ECONNREFUSED`: Mongo isn’t running or the URI in `.env` is wrong.
- Workers look stuck: run `queuectl worker stop`, wait a few seconds, then `queuectl worker start --count 1`.
- Windows quoting: wrap the JSON payload in single quotes and the inner strings in double quotes.
- Dependency mismatch: rerun `npm install`. All important libs (`dotenv`, `mongoose`, `yargs`) are regular dependencies.
