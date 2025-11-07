queuectl — tiny Mongo job runner
================================

I built this so I could queue shell commands, have a couple of workers chew through them, and peek at a dashboard without spinning up a whole web framework. Everything lives in MongoDB now, and the entire repo loads config values through `dotenv`, so dropping a `.env` file in the project root is enough to wire up ports, retry knobs, and the Mongo URI.

Getting started
---------------
1. Requirements: Node.js 18+, npm, and a MongoDB instance you can reach (defaults to `mongodb://127.0.0.1:27017/queuectl`).
2. Install deps: `npm install`.
3. Create a `.env` (optional but nice). `dotenv` auto-loads it before any command runs, so values are ready everywhere.
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
4. Start workers in one terminal: `queuectl worker start --count 1`.
5. Use another terminal for CLI commands (`queuectl enqueue ...`, `queuectl status`, etc.).

Everyday commands
-----------------
- Enqueue a job from JSON:  
  `queuectl enqueue '{"id":"job1","command":"sleep 2"}'`
- Enqueue with the shorthand flag:  
  `queuectl enqueue -c "echo hi there" --id hi1`
- See what’s going on:  
  `queuectl status`
- List jobs by state (pending | failed | processing | completed | dead):  
  `queuectl list --state completed`
- Inspect a single job (returns its `mongodb:jobs/<id>` location plus JSON):  
  `queuectl job show hi1`
- DLQ helpers:  
  `queuectl dlq list` and `queuectl dlq retry <id>`
- Stop workers gently (they finish their current lease first):  
  `queuectl worker stop`

Dashboard
---------
Set a port in `.env`, for example `PORT=9000`.

- When you run `queuectl worker start ...`, the CLI also serves `src/public` and prints `Dashboard available at http://localhost:9000`.
- If you just want the UI, run `queuectl dashboard`.
- The dashboard hits two endpoints provided by the CLI:
  - `GET /api/status` → counts + worker estimate + refresh interval.
  - `GET /api/list?state=...` → IDs in that state.
- Refresh timing comes from `REFRESH_MS` or `REFRESH_SECONDS` (dotenv feeds those into `process.env` too).

How it works (short version)
----------------------------
- Data: Mongo collections `jobs`, `logs`, and `workerruntimes`. No more JSON files littered around.
- Config: `src/config/index.js` calls `dotenv.config()` once, merges CLI flags, and exports normalized values for everything else.
- Workers: each loop `findOneAndUpdate`’s the oldest pending/failed job, stamps a lease, runs the shell command with a timeout, and writes the result back (`completed`, `failed` with `next_run_at`, or `dead` for the DLQ).
- Stop flag: `queuectl worker stop` flips a boolean inside `workerruntimes`, so all worker loops notice and exit without writing sentinel files.
- Logging: every CLI command and worker event writes a document into the `logs` collection.
- The Mongo connection is opened per command and closed automatically when the CLI finishes (workers keep it alive until they exit).

Manual test script I use
------------------------
1. `mongosh queuectl --eval "db.jobs.deleteMany({}); db.logs.deleteMany({}); db.workerruntimes.deleteMany({});"`
2. `queuectl worker start --count 1` (Terminal A).
3. `queuectl enqueue -c "echo hello world" --id quick1` (Terminal B) → check `queuectl list --state completed`.
4. `queuectl enqueue -c 'node -e "process.exit(1)"' --id fail1` → watch it move through `failed` and land in `dead`, then `queuectl dlq retry fail1` to bring it back.
5. Hit `http://localhost:9000` (or whatever port you set) to make sure the dashboard updates.

Troubleshooting notes
---------------------
- If `connect ECONNREFUSED` shows up, double-check Mongo is running and that `MONGODB_URI` in `.env` matches the reachable host.
- If `queuectl status` says workers aren’t running but you think they are, run `queuectl worker stop` once to clear any stale stop flag, then start them again.
- On Windows PowerShell, wrap the JSON payloads in single quotes and put the inner strings in double quotes.
- You can always rerun `npm install` to make sure dependencies (including `dotenv` and `mongoose`) are installed.
