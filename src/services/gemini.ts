import { GoogleGenAI, ThinkingLevel } from "@google/genai";

const EXTRACTION_PROMPT = `
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

const NORMALIZATION_PROMPT = `
あなたは商品データ正規化の専門家です。
提供された生のレシート抽出データ（rawItems）を、検索に適した「正規形式」に変換してください。

【ルール】
1. 誤字脱字や表記ゆれを修正してください（例：ピーモン→ピーマン、ﾎｳﾚﾝｿｳ→ほうれん草）。
2. 略語を補完してください。
3. 商品名を「正規名称（normalizedName）」と「属性（attributes）」に分解してください。
   - normalizedName: 検索キーワードになる一般的で短い名称（例：キャベツ、牛乳）
   - attributes: 産地、内容量、サイズ、等級など（例：群馬県産、1L、国産）
4. 信頼度（confidence: 0.0〜1.0）と、その変換を行った理由（reason）を添えてください。

【入力コンテキスト】
店舗名: {{storeName}}
地域: {{region}}

【出力形式】
{
  "normalizedItems": [
    {
      "rawIndex": 0,
      "normalizedName": "正規名称",
      "attributes": ["属性1", "属性2"],
      "price": 123,
      "confidence": 0.95,
      "reason": "理由"
    }
  ]
}
`;

let globalApiKey: string | null = null;

export function setGeminiApiKey(key: string) {
  globalApiKey = key;
}

export const geminiService = {
  async extractRawItems(imageDataBase64: string, retryCount = 0): Promise<any> {
    const apiKey = globalApiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;
    
    // AI Studio のプレースホルダー文字列をチェック
    const isPlaceholder = !apiKey || apiKey === "AI Studio Free Tier" || apiKey.includes("YOUR_API_KEY");

    if (isPlaceholder) {
      throw new Error("AUTH_REQUIRED: AI機能を有効化してください。");
    }

    console.log(`[Gemini] Starting extraction (attempt ${retryCount + 1})...`);
    const ai = new GoogleGenAI({ apiKey });
    const model = "gemini-3-flash-preview"; 

    try {
      const response = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            { text: EXTRACTION_PROMPT },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: imageDataBase64,
              },
            },
          ],
        },
        config: {
          responseMimeType: "application/json",
        },
      });

      if (!response.text) {
        throw new Error("AIから空の応答が返されました。");
      }

      return JSON.parse(response.text.trim() || "{}");
    } catch (error: any) {
      console.error("[Gemini] Extraction error:", error);
      const errorMsg = error.message || "不明なエラー";
      
      if (errorMsg.includes("API key not valid") || errorMsg.includes("400") || errorMsg.includes("403")) {
        throw new Error("AUTH_REQUIRED: APIキーが無効です。再設定してください。");
      }

      if (errorMsg.includes("429") || errorMsg.includes("Too Many Requests")) {
        if (retryCount < 2) {
          await new Promise(resolve => setTimeout(resolve, 3000));
          return this.extractRawItems(imageDataBase64, retryCount + 1);
        }
        throw new Error("リクエストが多すぎます。1分ほど待ってから再度お試しください。");
      }

      if (retryCount < 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.extractRawItems(imageDataBase64, retryCount + 1);
      }
      throw new Error(`解析エラーが発生しました。(${errorMsg.slice(0, 100)})`);
    }
  },

  async normalizeItems(rawItems: any[], storeContext: { storeName?: string; region?: string }, retryCount = 0): Promise<any> {
    if (!rawItems || rawItems.length === 0) return { normalizedItems: [] };

    const apiKey = globalApiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey || apiKey === "AI Studio Free Tier") return { normalizedItems: [] };

    const ai = new GoogleGenAI({ apiKey });
    const model = "gemini-3-flash-preview";

    const prompt = NORMALIZATION_PROMPT
      .replace("{{storeName}}", storeContext.storeName || "不明")
      .replace("{{region}}", storeContext.region || "不明");

    try {
      const response = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            { text: prompt },
            { text: JSON.stringify(rawItems) },
          ],
        },
        config: {
          responseMimeType: "application/json",
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
        },
      });

      return JSON.parse(response.text?.trim() || "{}");
    } catch (error) {
      console.error("[Gemini] Normalization error:", error);
      if (retryCount < 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.normalizeItems(rawItems, storeContext, retryCount + 1);
      }
      return { normalizedItems: [] };
    }
  }
};
