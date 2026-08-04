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
