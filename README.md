queuectl — Filesystem-backed Job Queue (tiny but useful)

This is a small background job runner that uses folders and JSON files instead of a database. It’s basically a queue plus workers that pick up jobs and run shell commands. I like it because I can see everything on disk and debug easily.

1) Setup Instructions (how to run locally)
- Requirements: Node.js 18+ and npm
- Install dependencies: `npm install`
- Optional `.env` (defaults shown):
  - `QUEUE_ROOT=./data`
  - `LOG_DIR=./logs`
  - `CONCURRENCY=2`
  - `MAX_RETRIES=3`
  - `BACKOFF_BASE=2`
  - `MAX_BACKOFF_SEC=60`
  - `JOB_TIMEOUT_MS=30000`
- Start workers (one terminal): `queuectl worker start --count 1`
- Use another terminal for commands.

2) Usage Examples (with example outputs)
- Enqueue (string command):
  - Command: `queuectl enqueue '{"id":"job1","command":"sleep 2"}'`
  - Output: on Windows it prints something like `Enqueued job job1 with command: ["powershell","-NoLogo","-NoProfile","-Command","Start-Sleep -Seconds 2"]` and then `job1`
- Enqueue (quoted args):
  - Command: `queuectl enqueue '{"id":"job2","command":"echo \"hello world\""}'`
  - Output: `Enqueued job job2 with command: ["echo","hello world"]` then `job2`
- Status:
  - Command: `queuectl status`
  - Output shows counts: pending, failed (waiting for next_run_at), processing, completed, dead, and worker pid/count.
- List jobs:
  - `queuectl list --state completed` → prints archived job ids
  - `queuectl list --state dead` → prints DLQ job ids (or `<none>`)
- Show a job:
  - `queuectl job show job1` → prints the file path and the job JSON
- DLQ operations:
  - `queuectl dlq list` → lists jobs in DLQ
  - `queuectl dlq retry <jobId>` → moves job back to main queue and resets attempts
- Stop workers:
  - `queuectl worker stop` → writes a STOP flag so workers finish and exit

Sample happy path timeline:
- Start workers → `Starting 1 worker(s) ...`
- Enqueue a sleep job → status shows `processing: 1`
- After ~2s → status shows `processing: 0` and `completed: +1`

3) Architecture Overview (what’s going on)
- Storage layout (under `QUEUE_ROOT`):
  - `queue/` = waiting jobs
  - `processing/` = claimed jobs (has a basic lease until timestamp)
  - `archive/` = completed jobs (keeps stdout/stderr tails and exit code)
  - `dlq/` = dead jobs (gave up after retries)
- Job fields:
  - `id`, `command` (argv), `state` (pending|processing|completed|failed|dead), `attempts`, `max_retries`, `created_at`, `updated_at`, optional `next_run_at`, `stdout_tail`, `stderr_tail`, `exit_code`, `error`
- Worker logic:
  - Loop: requeue stale leases, pick next job, move to `processing/`, set a lease
  - Run: spawn the command with timeout; record short stdout/stderr tails
  - Success: write to `archive/` and remove from `processing/`
  - Failure: `attempts++`, compute backoff (base^attempt, capped), set `next_run_at`, put back as `failed` in `queue/`
  - Exceeded retries: move to `dlq/` with `state: dead`
  - Graceful stop: `logs/STOP` tells workers to finish current job and exit

4) Assumptions & Trade-offs (things I decided)
- Filesystem only (simple to understand, not clustered/distributed)
- Single process with N worker loops (multi-process would need file locks)
- Exponential backoff per attempt (base^attempt, capped by MAX_BACKOFF_SEC)
- `dlq retry` resets `attempts` to 0 (fresh start)
- Commands can be arrays or strings; on Windows, `sleep N` maps to PowerShell `Start-Sleep`

5) Testing Instructions (how to verify it works)
- Start a worker: `queuectl worker start --count 1`
- Success case: `queuectl enqueue '{"id":"ok1","command":"echo \"hi\""}'` → check `queuectl list --state completed` and `queuectl job show ok1`
- DLQ case: `queuectl enqueue '{"id":"bad1","command":"node -e \"process.exit(1)\""}'` → watch `queuectl status` until `dead` increases; see `queuectl dlq list` and `queuectl job show bad1`
- Retry from DLQ: `queuectl dlq retry bad1` → it goes back to `queue/` with `attempts: 0`
- Parallel test: `queuectl worker start --count 4` and enqueue multiple jobs; you should see faster completion

Extra notes (stuff that helped me)
- If status says workers aren't running, check/remove `logs/STOP` and start again
- In PowerShell, put JSON in single quotes and use double quotes inside


Mini shell runner example (what workers actually do)
- Each worker just runs the command from the job object.
- Examples:
  - `queuectl enqueue -c "sleep 2" --id s1` → executes sleep 2 → exit code 0 → mark job succeeded ✅
  - `queuectl enqueue -c "echo hello" --id e1` → executes echo hello → exit code 0 → mark job succeeded ✅ (stdout_tail has `hello`)
  - `queuectl enqueue -c "bash -lc 'exit 1'" --id f1` → executes in bash → exit code 1 → retries with backoff → DLQ after max retries ❌


6) End-to-End Test Cases (with expected output)

