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
const PAYLASILDI = "odeme:paylasildi";

/** IBAN'ı karşılaştırma ve saklama için sadeleştirir; gösterimde bozulmaz. */
export const normalizeIban = (v?: string) =>
  (v || "").replace(/\s+/g, "").toUpperCase();

/** Dörderli gruplar — insan gözü IBAN'ı ancak böyle kontrol edebiliyor. */
export const formatIban = (v?: string) => {
  const raw = normalizeIban(v);
  return raw ? raw.replace(/(.{4})/g, "$1 ").trim() : "";
};

/**
 * IBAN uzunlukları — ülke başına SABİTTİR (ISO 13616).
 *
 * SEPA alanı ve ev arkadaşlarının gerçekten hesabı olabilecek ülkeler.
 * Listede olmayan bir ülke kodu reddedilir: önceden `XX00ABC123` geçiyordu.
 */
const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18,
  EE: 20, ES: 24, FI: 18, FR: 27, GB: 22, GI: 23, GR: 27, HR: 21, HU: 28,
  IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31,
  NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27,
  TR: 26,
};

/**
 * ISO 13616 mod-97 sağlaması.
 *
 * İlk dört karakter sona alınır, harfler A=10…Z=35 ile rakama çevrilir ve
 * sayının 97'ye bölümünden 1 kalmalıdır. Sayı 2^53'ü kolayca aştığı için
 * parça parça bölünüyor.
 */
const mod97 = (raw: string): number => {
  const yeni = raw.slice(4) + raw.slice(0, 4);
  let kalan = 0;
  for (const ch of yeni) {
    const d = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const basamak of d) kalan = (kalan * 10 + Number(basamak)) % 97;
  }
  return kalan;
};

/**
 * IBAN gerçekten geçerli mi?
 *
 * **Eski karar değiştirildi.** Önceden yalnızca şekle bakılıyordu ve gerekçe
 * "yanlış yazılmış bir IBAN'ı yakalamak bankanın işi" idi. Bu yanlış: SEPA
 * transferi IBAN'a bakar, isme bakmaz. Yapısal olarak geçerli ama yanlış
 * yazılmış bir IBAN reddedilmez — para bir yabancıya gider ve geri alınması
 * zordur. mod-97 tam olarak bunu yakalar (rakam atlama, yer değiştirme).
 *
 * Yakalayamadığı tek şey: **başkasına ait geçerli bir IBAN.** Onun panzehiri
 * ödeyenin ekranında hesap sahibinin adını görmesi.
 *
 * Harf yasaklanmıyor: Almanya ve Türkiye'de gövde tamamen rakam ama İngiltere
 * (`GB29NWBK…`) ve Hollanda (`NL91ABNA…`) harf taşıyor; yasaklamak ev
 * arkadaşının hesabını engellerdi. Uzunluk + sağlama zaten harf hatasını da
 * yakalıyor.
 */
export function ibanError(v?: string): string | null {
  const raw = normalizeIban(v);
  if (!raw) return null;
  if (!/^[A-Z]{2}/.test(raw)) return "IBAN iki harfli ülke koduyla başlamalı";
  const ulke = raw.slice(0, 2);
  const uzunluk = IBAN_LENGTHS[ulke];
  if (!uzunluk) return `${ulke} bilinen bir IBAN ülke kodu değil`;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(raw)) return "IBAN'da geçersiz karakter var";
  if (raw.length !== uzunluk) {
    const fark = uzunluk - raw.length;
    return `${ulke} IBAN'ı ${uzunluk} karakter olmalı · ${Math.abs(fark)} karakter ${fark > 0 ? "eksik" : "fazla"}`;
  }
  if (mod97(raw) !== 1) return "IBAN doğrulaması tutmuyor — bir rakam hatalı olabilir";
  return null;
}

/**
 * O ülkenin IBAN'ı nasıl görünüyor — yer tutucu için.
 *
 * Yer tutucu `"DE00 0000 0000 0000 0000 00"` diye sabit yazılıydı ve bu
 * Almanya'ya özgü: Türk IBAN'ı 26 karakter, Alman IBAN'ı 22. Türkiye'deki
 * bir eve yanlış uzunlukta bir örnek göstermek, "IBAN'ım tutmuyor" dedirtir.
 *
 * Uzunluk zaten `IBAN_LENGTHS` tablosunda duruyor; örnek ondan üretiliyor,
 * yani yeni bir ülke eklendiğinde yer tutucu kendiliğinden doğru oluyor.
 */
