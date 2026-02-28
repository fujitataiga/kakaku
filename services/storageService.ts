import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getStorageInstance } from "../firebase";

export const storageService = {
  /**
   * 画像を Firebase Storage にアップロードする
   * @param userId ユーザーID
   * @param importId インポートID
   * @param file 画像ファイル (Blob or File)
   * @returns Storageのパス
   */
  async uploadReceiptImage(userId: string, importId: string, file: Blob | File): Promise<string> {
    const storage = getStorageInstance();
    const storagePath = `receipt_images/${userId}/${importId}.jpg`;
    const storageRef = ref(storage, storagePath);
    
    await uploadBytes(storageRef, file);
    return storagePath;
  },

  /**
   * StorageのパスからダウンロードURLを取得する
   */
  async getImageUrl(path: string): Promise<string> {
    const storage = getStorageInstance();
    const storageRef = ref(storage, path);
    return await getDownloadURL(storageRef);
  }
};