- Fresh start (clear logs)
  - Command: delete all files inside `logs/` (keep the folder). On Windows: `if (Test-Path logs) { Get-ChildItem logs -Force | Remove-Item -Recurse -Force }`
  - Why: start with clean logs so it’s easy to read what happens.

- Start workers (Terminal A)
  - `if exist logs\STOP del logs\STOP`
  - `queuectl worker start --count 1`
  - Expected: prints `Starting 1 worker(s) ...` and then live lines like `[worker 0] started job ...` when work appears.
  - In simple words: I’m booting one tiny robot that will run commands for me.

- Enqueue a quick success (Terminal B)
  - `queuectl enqueue -c "echo hello" --id t_echo`
  - Expected:
    - Console: `Enqueued job t_echo with command: ["echo","hello"]` then `t_echo`
    - After ~0.5s: `queuectl job show t_echo` shows `state: "completed"`, `exit_code: 0`, `stdout_tail: "hello\n"`
  - In simple words: I dropped a note saying “say hello”, and the worker said it and marked it done.

- Enqueue a timed success (Terminal B)
  - `queuectl enqueue -c "sleep 2" --id t_sleep`
  - Expected:
    - Immediately: `status` shows `processing: 1` while it sleeps
    - After ~2s: `status` shows `processing: 0`, `completed: +1`; `job show t_sleep` → `state: "completed"`
  - In simple words: I told the worker to wait 2 seconds; it waited and reported “done”.

- Enqueue a failure that goes to DLQ (Terminal B)
  - Portable fail: `queuectl enqueue -c 'node -e "process.exit(1)"' --id t_fail`
  - Expected progression (check `queuectl status` every ~2–3s):
    - `failed` goes up/down while retries wait (the job sits in `queue/` with `state: failed` and a `next_run_at`)
    - After max retries: `dead: +1`
    - `queuectl dlq list` shows `- t_fail`
    - `queuectl job show t_fail` shows `state: "dead"`, `attempts: <max+1>`, `exit_code: 500`
  - In simple words: I asked the worker to run a command that always fails; it tried a few times and then gave up and placed it in the “dead jobs” folder.

- Retry from DLQ (Terminal B)
  - `queuectl dlq retry t_fail`
  - Expected:
    - Console: `Requeued DLQ job: t_fail`
    - `job show t_fail` now points to `data/queue/t_fail.json` with `state: "pending"`, `attempts: 0`
    - Since the command still fails, it will retry and end up back in DLQ.
  - In simple words: I pulled the dead job back into the normal line to try again.

- Listing by state (Terminal B)
  - `queuectl list --state pending` → prints ids waiting in `queue/` with `state="pending"` or `<none>`
  - `queuectl list --state failed` → prints ids in `queue/` that are scheduled to retry (have `next_run_at`)
  - `queuectl list --state processing` → ids currently being worked on
  - `queuectl list --state completed` → ids inside `archive/`
  - `queuectl list --state dead` → ids inside `dlq/`
  - In simple words: show me what’s waiting, what’s retrying, what’s in progress, what’s done, and what’s dead.

- Status summary (Terminal B)
  - `queuectl status`
  - Expected: shows counts for `pending`, `failed`, `processing`, `completed`, `dead` and if workers are running.
  - In simple words: a scoreboard of where everything is.

- Stop workers (either terminal)
  - `queuectl worker stop`
  - Expected: `Stop signal written. Workers will exit soon.` → then `status` says `Workers not running`.
  - In simple words: tell the robot to finish what it’s doing and go to sleep.

7) Dashboard (local UI)
- Overview:
  - A simple static dashboard lives in `src/public` and is served by the CLI.
  - It shows counts for: pending, failed, processing, completed, dead. Clicking a status shows job IDs in that state.
  - Worker count uses `logs/workers.json` (runtime info). If not present, it estimates using unique `workerId` from jobs in `processing/`.
  - The UI auto-refreshes on an interval defined in `.env` (see “Refresh interval”).

- How to start the dashboard:
  - Set a port in `.env`, for example: `PORT=9000` (no spaces around `=`).
  - Option A (with workers): `queuectl worker start --count 1`
    - The CLI starts a tiny static server and prints: `Dashboard available at http://localhost:<PORT>`.
    - Note: using `--detach` will skip starting the dashboard server.
  - Option B (without workers): `queuectl dashboard`
    - Serves the dashboard standalone so you can view the current state without running workers.
  - Open the printed URL in your browser.

- Refresh interval (configure in `.env`):
  - Set one of the following:
    - `REFRESH_MS=15000` (milliseconds)
    - or `REFRESH_SECONDS=15` (seconds; aliases: `REFRESH_INTERVAL`, `DASHBOARD_REFRESH_SEC`)
  - Default is `30000` ms if unset.
  - The current interval is displayed at the top of the dashboard.

- Data sources (no API hooks required):
  - The server reads directly from the filesystem:
    - `QUEUE_ROOT` (default `./data`): reads `queue/`, `processing/`, `archive/`, `dlq/` to compute counts and lists.
    - `LOG_DIR` (default `./logs`): reads `workers.json` for worker count if present.
  - The UI calls simple local endpoints provided by the CLI server:
    - `GET /api/status` → `{ pending, failed, processing, completed, dead, workers, refresh_ms }`
    - `GET /api/list?state=pending|failed|processing|completed|dead` → `{ state, ids }`
