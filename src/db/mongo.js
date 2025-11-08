import mongoose from "mongoose";

let cachedUri = null;
let connectPromise = null;

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

export async function disconnectMongo() {
  if (mongoose.connection.readyState === 0) return;
  if (mongoose.connection.readyState === 2 && connectPromise) {
    try {
      await connectPromise;
    } catch {
      // swallow connection error so we can still close cleanly
    }
  }
  await mongoose.connection.close();
  connectPromise = null;
}
