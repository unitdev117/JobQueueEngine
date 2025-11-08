import mongoose from "mongoose";

const { Schema } = mongoose;

const isoNow = () => new Date().toISOString();

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
      default: isoNow,
      index: true,
    },
    updated_at: { type: String, default: isoNow },
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

export const JobModel = mongoose.models.Job || mongoose.model("Job", jobSchema);
