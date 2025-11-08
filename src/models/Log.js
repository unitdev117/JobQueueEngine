import mongoose from "mongoose";

const { Schema } = mongoose;

const logSchema = new Schema(
  {},
  {
    strict: false,
    minimize: false,
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

export const LogModel = mongoose.models.Log || mongoose.model("Log", logSchema);
