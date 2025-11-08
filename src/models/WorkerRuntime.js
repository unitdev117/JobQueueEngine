import mongoose from "mongoose";

const { Schema } = mongoose;

const isoNow = () => new Date().toISOString();

const workerRuntimeSchema = new Schema(
  {
    _id: { type: String, default: "runtime" },
    pid: Number,
    count: Number,
    started_at: String,
    stopRequested: { type: Boolean, default: false },
    updated_at: { type: String, default: isoNow },
  },
  { minimize: false }
);

export const WorkerRuntimeModel =
  mongoose.models.WorkerRuntime ||
  mongoose.model("WorkerRuntime", workerRuntimeSchema);
