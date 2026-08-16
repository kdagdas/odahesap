/**
 * Ödeme bilgileri — **cihazda saklanır, sunucuya hiç gitmez.**
 *
 * Cihazdan sunucuya geçmek kolay, tersi zordur: sunucudan silmek duyuru ve
 * güven kaybı demek. IBAN kişisel finansal veri; üç kişilik bir evin
 * ödeşmesi için onu bizim veritabanımızda tutmanın hiçbir gerekçesi yok.
 *
 * Bunun bir bedeli var ve kabul edildi: Salih'in IBAN'ı Salih'in telefonunda
 * duruyor, benimkinde değil. Bu yüzden **bir kez paylaşım** gerekiyor — Salih
 * kendi bilgisini paylaşıyor, açan herkesin cihazına kaydoluyor. Ev grubuna
 * tek mesaj herkesi kapsıyor ve ikinci seferde hazır.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export type PaymentInfo = {
  iban?: string;
  paypal?: string;
  /** SEPA transferinde IBAN tek başına yetmiyor, ad da isteniyor. */
  holder?: string;
};

const BENIM = "odeme:benim";
const BASKASI = (userId: string) => `odeme:kisi:${userId}`;

/** IBAN'ı karşılaştırma ve saklama için sadeleştirir; gösterimde bozulmaz. */
export const normalizeIban = (v?: string) =>
  (v || "").replace(/\s+/g, "").toUpperCase();

/** Dörderli gruplar — insan gözü IBAN'ı ancak böyle kontrol edebiliyor. */
export const formatIban = (v?: string) => {
  const raw = normalizeIban(v);
  return raw ? raw.replace(/(.{4})/g, "$1 ").trim() : "";
};

/**
 * Kaba bir geçerlilik kontrolü: iki harf ülke kodu + iki rakam + gerisi.
 * Tam IBAN doğrulaması (mod-97) bilerek yapılmıyor — yanlış yazılmış bir
 * IBAN'ı burada yakalamak bankanın işi, biz sadece bariz hatayı süzüyoruz.
 */
export const looksLikeIban = (v?: string) => /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(normalizeIban(v));

export async function getMyPayment(): Promise<PaymentInfo> {
  try {
    const raw = await AsyncStorage.getItem(BENIM);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export async function setMyPayment(info: PaymentInfo): Promise<void> {
  const temiz: PaymentInfo = {
    iban: normalizeIban(info.iban) || undefined,
    paypal: (info.paypal || "").trim().replace(/^https?:\/\/(www\.)?paypal\.me\//i, "") || undefined,
    holder: (info.holder || "").trim() || undefined,
  };
  await AsyncStorage.setItem(BENIM, JSON.stringify(temiz));
}

export async function getPaymentFor(userId: string): Promise<PaymentInfo | null> {
  try {
    const raw = await AsyncStorage.getItem(BASKASI(userId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function savePaymentFor(userId: string, info: PaymentInfo): Promise<void> {
  await AsyncStorage.setItem(BASKASI(userId), JSON.stringify(info));
}

/**
 * Paylaşılacak metin. Bağlantı uygulamayı açıp bilgiyi kaydediyor; altındaki
 * düz metin ise uygulamayı silmiş ya da henüz kurmamış birine de yarıyor.
 */
export function shareText(name: string, userId: string, info: PaymentInfo): string {
  const p = new URLSearchParams();
  p.set("u", userId);
  p.set("n", name);
  if (info.iban) p.set("iban", info.iban);
  if (info.paypal) p.set("pp", info.paypal);
  if (info.holder) p.set("h", info.holder);
  const satirlar = [`${name} · ödeme bilgisi`];
  if (info.holder) satirlar.push(`Ad: ${info.holder}`);
  if (info.iban) satirlar.push(`IBAN: ${formatIban(info.iban)}`);
  if (info.paypal) satirlar.push(`PayPal: paypal.me/${info.paypal}`);
  satirlar.push("", `KaSa'da kaydetmek için: odahesap://odeme?${p.toString()}`);
  return satirlar.join("\n");
}

/** PayPal.me bağlantısı — tutar dolu gelir, uçtan uca gerçekten çalışan tek yol. */
export function paypalLink(handle: string, amount: number, currency = "EUR"): string {
  return `https://paypal.me/${handle}/${amount.toFixed(2)}${currency}`;
}
