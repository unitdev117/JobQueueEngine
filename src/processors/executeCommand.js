import { spawn } from "node:child_process";
import { StatusCodes } from "http-status-codes";

// This runs the job's command using spawn (not exec) and enforces a timeout.
// It also collects the end of stdout/stderr so we can store a short tail.
export async function executeCommand(command, timeoutMs) {
  if (!Array.isArray(command) || command.length === 0) {
    return {
      code: StatusCodes.BAD_REQUEST,
      error: "invalid command",
      stdout: "",
      stderr: "",
    };
  }
  const [cmd, ...args] = command;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let finished = false;

    let child;
    try {
      child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      return resolve({
        code: StatusCodes.NOT_FOUND,
        error: e.message,
        stdout: "",
        stderr: "",
      });
    }
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        try {
          child.kill("SIGKILL");
        } catch {}
        resolve({
          code: StatusCodes.REQUEST_TIMEOUT,
          error: "timeout",
          stdout: tail(stdout),
          stderr: tail(stderr),
        });
      }
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (e) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        code: StatusCodes.INTERNAL_SERVER_ERROR,
        error: e.message,
        stdout: tail(stdout),
        stderr: tail(stderr),
      });
    });
    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const ok = (code ?? 0) === 0;
      resolve({
        code: ok ? StatusCodes.OK : StatusCodes.INTERNAL_SERVER_ERROR,
        error: ok ? undefined : "non-zero exit",
        stdout: tail(stdout),
        stderr: tail(stderr),
      });
    });
  });
}

// Keeps only the last part of a big string so logs don't explode in size.
function tail(s, max = 4000) {
  if (!s) return "";
  return s.length > max ? s.slice(-max) : s;
}
