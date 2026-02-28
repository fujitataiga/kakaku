import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// 設定取得用のAPIエンドポイント
app.get("/api/config", (req, res) => {
  const getEnv = (key: string) => process.env[key] || process.env[`VITE_${key}`] || "";
  
  res.json({
    firebase: {
      apiKey: getEnv('FIREBASE_API_KEY'),
      authDomain: getEnv('FIREBASE_AUTH_DOMAIN'),
      projectId: getEnv('FIREBASE_PROJECT_ID'),
      storageBucket: getEnv('FIREBASE_STORAGE_BUCKET'),
      messagingSenderId: getEnv('FIREBASE_MESSAGING_SENDER_ID'),
      appId: getEnv('FIREBASE_APP_ID'),
      measurementId: getEnv('FIREBASE_MEASUREMENT_ID'),
    },
    googleMapsApiKey: getEnv('GOOGLE_MAPS_API_KEY'),
    geminiApiKey: getEnv('GEMINI_API_KEY') || process.env.API_KEY || "",
    isProduction: process.env.NODE_ENV === "production"
  });
});

// AI解析用のAPIエンドポイント (Gemini APIはフロントエンドから呼ぶのが原則だが、
// 抽出は画像データが大きいため、一時的にサーバーサイドで実装していた。
// ガイドラインに従い、フロントエンド実装を優先するが、
// このエンドポイントは予備として残すか、削除を検討する。
// 今回はフロントエンド側に寄せ直すため、一旦シンプルにする。)
app.post("/api/extract", async (req, res) => {
  res.status(501).json({ error: "Please use frontend Gemini API implementation." });
});

// Vite middleware for development
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile("dist/index.html", { root: "." });
    });
  }
}

setupVite();

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

export default app;
