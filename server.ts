import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // AI解析用のAPIエンドポイント
  app.post("/api/extract", async (req, res) => {
    try {
      const { image } = req.body;
      // 1. システム設定のキー (Vercel等)
      // 2. ユーザー選択のキー (AI Studio)
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;

      const isPlaceholder = !apiKey || apiKey === "AI Studio Free Tier" || apiKey.includes("YOUR_API_KEY");

      if (isPlaceholder) {
        return res.status(500).json({ 
          error: "AUTH_REQUIRED: AI機能の有効化が必要です。画面のボタンから設定してください。" 
        });
      }

      const ai = new GoogleGenAI({ apiKey });
      const model = "gemini-1.5-flash";

      const prompt = `
あなたは日本のスーパーのレシート解析の専門家です。
画像から、商品行を抽出し、以下のJSON形式で出力してください。
商品名と思われる文字列と、価格と思われる数値を抽出してください。
行全体のテキストも「rawLine」として残してください。

【出力形式】
{
  "storeName": "店舗名（不明ならnull）",
  "items": [
    {
      "rawLine": "行全体のテキスト",
      "rawProductName": "抽出した商品名",
      "rawPrice": 123,
      "rawQty": "数量（あれば）"
    }
  ]
}
`;

      const result = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: image,
              },
            },
          ],
        },
        config: {
          responseMimeType: "application/json",
        },
      });

      const text = result.text;
      // JSON部分だけを抽出（念のため）
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : text;
      
      res.json(JSON.parse(jsonStr));
    } catch (error: any) {
      console.error("Server AI Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
