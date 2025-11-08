import { connectMongo } from "../db/mongo.js";
import { LogModel, WorkerRuntimeModel } from "../models/index.js";
let mongoUri = null;

export function initLogger(uri) {
  mongoUri = uri || mongoUri || process.env.MONGODB_URI;
}

export function logJson(event) {
  void persistLog(event);
}

export async function writeWorkersRuntime(info) {
  try {
    await connectMongo(mongoUri);
    await WorkerRuntimeModel.findByIdAndUpdate(
      "runtime",
      {
        _id: "runtime",
        ...info,
        stopRequested: false,
        updated_at: new Date().toISOString(),
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    debugLog("writeWorkersRuntime failed", err);
  }
}

export async function setWorkersStopFlag(flag = true) {
  try {
    await connectMongo(mongoUri);
    await WorkerRuntimeModel.findByIdAndUpdate(
      "runtime",
      {
        _id: "runtime",
        stopRequested: flag,
        updated_at: new Date().toISOString(),
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    debugLog("setWorkersStopFlag failed", err);
  }
}

export async function readWorkersRuntime() {
  try {
    await connectMongo(mongoUri);
    const doc = await WorkerRuntimeModel.findById("runtime").lean().exec();
    return doc || null;
  } catch (err) {
    debugLog("readWorkersRuntime failed", err);
    return null;
  }
}

async function persistLog(event) {
  try {
    await connectMongo(mongoUri);
    const payload = { ...event };
    if (!payload.at) payload.at = new Date().toISOString();
    await LogModel.create(payload);
  } catch (err) {
    debugLog("logJson failed", err);
  }
}

function debugLog(message, err) {
  if (process.env.DEBUG_LOGGER !== "true") return;
  console.error(`[logger] ${message}`, err);
}