export function ibanOrnek(ulke?: string | null): string {
  const kod = (ulke || "DE").toUpperCase();
  const uzunluk = IBAN_LENGTHS[kod];
  if (!uzunluk) return "IBAN";
  const sifir = "0".repeat(uzunluk - 2);
  return (kod + sifir).replace(/(.{4})/g, "$1 ").trim();
}

export const looksLikeIban = (v?: string) => !!normalizeIban(v) && ibanError(v) === null;

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

/**
 * Bilgimi bir kez paylaştım mı?
 *
 * **Bu bir kanıt değil, bir vurgu kararıdır.** Karşı tarafın kaydedip
 * kaydetmediğini öğrenmemizin yolu yok — bilgi cihazda duruyor, Salih'in
 * telefonunda ne olduğu bize hiç ulaşmıyor. Bu işaret yalnızca Kasa'daki
 * "bilgimi gönder" düğmesinin büyük mü küçük mü duracağına karar veriyor.
 * Düğme hiçbir zaman kaybolmuyor: IBAN değişir, eve yeni biri katılır.
 */
export async function hasSharedPayment(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(PAYLASILDI)) === "1"; }
  catch { return false; }
}

export async function markPaymentShared(): Promise<void> {
  try { await AsyncStorage.setItem(PAYLASILDI, "1"); } catch { /* onemsiz */ }
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

/** Bağlantının gövdesi. Yol kısadır çünkü tıklanabilir metinde görünüyor. */
const PAYLAS_URL = `${process.env.EXPO_PUBLIC_BACKEND_URL || "https://odahesap-api.onrender.com"}/o`;

/**
 * Paylaşılacak metin. Bağlantı uygulamayı açıp bilgiyi kaydediyor; altındaki
 * düz metin ise uygulamayı silmiş ya da henüz kurmamış birine de yarıyor.
 *
 * ### Neden `https` ve neden `#`
 *
 * Önce `odahesap://odeme?...` yazılıyordu ve **WhatsApp'ta tıklanabilir
 * olmuyordu**: mesajlaşma uygulamaları yalnızca bildikleri şemaları bağlantıya
 * çevirir, `odahesap://` düz metin kalır. Uygulamanın hatası değil, yöntemin
 * sınırı.
 *
 * `https` bunu çözüyor ama tuzağı var: veri sorgu dizesine (`?...`) konursa
 * **IBAN bizim sunucumuza gider ve günlüklere yazılır** — "IBAN cihazda kalır"
 * kararı tam orada çökerdi. Bu yüzden veri **çapaya** (`#`) konuyor: çapadan
 * sonrası HTTP isteğine hiç eklenmez, sunucu yalnızca `/o` yolunu görür.
 * Bilgi yine cihazdan cihaza gidiyor.
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
  satirlar.push("", `KaSa'da kaydetmek için: ${PAYLAS_URL}#${p.toString()}`);
  return satirlar.join("\n");
}

/**
 * Gelen bağlantıdan ödeme bilgisini çıkarır — hem yeni `https://…/o#…` hem de
 * eski `odahesap://odeme?…` biçimini anlar.
 *
 * Eski biçim **kalıcı olarak destekleniyor**: daha önce paylaşılmış mesajlar
 * WhatsApp geçmişinde duruyor ve bir gün tıklanabilir.
 */
export function parseShareUrl(url?: string | null):
  { userId: string; name?: string; info: PaymentInfo } | null {
  if (!url) return null;
  const capa = url.indexOf("#");
  const soru = url.indexOf("?");
  let ham: string;
  if (capa >= 0 && (url.slice(0, capa).endsWith("/o") || url.slice(0, capa).includes("/o#"))) {
    ham = url.slice(capa + 1);
  } else if (capa >= 0) {
    ham = url.slice(capa + 1);
  } else if (soru >= 0 && url.toLowerCase().includes("odeme")) {
    ham = url.slice(soru + 1);
  } else {
    return null;
  }
  const q = new URLSearchParams(ham);
  const userId = q.get("u");
  if (!userId) return null;
  return {
    userId,
    name: q.get("n") || undefined,
    info: {
      iban: q.get("iban") || undefined,
      paypal: q.get("pp") || undefined,
      holder: q.get("h") || undefined,
    },
  };
}

/** PayPal.me bağlantısı — tutar dolu gelir, uçtan uca gerçekten çalışan tek yol. */
export function paypalLink(handle: string, amount: number, currency = "EUR"): string {
  return `https://paypal.me/${handle}/${amount.toFixed(2)}${currency}`;
}
