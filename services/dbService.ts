import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
  orderBy,
  doc,
  updateDoc,
  increment,
  getDoc,
  limit,
  setDoc,
  runTransaction,
  Timestamp
} from "firebase/firestore";
import { getDb } from "../firebase";

// --- Interfaces ---

export interface Entry {
  id?: string;
  storeId: string;
  storeName: string;
  placeId?: string;
  productId: string;
  rawProductName: string;
  normalizedName: string;
  attributes: string[];
  price: number;
  currency: "JPY";
  taxIncluded: boolean;
  date: string; // "YYYY-MM-DD"
  region: string | null;
  userId: string;
  thanksCount: number;
  status: "active" | "hidden";
  source: "user" | "receipt" | "admin";
  importId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface RawImport {
  id?: string;
  userId: string;
  store: { storeId?: string; storeName?: string; placeId?: string };
  receiptImagePath: string;
  extractedText?: string;
  rawItems: Array<{
    rawLine: string;
    rawProductName?: string;
    rawPrice?: number;
    rawQty?: string;
    rawMeta?: any;
  }>;
  ai1: { model: string; createdAt: Timestamp; confidence?: number };
  status: "draft" | "confirmed" | "failed";
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Store {
  storeId: string;
  name: string;
  placeId?: string;
  location?: { lat: number; lng: number };
  region?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Product {
  normalizedName: string;
  aliases?: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// --- Normalization Logic ---

/**
 * 入力データを正規化する共通関数
 */
export const normalizeEntry = (data: any): Partial<Entry> => {
  return {
    storeId: data.storeId || "unknown",
    storeName: data.storeName || "不明な店舗",
    placeId: data.placeId || null,
    rawProductName: data.rawProductName || data.normalizedName || "",
    normalizedName: data.normalizedName || "",
    attributes: Array.isArray(data.attributes) ? data.attributes : (data.attributes ? [data.attributes] : []),
    price: Number(data.price) || 0,
    currency: "JPY",
    taxIncluded: data.taxIncluded !== undefined ? data.taxIncluded : true,
    date: data.date || new Date().toISOString().split('T')[0],
    region: data.region || null,
    userId: data.userId,
    status: data.status || "active",
    source: data.source || "user",
    importId: data.importId || null,
  };
};

// --- Service ---

export const dbService = {
  /**
   * AI抽出の生データを保存 (raw_imports)
   */
  async createRawImport(data: Omit<RawImport, "id" | "createdAt" | "updatedAt">): Promise<string> {
    const db = getDb();
    try {
      const docRef = await addDoc(collection(db, "raw_imports"), {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return docRef.id;
    } catch (error) {
      console.error("createRawImport error:", error);
      throw new Error("インポートデータの作成に失敗しました。");
    }
  },

  /**
   * インポートステータスを更新
   */
  async updateRawImportStatus(importId: string, status: RawImport["status"]) {
    const db = getDb();
    const ref = doc(db, "raw_imports", importId);
    await updateDoc(ref, { status, updatedAt: serverTimestamp() });
  },

  /**
   * エントリを確定保存 (entries + stores + products)
   */
  async addEntry(rawData: any) {
    const db = getDb();
    const entry = normalizeEntry(rawData);

    try {
      // 1. 商品の存在確認（検索はトランザクションの外で行う必要がある）
      const productRef = collection(db, "products");
      const productQuery = query(productRef, where("normalizedName", "==", entry.normalizedName));
      const productSnap = await getDocs(productQuery);
      
      let existingProductId = productSnap.empty ? null : productSnap.docs[0].id;

      return await runTransaction(db, async (transaction) => {
        let productId = existingProductId;

        // 商品が存在しない場合は新規作成
        if (!productId) {
          const newProductRef = doc(collection(db, "products"));
          transaction.set(newProductRef, {
            normalizedName: entry.normalizedName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          productId = newProductRef.id;
        }

        // 2. 店舗のUpsert (storeId = placeId if available)
        const storeId = entry.placeId || entry.storeId || "unknown";
        const storeRef = doc(db, "stores", storeId);
        transaction.set(storeRef, {
          storeId: storeId,
          name: entry.storeName,
          placeId: entry.placeId,
          region: entry.region,
          updatedAt: serverTimestamp(),
        }, { merge: true });

        // 3. エントリの保存
        const entryRef = doc(collection(db, "entries"));
        const finalEntry = {
          ...entry,
          storeId,
          productId,
          thanksCount: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        transaction.set(entryRef, finalEntry);

        return entryRef.id;
      });
    } catch (error) {
      console.error("addEntry error:", error);
      throw new Error("データの保存に失敗しました。");
    }
  },

  /**
   * 商品名で検索 (オプションで店舗フィルター)
   */
  async searchEntries(keyword: string, storeId?: string) {
    const db = getDb();
    try {
      const entriesRef = collection(db, "entries");
      let q;
      if (storeId) {
        q = query(
          entriesRef, 
          where("normalizedName", "==", keyword),
          where("storeId", "==", storeId),
          where("status", "==", "active"),
          orderBy("createdAt", "desc"),
          limit(50)
        );
      } else {
        q = query(
          entriesRef, 
          where("normalizedName", "==", keyword),
          where("status", "==", "active"),
          orderBy("createdAt", "desc"),
          limit(50)
        );
      }
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any } as Entry));
    } catch (error) {
      console.error("searchEntries error:", error);
      return [];
    }
  },

  /**
   * 新着エントリ取得
   */
  async getRecentEntries(limitCount: number = 10) {
    const db = getDb();
    try {
      const entriesRef = collection(db, "entries");
      const q = query(
        entriesRef,
        where("status", "==", "active"),
        orderBy("createdAt", "desc"),
        limit(limitCount)
      );
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any } as Entry));
    } catch (error) {
      console.error("getRecentEntries error:", error);
      return [];
    }
  },

  /**
   * 登録済み店舗をすべて取得
   */
  async getAllStores(): Promise<Store[]> {
    const db = getDb();
    try {
      const storesRef = collection(db, "stores");
      const q = query(storesRef, orderBy("name", "asc"));
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({ ...doc.data() as any } as Store));
    } catch (error) {
      console.error("getAllStores error:", error);
      return [];
    }
  },

  /**
   * 店舗を新規登録
   */
  async registerStore(data: { name: string; placeId: string; region?: string }): Promise<void> {
    const db = getDb();
    const storeRef = doc(db, "stores", data.placeId);
    await setDoc(storeRef, {
      storeId: data.placeId,
      name: data.name,
      placeId: data.placeId,
      region: data.region || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  },

  /**
   * ありがとうボタン（トランザクション）
   */
  async giveThanks(entryId: string, ownerUserId: string) {
    const db = getDb();
    try {
      await runTransaction(db, async (transaction) => {
        const entryRef = doc(db, "entries", entryId);
        const userRef = doc(db, "users", ownerUserId);

        transaction.update(entryRef, {
          thanksCount: increment(1),
          updatedAt: serverTimestamp()
        });

        transaction.set(userRef, {
          thanksReceived: increment(1),
          updatedAt: serverTimestamp()
        }, { merge: true });
      });
    } catch (error) {
      console.error("giveThanks error:", error);
      throw new Error("「ありがとう」の送信に失敗しました。");
    }
  }
};
