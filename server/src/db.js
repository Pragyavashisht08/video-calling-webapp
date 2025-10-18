import mongoose from "mongoose";

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb://127.0.0.1:27017/videomeet"; // change if needed

export async function connectDB() {
  if (mongoose.connection.readyState === 1) return;
  try {
    await mongoose.connect(MONGO_URI, {
      autoIndex: true,
    });
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  }
}
