import mongoose from "mongoose";

const { Schema } = mongoose;

let cachedUri = null;
let connectPromise = null;
let keepAlive = false;

export async function connectMongo(uri) {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  const targetUri =
    uri ||
    cachedUri ||
    process.env.MONGODB_URI ||
    "mongodb://127.0.0.1:27017/queuectl";
  if (!connectPromise) {
    cachedUri = targetUri;
    mongoose.set("strictQuery", true);
    connectPromise = mongoose
      .connect(targetUri, {
        dbName: process.env.MONGODB_DB || undefined,
      })
      .catch((err) => {
        connectPromise = null;
        throw err;
      });
  }
  return connectPromise;
}

export function setMongoKeepAlive(flag = true) {
  keepAlive = flag;
}

export async function disconnectMongo(force = false) {
  if (!force && keepAlive) return;
  try {
    if (mongoose.connection.readyState === 0) return;
    if (mongoose.connection.readyState === 2 && connectPromise) {
      await connectPromise.catch(() => {});
    }
    await mongoose.connection.close();
  } catch {}
}

const jobSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    command: { type: [String], required: true },
    state: {
      type: String,
      enum: ["pending", "failed", "processing", "completed", "dead"],
      default: "pending",
    },
    attempts: { type: Number, default: 0 },
    max_retries: { type: Number, default: 3 },
    created_at: {
      type: String,
      default: () => new Date().toISOString(),
      index: true,
    },
    updated_at: { type: String, default: () => new Date().toISOString() },
    next_run_at: { type: String },
    exit_code: { type: Number },
    error: { type: String },
    stdout_tail: { type: String },
    stderr_tail: { type: String },
    lease: {
      workerId: { type: String },
      lease_until: { type: String },
    },
  },
  { minimize: false }
);
jobSchema.index({ state: 1, next_run_at: 1, created_at: 1 });

const logSchema = new Schema(
  {},
  {
    strict: false,
    minimize: false,
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

const workerRuntimeSchema = new Schema(
  {
    _id: { type: String, default: "runtime" },
    pid: Number,
    count: Number,
    started_at: String,
    stopRequested: { type: Boolean, default: false },
    updated_at: { type: String, default: () => new Date().toISOString() },
  },
  { minimize: false }
);

export const JobModel = mongoose.models.Job || mongoose.model("Job", jobSchema);
export const LogModel = mongoose.models.Log || mongoose.model("Log", logSchema);
export const WorkerRuntimeModel =
  mongoose.models.WorkerRuntime ||
  mongoose.model("WorkerRuntime", workerRuntimeSchema);
