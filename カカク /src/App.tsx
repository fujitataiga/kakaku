/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, 
  Search, 
  History, 
  Heart, 
  Upload, 
  Store, 
  MapPin, 
  Loader2,
  ChevronRight,
  ArrowLeft,
  CheckCircle2,
  Settings,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getAuthInstance } from './firebase';
import { signInAnonymously, onAuthStateChanged, User } from 'firebase/auth';
import { geminiService } from './services/gemini';
import { dbService, Entry } from './services/dbService';
import { storageService } from './services/storageService';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Autocomplete from "react-google-autocomplete";

declare var google: any;

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<'search' | 'upload' | 'history'>('search');
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchStore, setSearchStore] = useState<{name: string, placeId: string} | null>(null);
  const [searchResults, setSearchResults] = useState<Entry[]>([]);
  const [recentEntries, setRecentEntries] = useState<Entry[]>([]);
  const [registeredStores, setRegisteredStores] = useState<any[]>([]);
  const [uploadStep, setUploadStep] = useState<'idle' | 'analyzing' | 'confirming' | 'manual' | 'addStore' | 'success'>('idle');
  const [previousStep, setPreviousStep] = useState<'idle' | 'manual' | 'confirming'>('idle');
  const [analyzedData, setAnalyzedData] = useState<any>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [selectedStore, setSelectedStore] = useState<{ name: string; placeId: string; storeId?: string } | null>(null);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  
  // 地域設定の状態管理
  const [userPrefecture, setUserPrefecture] = useState<string>(localStorage.getItem('userPrefecture') || '東京都');
  const [userCity, setUserCity] = useState<string>(localStorage.getItem('userCity') || '');
  const userRegion = `${userPrefecture}${userCity}`;
  
  const [showSettings, setShowSettings] = useState(false);
  const [manualData, setManualData] = useState({
    storeName: '',
    normalizedName: '',
    attributes: '',
    price: '',
    date: new Date().toISOString().split('T')[0]
  });
  const [loadingMessage, setLoadingMessage] = useState("レシートの内容を読み取っています");
  const [showMobileTip, setShowMobileTip] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);
  const [isAiReady, setIsAiReady] = useState<boolean | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // APIキーが選択済みかチェック
    const checkApiKey = async () => {
      // サーバー側に本物のキーがあるかチェック
      const serverKey = process.env.GEMINI_API_KEY;
      const hasServerKey = serverKey && serverKey !== "AI Studio Free Tier" && !serverKey.includes("YOUR_API_KEY");

      if (hasServerKey) {
        setIsAiReady(true);
        return;
      }

      if (typeof (window as any).aistudio?.hasSelectedApiKey === 'function') {
        const hasKey = await (window as any).aistudio.hasSelectedApiKey();
        setIsAiReady(hasKey);
      } else {
        setIsAiReady(true); // 開発環境など
      }
    };
    checkApiKey();
  }, []);

  useEffect(() => {
    let interval: any;
    if (uploadStep === 'analyzing') {
      const messages = [
        "レシートの内容を読み取っています",
        "商品の名前と価格を抽出しています",
        "データを正規化しています",
        "もう少しで完了します...",
        "通信環境によっては時間がかかる場合があります"
      ];
      let i = 0;
      interval = setInterval(() => {
        i = (i + 1) % messages.length;
        setLoadingMessage(messages[i]);
      }, 3000);
    } else {
      setLoadingMessage("レシートの内容を読み取っています");
    }
    return () => clearInterval(interval);
  }, [uploadStep]);
  useEffect(() => {
    // Check if on mobile and not in standalone mode
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const isStandalone = (window.navigator as any).standalone || window.matchMedia('(display-mode: standalone)').matches;
    if (isMobile && !isStandalone) {
      setShowMobileTip(true);
    }

    try {
      const auth = getAuthInstance();
      signInAnonymously(auth).catch((err: any) => {
        console.error(err);
        if (err.code === 'auth/configuration-not-found') {
          setError("Firebaseコンソールで「匿名認証」を有効にする必要があります。Authentication > Sign-in method から有効にしてください。");
        } else {
          setError("Firebase認証に失敗しました。設定を確認してください。");
        }
      });
      const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
      
      // Fetch recent entries
      fetchRecent();
      fetchStores();

      // Get user location for biasing search
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            setUserCoords({
              lat: position.coords.latitude,
              lng: position.coords.longitude
            });
          },
          (err) => console.warn("Geolocation error:", err),
          { enableHighAccuracy: false, timeout: 5000, maximumAge: 600000 }
        );
      }
      
      return () => unsubscribe();
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Firebaseの初期化に失敗しました。");
    }
  }, []);

  const fetchRecent = async () => {
    try {
      const recent = await dbService.getRecentEntries(10);
      setRecentEntries(recent);
    } catch (error) {
      console.error("Failed to fetch recent entries:", error);
    }
  };

  const fetchStores = async () => {
    try {
      const stores = await dbService.getAllStores();
      setRegisteredStores(stores);
    } catch (error) {
      console.error("Failed to fetch stores:", error);
    }
  };

  if (error) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center space-y-4">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-red-500 rotate-45" />
          </div>
          <h2 className="text-xl font-bold text-red-600">設定が必要です</h2>
          <p className="text-gray-600 text-sm leading-relaxed">
            {error}
            <br /><br />
            AI Studioの「Secrets」パネルでFirebaseの環境変数を設定してください。
          </p>
        </div>
      </div>
    );
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsLoading(true);
    try {
      const results = await dbService.searchEntries(searchQuery.trim(), searchStore?.placeId);
      setSearchResults(results);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const compressImage = (file: File): Promise<Blob> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          // AI解析に十分な最小限のサイズに縮小
          const MAX_WIDTH = 800;
          const MAX_HEIGHT = 800;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            // 画質を落としつつ、コントラストを少し上げて文字を読みやすくする
            ctx.filter = 'contrast(1.2) grayscale(1)'; 
            ctx.drawImage(img, 0, 0, width, height);
          }
          
          // 画質を0.4まで落として極限まで軽量化
          canvas.toBlob((blob) => {
            resolve(blob || file);
          }, 'image/jpeg', 0.4);
        };
      };
    });
  };

  const handleSelectApiKey = async () => {
    try {
      if (typeof (window as any).aistudio?.openSelectKey === 'function') {
        await (window as any).aistudio.openSelectKey();
        setIsAiReady(true);
        setAuthError(false);
        setError(null);
      }
    } catch (err) {
      console.error("Key selection failed:", err);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploadStep('analyzing');
    setIsLoading(true);
    setAuthError(false);
    setError(null);

    try {
      // 0. 画像を圧縮
      const compressedFile = await compressImage(file);
      const tempImportId = crypto.randomUUID();

      // 1 & 2. Storage保存とFirestore記録を「バックグラウンド」で開始 (awaitしない)
      const storageUploadPromise = storageService.uploadReceiptImage(user.uid, tempImportId, compressedFile)
        .catch(err => {
          console.warn("Storage upload failed (CORS or other):", err);
          return "";
        });
      
      const dbRecordPromise = dbService.createRawImport({
        userId: user.uid,
        store: {},
        receiptImagePath: "", // 後で更新するか、失敗なら空
        rawItems: [],
        ai1: { model: "gemini-3-flash-preview", createdAt: new Date() as any },
        status: "draft"
      }).catch(err => {
        console.warn("Firestore record failed:", err);
        return "";
      });

      // 3. AI解析を「即座に」開始
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1];
          
          // AI解析をスタート
          const rawResult = await geminiService.extractRawItems(base64);
          
          if (!rawResult.items || rawResult.items.length === 0) {
            throw new Error("レシートから商品を読み取れませんでした。");
          }

          // 並行して走らせていたID取得を待つ
          const id = await dbRecordPromise;
          if (id) setImportId(id);

          // 正規化
          const normalizedResult = await geminiService.normalizeItems(rawResult.items, {
            storeName: rawResult.storeName,
            region: userRegion
          });

          if (!normalizedResult.normalizedItems || normalizedResult.normalizedItems.length === 0) {
            setAnalyzedData({
              storeName: rawResult.storeName,
              date: rawResult.date,
              items: rawResult.items.map((item: any) => ({
                normalizedName: item.rawProductName,
                attributes: [],
                price: item.rawPrice,
                rawProductName: item.rawProductName
              }))
            });
          } else {
            setAnalyzedData({
              storeName: rawResult.storeName,
              date: rawResult.date,
              items: normalizedResult.normalizedItems.map((item: any) => ({
                ...item,
                rawProductName: rawResult.items[item.rawIndex]?.rawProductName || item.normalizedName
              }))
            });
          }
          
          setUploadStep('confirming');
        } catch (err: any) {
          console.error("Analysis error:", err);
          if (err.message?.includes("AUTH_REQUIRED")) {
            setAuthError(true);
            setIsAiReady(false);
          } else {
            setError(`解析に失敗しました。もう一度試してみてください。`);
          }
          setUploadStep('idle');
        } finally {
          setIsLoading(false);
        }
      };
      reader.readAsDataURL(compressedFile);
    } catch (error: any) {
      console.error("Upload error:", error);
      setUploadStep('idle');
      setIsLoading(false);
      alert(`準備に失敗しました: ${error.message || '不明なエラー'}`);
    }
  };

  const handleConfirmUpload = async () => {
    if (!analyzedData || !user || !importId) return;
    if (!selectedStore) {
      alert("店舗を選択してください。");
      return;
    }
    setIsLoading(true);
    try {
      for (const item of analyzedData.items) {
        await dbService.addEntry({
          storeId: selectedStore.placeId || selectedStore.storeId,
          storeName: selectedStore.name,
          placeId: selectedStore.placeId || selectedStore.storeId,
          rawProductName: item.rawProductName,
          normalizedName: item.normalizedName,
          attributes: item.attributes,
          price: item.price,
          date: analyzedData.date || new Date().toISOString().split('T')[0],
          region: userRegion,
          userId: user.uid,
          source: "receipt",
          importId: importId
        });
      }
      await dbService.updateRawImportStatus(importId, "confirmed");
      setUploadStep('success');
      fetchRecent();
    } catch (error) {
      console.error(error);
      alert("保存に失敗しました。");
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!selectedStore) {
      alert("店舗を選択してください。");
      return;
    }
    setIsLoading(true);
    try {
      await dbService.addEntry({
        storeId: selectedStore.placeId || selectedStore.storeId,
        storeName: selectedStore.name,
        placeId: selectedStore.placeId || selectedStore.storeId,
        rawProductName: manualData.normalizedName,
        normalizedName: manualData.normalizedName,
        attributes: manualData.attributes ? [manualData.attributes] : [],
        price: Number(manualData.price),
        date: manualData.date,
        region: userRegion,
        userId: user.uid,
        source: "user"
      });
      setUploadStep('success');
      fetchRecent();
    } catch (error) {
      console.error(error);
      alert("保存に失敗しました。");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegisterStore = async (place: any) => {
    if (!place || !place.place_id) return;
    setIsLoading(true);
    try {
      await dbService.registerStore({
        name: place.name || place.formatted_address?.split(' ')[0] || "",
        placeId: place.place_id,
        region: userRegion
      });
      await fetchStores();
      setUploadStep(previousStep);
      alert("店舗を登録しました。");
    } catch (error) {
      console.error(error);
      alert("店舗の登録に失敗しました。");
    } finally {
      setIsLoading(false);
    }
  };

  const handleThanks = async (entryId: string, ownerId: string) => {
    if (!user) return;
    try {
      await dbService.giveThanks(entryId, ownerId);
      setSearchResults(prev => prev.map(item => 
        item.id === entryId ? { ...item, thanksCount: item.thanksCount + 1 } : item
      ));
      setRecentEntries(prev => prev.map(item => 
        item.id === entryId ? { ...item, thanksCount: item.thanksCount + 1 } : item
      ));
    } catch (error) {
      console.error(error);
    }
  };

  const updateItem = (idx: number, field: string, value: any) => {
    setAnalyzedData((prev: any) => {
      const newItems = [...prev.items];
      newItems[idx] = { ...newItems[idx], [field]: value };
      return { ...prev, items: newItems };
    });
  };

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#141414] font-sans selection:bg-lime-100">
      {/* Mobile Installation Tip */}
      <AnimatePresence>
        {showMobileTip && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-24 left-4 right-4 z-[60] bg-white p-4 rounded-2xl shadow-2xl border border-lime-100 flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-lime-50 rounded-full flex items-center justify-center flex-shrink-0">
                <Upload className="w-5 h-5 text-lime-600" />
              </div>
              <div>
                <p className="text-sm font-bold">ホーム画面に追加して快適に</p>
                <p className="text-[10px] text-gray-500">ブラウザのメニューから「ホーム画面に追加」を選択すると、アプリのように使えます。</p>
              </div>
            </div>
            <button 
              onClick={() => setShowMobileTip(false)}
              className="text-gray-400 hover:text-gray-600 p-1"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-black/5 px-4 py-3 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-lime-600">カカク</h1>
        <div className="flex items-center gap-3">
          {user && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-[10px] font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                <MapPin className="w-2.5 h-2.5" />
                <span>{userRegion}</span>
              </div>
              <button 
                onClick={() => setShowSettings(true)}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">地域の設定</h2>
                <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-gray-100 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-400 uppercase">1. 都道府県</label>
                    <select 
                      value={userPrefecture}
                      onChange={(e) => {
                        setUserPrefecture(e.target.value);
                        setUserCity(''); // 都道府県が変わったら市区町村をリセット
                      }}
                      className="w-full bg-gray-50 border border-black/5 rounded-xl p-3 focus:ring-2 focus:ring-lime-500/20 outline-none appearance-none"
                    >
                      {PREFECTURES.map(pref => (
                        <option key={pref} value={pref}>{pref}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-400 uppercase">2. 市区町村</label>
                    <Autocomplete
                      apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
                      onPlaceSelected={(place) => {
                        // 都道府県名を除去して市区町村名だけを抽出
                        let cityName = place.name || place.formatted_address?.split(' ')[0] || "";
                        cityName = cityName.replace(userPrefecture, '');
                        setUserCity(cityName);
                      }}
                      options={{
                        types: ["(cities)"],
                        componentRestrictions: { country: "jp" },
                      }}
                      className="w-full bg-gray-50 border border-black/5 rounded-xl p-3 focus:ring-2 focus:ring-lime-500/20 outline-none"
                      placeholder={`${userPrefecture}内の市区町村を検索...`}
                      defaultValue={userCity}
                    />
                  </div>
                  
                  <div className="p-3 bg-lime-50 rounded-xl border border-lime-100">
                    <p className="text-[10px] text-lime-700 font-bold">現在の設定地域:</p>
                    <p className="text-sm font-black text-lime-900">{userRegion || '未設定'}</p>
                  </div>
                </div>

                <button 
                  onClick={() => {
                    localStorage.setItem('userPrefecture', userPrefecture);
                    localStorage.setItem('userCity', userCity);
                    setShowSettings(false);
                  }}
                  className="w-full bg-lime-600 text-white py-3 rounded-xl font-bold hover:bg-lime-700 transition-all shadow-lg shadow-lime-600/20"
                >
                  設定を保存
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <main className="max-w-2xl mx-auto pb-24">
        {/* AI有効化の案内 */}
        {isAiReady === false && (
          <div className="mx-4 mt-4 p-6 bg-lime-50 border border-lime-100 rounded-3xl shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-lime-500 rounded-full">
                <CheckCircle2 className="w-5 h-5 text-white" />
              </div>
              <h3 className="font-bold text-lime-900">AI機能を有効化しましょう</h3>
            </div>
            <p className="text-sm text-lime-800 mb-4">
              レシートの自動読み取り機能を使用するには、一度だけ設定が必要です。
            </p>
            <button
              onClick={handleSelectApiKey}
              className="w-full py-4 bg-lime-600 text-white rounded-2xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform shadow-lg shadow-lime-600/20"
            >
              <Settings className="w-5 h-5" />
              AI機能をオンにする
            </button>
          </div>
        )}

        {/* 一般エラー表示 */}
        {error && !authError && (
          <div className="mx-4 mt-4 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center justify-between">
            <p className="text-red-700 text-sm">{error}</p>
            <button onClick={() => setError(null)} className="p-1 text-red-400">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <AnimatePresence mode="wait">
          {activeTab === 'search' && (
            <motion.div 
              key="search"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="p-4 space-y-6"
            >
              <div className="space-y-3">
                <form onSubmit={handleSearch} className="relative">
                  <input 
                    type="text"
                    placeholder="商品名で検索（例：ピーマン）"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-white border border-black/5 rounded-2xl py-4 pl-12 pr-4 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
                  />
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <button 
                    type="submit"
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-lime-600 text-white px-4 py-2 rounded-xl font-medium text-sm hover:bg-lime-700 transition-colors"
                  >
                    検索
                  </button>
                </form>

                <div className="bg-white border border-black/5 rounded-2xl p-3 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <MapPin className="w-4 h-4 text-gray-400" />
                    <span className="text-[10px] font-bold text-gray-400 uppercase">登録済み店舗で絞り込む</span>
                  </div>
                  <select 
                    onChange={(e) => {
                      const store = registeredStores.find(s => s.storeId === e.target.value);
                      setSearchStore(store ? { name: store.name, placeId: store.storeId } : null);
                    }}
                    value={searchStore?.placeId || ""}
                    className="w-full bg-gray-50 border border-black/5 rounded-xl p-2 text-sm outline-none focus:ring-2 focus:ring-lime-500/20 appearance-none"
                  >
                    <option value="">すべての店舗</option>
                    {registeredStores.map(store => (
                      <option key={store.storeId} value={store.storeId}>{store.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-4">
                {isLoading && (
                  <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-lime-600" />
                  </div>
                )}
                
                {!isLoading && (searchQuery ? searchResults : recentEntries).length > 0 && (
                  <div className="grid gap-4">
                    <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">
                      {searchQuery ? `「${searchQuery}」の検索結果` : "新着の価格情報"}
                    </h2>
                    {(searchQuery ? searchResults : recentEntries).map((entry) => (
                      <motion.div 
                        key={entry.id}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-white p-4 rounded-2xl shadow-sm border border-black/5 flex flex-col gap-3"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="font-bold text-lg">{entry.normalizedName}</h3>
                            <p className="text-xs text-gray-500 italic">
                              {entry.attributes && entry.attributes.length > 0 ? entry.attributes.join(' ') : '補足なし'}
                            </p>
                          </div>
                          <div className="text-right">
                            <span className="text-2xl font-black text-lime-700">¥{entry.price}</span>
                            <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">{entry.date}</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 p-2 rounded-lg">
                          <Store className="w-4 h-4" />
                          <span className="font-medium">{entry.storeName}</span>
                          <span className="text-gray-300">|</span>
                          <MapPin className="w-4 h-4" />
                          <span>{entry.region}</span>
                        </div>

                        <div className="flex justify-between items-center pt-2 border-t border-gray-50">
                          <span className="text-[10px] text-gray-400">レシート表記: {entry.rawProductName}</span>
                          <button 
                            onClick={() => handleThanks(entry.id!, entry.userId)}
                            className="flex items-center gap-1.5 text-xs font-bold text-lime-600 hover:bg-lime-50 px-3 py-1.5 rounded-full transition-colors"
                          >
                            <Heart className={cn("w-4 h-4", entry.thanksCount > 0 && "fill-lime-600")} />
                            ありがとう {entry.thanksCount > 0 && entry.thanksCount}
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}

                {!isLoading && searchQuery && searchResults.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <p>該当する商品が見つかりませんでした。</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'upload' && (
            <motion.div 
              key="upload"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="p-4"
            >
              <div className="bg-white rounded-3xl p-8 shadow-xl border border-black/5 text-center space-y-6">
                {uploadStep === 'idle' && (
                  <>
                    <div className="w-20 h-20 bg-lime-50 rounded-full flex items-center justify-center mx-auto">
                      <Camera className="w-10 h-10 text-lime-600" />
                    </div>
                    <div className="space-y-2">
                      <h2 className="text-2xl font-black">情報を追加</h2>
                      <p className="text-gray-500 text-sm">レシート撮影または手入力で登録できます</p>
                    </div>
                    <div className="space-y-3">
                      <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full bg-lime-600 text-white py-4 rounded-2xl font-bold text-lg shadow-lg shadow-lime-600/20 hover:bg-lime-700 transition-all flex items-center justify-center gap-2"
                      >
                        <Camera className="w-5 h-5" />
                        レシートを撮影
                      </button>
                      <button 
                        onClick={() => setUploadStep('manual')}
                        className="w-full bg-white text-lime-600 border-2 border-lime-600 py-4 rounded-2xl font-bold text-lg hover:bg-lime-50 transition-all flex items-center justify-center gap-2"
                      >
                        <Upload className="w-5 h-5" />
                        手入力で追加
                      </button>
                      <button 
                        onClick={() => {
                          setPreviousStep('idle');
                          setUploadStep('addStore');
                        }}
                        className="w-full bg-gray-100 text-gray-600 py-3 rounded-2xl font-bold text-sm hover:bg-gray-200 transition-all flex items-center justify-center gap-2"
                      >
                        <Store className="w-4 h-4" />
                        店舗を追加
                      </button>
                    </div>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileChange} 
                      accept="image/*" 
                      className="hidden" 
                    />
                  </>
                )}

                {uploadStep === 'addStore' && (
                  <div className="text-left space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
                      <ArrowLeft className="w-5 h-5 cursor-pointer" onClick={() => setUploadStep(previousStep)} />
                      <h2 className="text-xl font-bold">店舗を追加</h2>
                    </div>
                    <div className="space-y-4">
                      <p className="text-sm text-gray-500">Googleマップから店舗を検索して、アプリに登録します。</p>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-400 uppercase">店舗を検索</label>
                        <Autocomplete
                          apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
                          onPlaceSelected={handleRegisterStore}
                          options={{
                            types: ["establishment"],
                            componentRestrictions: { country: "jp" },
                            fields: ["name", "place_id", "formatted_address"],
                            ...(userCoords ? {
                              location: new google.maps.LatLng(userCoords.lat, userCoords.lng),
                              radius: 5000,
                            } : {})
                          }}
                          className="w-full bg-gray-50 border border-black/5 rounded-xl p-3 focus:ring-2 focus:ring-lime-500/20 outline-none"
                          placeholder="スーパーの名前を入力..."
                        />
                      </div>
                    </div>
                  </div>
                )}

                {uploadStep === 'manual' && (
                  <form onSubmit={handleManualSubmit} className="text-left space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
                      <ArrowLeft className="w-5 h-5 cursor-pointer" onClick={() => setUploadStep('idle')} />
                      <h2 className="text-xl font-bold">手入力で登録</h2>
                    </div>
                    
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase">店舗を選択</label>
                        <select 
                          required
                          value={selectedStore?.placeId || ""}
                          onChange={(e) => {
                            const store = registeredStores.find(s => s.storeId === e.target.value);
                            setSelectedStore(store ? { name: store.name, placeId: store.storeId } : null);
                          }}
                          className="w-full bg-gray-50 border border-black/5 rounded-xl p-3 focus:ring-2 focus:ring-lime-500/20 outline-none appearance-none"
                        >
                          <option value="">店舗を選択してください</option>
                          {registeredStores.map(store => (
                            <option key={store.storeId} value={store.storeId}>{store.name}</option>
                          ))}
                        </select>
                        <button 
                          type="button"
                          onClick={() => {
                            setPreviousStep('manual');
                            setUploadStep('addStore');
                          }}
                          className="text-[10px] text-lime-600 font-bold flex items-center gap-1 mt-1 hover:underline"
                        >
                          <Store className="w-2.5 h-2.5" />
                          新しく店舗を追加する
                        </button>
                        {registeredStores.length === 0 && (
                          <p className="text-[10px] text-red-500 font-bold">※先に「店舗を追加」からスーパーを登録してください</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase">商品名</label>
                        <input 
                          type="text" 
                          required
                          placeholder="例：ピーマン"
                          value={manualData.normalizedName}
                          onChange={(e) => setManualData({...manualData, normalizedName: e.target.value})}
                          className="w-full bg-gray-50 border border-black/5 rounded-xl p-3 focus:ring-2 focus:ring-lime-500/20 outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase">補足（産地・量など）</label>
                        <input 
                          type="text" 
                          placeholder="例：茨城県産 4個入り"
                          value={manualData.attributes}
                          onChange={(e) => setManualData({...manualData, attributes: e.target.value})}
                          className="w-full bg-gray-50 border border-black/5 rounded-xl p-3 focus:ring-2 focus:ring-lime-500/20 outline-none"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-gray-400 uppercase">価格（税込）</label>
                          <input 
                            type="number" 
                            required
                            placeholder="198"
                            value={manualData.price}
                            onChange={(e) => setManualData({...manualData, price: e.target.value})}
                            className="w-full bg-gray-50 border border-black/5 rounded-xl p-3 focus:ring-2 focus:ring-lime-500/20 outline-none"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-gray-400 uppercase">日付</label>
                          <input 
                            type="date" 
                            required
                            value={manualData.date}
                            onChange={(e) => setManualData({...manualData, date: e.target.value})}
                            className="w-full bg-gray-50 border border-black/5 rounded-xl p-3 focus:ring-2 focus:ring-lime-500/20 outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    <button 
                      type="submit"
                      disabled={isLoading}
                      className="w-full bg-lime-600 text-white py-4 rounded-2xl font-bold hover:bg-lime-700 transition-all shadow-lg shadow-lime-600/20 disabled:opacity-50"
                    >
                      {isLoading ? '登録中...' : '登録する'}
                    </button>
                  </form>
                )}

                {uploadStep === 'analyzing' && (
                  <div className="py-12 space-y-6">
                    <Loader2 className="w-16 h-16 animate-spin text-lime-600 mx-auto" />
                    <div className="space-y-2">
                      <h2 className="text-xl font-bold">AIが解析中...</h2>
                      <p className="text-gray-500 text-sm">{loadingMessage}</p>
                    </div>
                  </div>
                )}

                {uploadStep === 'confirming' && analyzedData && (
                  <div className="text-left space-y-6">
                    <div className="space-y-4 border-b border-gray-100 pb-4">
                      <div className="flex items-center gap-2">
                        <Store className="w-5 h-5 text-lime-600" />
                        <h2 className="text-xl font-bold">店舗を確定</h2>
                      </div>
                      <select 
                        required
                        value={selectedStore?.placeId || ""}
                        onChange={(e) => {
                          const store = registeredStores.find(s => s.storeId === e.target.value);
                          setSelectedStore(store ? { name: store.name, placeId: store.storeId } : null);
                        }}
                        className="w-full bg-gray-50 border border-black/5 rounded-xl p-3 focus:ring-2 focus:ring-lime-500/20 outline-none appearance-none"
                      >
                        <option value="">店舗を選択してください</option>
                        {registeredStores.map(store => (
                          <option key={store.storeId} value={store.storeId}>{store.name}</option>
                        ))}
                      </select>
                      <button 
                        type="button"
                        onClick={() => {
                          setPreviousStep('confirming');
                          setUploadStep('addStore');
                        }}
                        className="text-[10px] text-lime-600 font-bold flex items-center gap-1 mt-1 hover:underline"
                      >
                        <Store className="w-2.5 h-2.5" />
                        新しく店舗を追加する
                      </button>
                      {selectedStore ? (
                        <p className="text-[10px] text-lime-600 font-bold">確定済み: {selectedStore.name}</p>
                      ) : (
                        <div className="space-y-1">
                          <p className="text-[10px] text-orange-500 font-bold">AI推測: {analyzedData.storeName || '不明'}</p>
                          <p className="text-[10px] text-red-500 font-bold animate-pulse">※登録済み店舗から選択してください</p>
                          {registeredStores.length === 0 && (
                            <p className="text-[10px] text-red-600 font-bold">（先に「店舗を追加」からスーパーを登録してください）</p>
                          )}
                        </div>
                      )}
                    </div>
                    
                    <div className="space-y-3">
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">抽出された商品（編集可能）</p>
                      {analyzedData.items.map((item: any, idx: number) => (
                        <div key={idx} className="bg-gray-50 p-4 rounded-2xl border border-black/5 space-y-3">
                          <div className="flex gap-3">
                            <div className="flex-1 space-y-1">
                              <label className="text-[10px] font-bold text-gray-400 uppercase">商品名</label>
                              <input 
                                type="text"
                                value={item.normalizedName}
                                onChange={(e) => updateItem(idx, 'normalizedName', e.target.value)}
                                className="w-full bg-white border border-black/5 rounded-lg p-2 text-sm outline-none"
                              />
                            </div>
                            <div className="w-24 space-y-1">
                              <label className="text-[10px] font-bold text-gray-400 uppercase">価格</label>
                              <input 
                                type="number"
                                value={item.price}
                                onChange={(e) => updateItem(idx, 'price', e.target.value)}
                                className="w-full bg-white border border-black/5 rounded-lg p-2 text-sm outline-none font-bold text-lime-700"
                              />
                            </div>
                          </div>
                          <div className="flex justify-between items-center">
                            <div className="flex gap-1">
                              {item.attributes.map((attr: string, aIdx: number) => (
                                <span key={aIdx} className="text-[10px] bg-white border border-black/5 px-2 py-0.5 rounded-full text-gray-500">
                                  {attr}
                                </span>
                              ))}
                            </div>
                            <div className="flex items-center gap-1">
                              <div className={cn(
                                "w-2 h-2 rounded-full",
                                item.confidence > 0.8 ? "bg-green-500" : item.confidence > 0.5 ? "bg-yellow-500" : "bg-red-500"
                              )} />
                              <span className="text-[10px] text-gray-400">信頼度: {Math.round(item.confidence * 100)}%</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-3 pt-4">
                      <button 
                        onClick={() => setUploadStep('idle')}
                        className="flex-1 bg-gray-100 text-gray-600 py-4 rounded-2xl font-bold hover:bg-gray-200 transition-all"
                      >
                        やり直し
                      </button>
                      <button 
                        onClick={handleConfirmUpload}
                        className="w-full bg-lime-600 text-white py-4 rounded-2xl font-bold hover:bg-lime-700 transition-all shadow-lg shadow-lime-600/20"
                      >
                        登録する
                      </button>
                    </div>
                  </div>
                )}

                {uploadStep === 'success' && (
                  <div className="py-12 space-y-6">
                    <div className="w-20 h-20 bg-lime-100 rounded-full flex items-center justify-center mx-auto">
                      <CheckCircle2 className="w-12 h-12 text-lime-600" />
                    </div>
                    <div className="space-y-2">
                      <h2 className="text-2xl font-black">登録完了！</h2>
                      <p className="text-gray-500 text-sm">価格情報が共有されました</p>
                    </div>
                    <button 
                      onClick={() => {
                        setUploadStep('idle');
                        setActiveTab('search');
                      }}
                      className="w-full bg-lime-600 text-white py-4 rounded-2xl font-bold hover:bg-lime-700 transition-all"
                    >
                      検索に戻る
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-lg border-t border-black/5 px-6 py-3 pb-8 z-50">
        <div className="max-w-md mx-auto flex justify-between items-center">
          <NavButton 
            active={activeTab === 'search'} 
            onClick={() => setActiveTab('search')}
            icon={<Search className="w-6 h-6" />}
            label="検索"
          />
          <div className="relative -top-12">
            <button 
              onClick={() => setActiveTab('upload')}
              className={cn(
                "relative w-20 h-20 flex items-center justify-center transition-all duration-300",
                activeTab === 'upload' ? "scale-110" : "hover:scale-105"
              )}
            >
              {/* ショッピングバッグの持ち手 */}
              <div className={cn(
                "absolute -top-3 w-10 h-8 border-4 rounded-t-full transition-colors duration-300",
                activeTab === 'upload' ? "border-lime-600" : "border-lime-500"
              )} />
              
              {/* ショッピングバッグの本体 */}
              <div className={cn(
                "w-full h-full rounded-b-3xl rounded-t-xl border-4 border-[#F5F5F0] shadow-2xl flex items-center justify-center transition-colors duration-300",
                "bg-lime-500 text-white"
              )}>
                <span className="text-lg font-black tracking-tighter">登録</span>
              </div>
            </button>
          </div>
          <NavButton 
            active={activeTab === 'history'} 
            onClick={() => setActiveTab('history')}
            icon={<History className="w-6 h-6" />}
            label="履歴"
          />
        </div>
      </nav>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 transition-all",
        active ? "text-lime-600" : "text-gray-400"
      )}
    >
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
      {active && <motion.div layoutId="nav-dot" className="w-1 h-1 bg-lime-600 rounded-full" />}
    </button>
  );
}
