/**
 * Profil fotoğrafı: seç, küçült, yükle.
 *
 * Küçültme telefonda yapılıyor. Bir telefon fotoğrafı 3-5 MB; base64'e
 * çevrilince 7 MB'ı geçiyor. Sunucuya ham hâlde göndermek hem mobil veriyi
 * yakar hem ücretsiz katmanın belleğini zorlar. 256 pikselde bir avatar
 * ~15 KB'a iniyor ve ekranda hiçbir fark görünmüyor.
 */
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { api } from "./api";

const AVATAR_SIZE = 256;

/**
 * Fişin sunucuya gönderilecek en uzun kenarı.
 *
 * **Ölçülerek düşürülebilir, ölçülmeden düşürülmemeli.** 2000 bilerek
 * temkinli seçildi: modern kamera 3000-4000 piksel çekiyor, yani bu tek
 * başına 3-4 kat kazandırıyor ve termal fiş yazısını okunmaz yapma riski
 * düşük. 1600 ve 1200 muhtemelen de çalışır ama bunu **aynı fişi üç boyutta
 * taratıp** çıkan kalem sayısını karşılaştırarak doğrulamak gerekiyor —
 * tahminle düşürmek fişin yarısını sessizce kaybettirebilir.
 */
export const RECEIPT_MAX_EDGE = 2000;

/**
 * Fişi küçültüp base64 döndürür.
 *
 * Üç yerde birden kazandırıyor ve hiçbiri Gemini kotasıyla ilgili değil:
 *  1. **Telefonda**: tam çözünürlükte base64 üretmek 3 MB'lık bir dizge
 *     kurmak demek; küçülterek bu iş baştan yapılmıyor.
 *  2. **Yüklemede**: mobil veride en uzun adım buydu.
 *  3. **Sunucuda**: Render'ın zayıf işlemcisi base64'ü çözüp modele veriyor.
 *
 * Sıkıştırma 0.6'dan 0.8'e ÇIKARILDI. Ters gibi görünüyor ama değil: termal
 * fiş yazısını bozan şey çözünürlük değil JPEG artefaktı. Küçülmüş bir
 * görüntüde daha az sıkıştırmak hem küçük hem daha okunur bir dosya veriyor.
 *
 * Galeriye kaydedilen kopya bundan etkilenmiyor — orası tam çözünürlükte
 * kalıyor, çünkü fişin kendisi sunucuda saklanmıyor ve telefondaki kopya
 * kullanıcının tek kaydı.
 */
export async function shrinkReceiptToBase64(
  uri: string, width?: number, height?: number,
): Promise<string | null> {
  const context = ImageManipulator.manipulate(uri);
  const uzunKenar = Math.max(width || 0, height || 0);
  // Olculer bilinmiyorsa kucultme YAPILMIYOR: yanlis oranla yeniden
  // boyutlandirmak fisi ezip okunmaz yapardi, buyuk gondermek yalnizca yavas.
  if (uzunKenar > RECEIPT_MAX_EDGE && width && height) {
    const oran = RECEIPT_MAX_EDGE / uzunKenar;
    context.resize({
      width: Math.round(width * oran),
      height: Math.round(height * oran),
    });
  }
  const image = await context.renderAsync();
  const out = await image.saveAsync({
    compress: 0.8,
    format: SaveFormat.JPEG,
    base64: true,
  });
  return out.base64 ?? null;
}

async function shrinkToBase64(uri: string): Promise<string | null> {
  const context = ImageManipulator.manipulate(uri).resize({
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
  });
  const image = await context.renderAsync();
  const out = await image.saveAsync({
    compress: 0.7,
    format: SaveFormat.JPEG,
    base64: true,
  });
  return out.base64 ?? null;
}

type PickResult = { ok: boolean; error?: string };

async function pickAndUpload(
  launch: () => Promise<ImagePicker.ImagePickerResult>
): Promise<PickResult> {
  const res = await launch();
  if (res.canceled) return { ok: false };
  const asset = res.assets?.[0];
  if (!asset?.uri) return { ok: false, error: "Görsel alınamadı" };

  const base64 = await shrinkToBase64(asset.uri);
  if (!base64) return { ok: false, error: "Görsel işlenemedi" };

  await api("/auth/photo", { method: "PUT", body: JSON.stringify({ image_base64: base64 }) });
  return { ok: true };
}

export async function pickPhotoFromLibrary(): Promise<PickResult> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { ok: false, error: "Galeri izni verilmedi" };
  return pickAndUpload(() =>
    ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    })
  );
}

export async function takePhotoWithCamera(): Promise<PickResult> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return { ok: false, error: "Kamera izni verilmedi" };
  return pickAndUpload(() =>
    ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    })
  );
}

export async function removePhoto(): Promise<void> {
  await api("/auth/photo", { method: "DELETE" });
}
