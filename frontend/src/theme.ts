import { Appearance } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * KaSa tasarım jetonları.
 *
 * Yön: koyu lacivert + yeşil, premium finans dili. Lacivert uygulama
 * ikonundan geliyor; önceki turkuaz arayüz ikonla aynı markayı konuşmuyordu.
 *
 * Kural: ekranlarda ham renk kodu kullanılmaz. Bir renge ihtiyaç varsa
 * buraya isimlendirilmiş bir jeton olarak eklenir — ekranlara dağılmış 27
 * ham kod, yarısı zaten var olan jetonun kopyasıydı.
 */
/**
 * Karanlık tema — SİSTEM ayarını takip eder, uygulama içinden seçilmez.
 *
 * Karar PROJE-DOKUMANI §12'de: tema yalnızca **açılışta** okunuyor. Bunun
 * bedeli, kullanıcı sistem temasını değiştirince farkın bir sonraki açılışta
 * görünmesi; kazancı ise `StyleSheet.create` zaten modül yüklenirken
 * çalıştığı için **hiçbir stilin bileşen içine taşınması gerekmemesi**
 * (22 dosyada 1.234 satır stil, canlı tema için hepsinin taşınması gerekirdi).
 *
 * **Ters çevirme YOK.** Bugün lacivert zemin, beyaz yüzey onun üstünde;
 * kavisle binen o katman uygulamanın imzası ve "bu yüzey yukarıda" diyor.
 * Ters çevrilseydi beyaz başlık ekranın en açık ögesi olur ve ilişki bozulurdu.
 * Karanlıkta da yüzey başlıktan AÇIK kalıyor — ilişki korunuyor:
 *
 *   |            | Aydınlık | Karanlık |
 *   | Başlık     | #0F1B33  | #0A1120  (daha koyu lacivert) |
 *   | Yüzey      | beyaz    | #161B22  (koyu gri, yine daha açık) |
 *
 * Metin saf beyaz değil (`#E8EDF4`): koyu zeminde saf beyaz gözü yorar.
 * Yeşil ve amber iki temada da çalışıyor, değişmediler.
 */
const AYDINLIK = {
  // Zeminler
  bg: "#F6F8FB",              // ekran zemini (saf beyaz değil — kartlar yüzey gibi okunsun)
  surface: "#FFFFFF",
  surfaceAlt: "#F6F8FB",
  surfaceSecondary: "#F1F4F9", // girdi alanları
  border: "#E9EEF4",
  divider: "#F0F4F8",

  // Koyu bölge (hero başlıkları)
  dark: "#0F1B33",
  darkAlt: "#1A2B4E",         // degradenin diğer ucu
  darkSurface: "#26385C",     // koyu üstünde daire/rozet
  onDark: "#FFFFFF",
  onDarkMuted: "#9AAECC",
  negativeOnDark: "#FCA5A5",  // koyu zemin üstünde kırmızı
  black: "#000000",           // kamera önizlemesi

  // Metin
  ink: "#0C1626",
  inkSecondary: "#5F6F85",
  inkTertiary: "#98A5B6",

  // Marka / vurgu
  brand: "#0F1B33",           // birincil eylem = lacivert
  onBrand: "#FFFFFF",
  accent: "#10B981",          // yeşil: pozitif, bağlantı, onay
  accentDark: "#057A55",
  accentSoft: "#DBF7ED",
  accentOnDark: "#6EE7B7",    // koyu zemin üstünde yeşil

  // Anlamsal
  positive: "#10B981",
  negative: "#E14141",
  negativeSoft: "#FEE8E8",
  warning: "#F59E0B",
  warningSoft: "#FEF3D6",
  // "Senden bir şey bekliyor" — uyarı DEĞİL. Vadesi gelen bir kira bir hata
  // değil, normal ve beklenen bir olay; `warning` ile aynı olsaydı dönem
  // ortası katılma uyarısıyla aynı sesle konuşurdu.
  attention: "#FFA51F",
  onWarning: "#92400E",
  info: "#3B82F6",
  infoSoft: "#E2EEFF",
  onInfo: "#1D4ED8",
  error: "#E14141",

  // Geriye dönük adlar (ekranlar kademeli geçerken kırılmasın)
  onSurface: "#0C1626",
  onSurfaceSecondary: "#5F6F85",
  onSurfaceTertiary: "#98A5B6",
  onBrandSoft: "#057A55",
  brandSoft: "#DBF7ED",
  brandDark: "#1A2B4E",
  surfaceTertiary: "#F1F4F9",
  borderStrong: "#CBD5E1",
  mint: "#10B981",
  coral: "#E14141",
  amber: "#F59E0B",
  sky: "#3B82F6",
  success: "#10B981",
  onMint: "#FFFFFF",
  onCoral: "#FFFFFF",
};

const KARANLIK: typeof AYDINLIK = {
  ...AYDINLIK,
  bg: "#12161D",
  surface: "#161B22",
  surfaceAlt: "#12161D",
  surfaceSecondary: "#1D232C",
  border: "#262C36",
  divider: "#20262F",

  dark: "#0A1120",
  darkAlt: "#111C33",
  darkSurface: "#1B2740",
  onDark: "#E8EDF4",
  onDarkMuted: "#7C8FA8",

  ink: "#E8EDF4",
  inkSecondary: "#9BA6B4",
  inkTertiary: "#6B7887",

  // Karanlikta birincil dugme zeminden ACIK durur; #1B2740 yuzeyle (#161B22)
  // neredeyse ayni tondu ve dugme kayboluyordu.
  brand: "#2E4372",
  onBrand: "#E8EDF4",
  // Yesil koyu zeminde biraz aciliyor ki okunurlugu dussun istemiyoruz.
  accentDark: "#6EE7B7",
  accentSoft: "#12352A",

  negativeSoft: "#3B2222",
  warningSoft: "#3A2E17",
  onWarning: "#FCD9A0",
  infoSoft: "#17263F",
  onInfo: "#9CC4FF",

  onSurface: "#E8EDF4",
  onSurfaceSecondary: "#9BA6B4",
  onSurfaceTertiary: "#6B7887",
  onBrandSoft: "#6EE7B7",
  brandSoft: "#12352A",
  brandDark: "#111C33",
  surfaceTertiary: "#1D232C",
  borderStrong: "#3A4250",
};

export type TemaTercihi = "acik" | "koyu" | "sistem";
const TEMA_ANAHTARI = "kasa_tema";

/**
 * Tema ACILISTA bir kez okunuyor ve bu bir kısıt değil, yapının kendisi:
 * her ekran `StyleSheet.create` ile modül yüklenirken stilini üretiyor, yani
 * `colors` o an hazır olmak zorunda.
 *
 * Bu yüzden depolama da SENKRON olmalı. `SecureStore.getItem()` senkron —
 * `AsyncStorage` olsaydı tercih stiller üretildikten sonra gelirdi ve ilk
 * açılışta hep yanlış tema görünürdü.
 *
 * Canlı tema değiştirme (seçince anında dönmesi) bilerek YAPILMADI: 22
 * dosyadaki ~1.234 satır stilin bileşen içine taşınması gerekir. Kazanç bir
 * kereye mahsus bir bekleme; bedeli her ekranın yeniden yazılması.
 */
function temaOku(): TemaTercihi {
  try {
    const v = SecureStore.getItem(TEMA_ANAHTARI);
    return v === "acik" || v === "koyu" ? v : "sistem";
  } catch {
    // Depolama okunamıyorsa sisteme uymak en az şaşırtıcı davranış.
    return "sistem";
  }
}

/** AÇILIŞTAKİ tercih — ekrandaki renkleri bu üretti. Sabit; değişmiyor. */
export const temaTercihi: TemaTercihi = temaOku();
export const isDark =
  temaTercihi === "koyu" ? true
    : temaTercihi === "acik" ? false
      : Appearance.getColorScheme() === "dark";
export const colors = isDark ? KARANLIK : AYDINLIK;

/**
 * KAYITLI tercih — `temaTercihi`den farklı olabilir ve fark önemli.
 *
 * Ayarlar ekranı seçimi `temaTercihi`den okuyordu; o açılışta donmuş bir
 * sabit. Kullanıcı "Koyu" seçip ekrandan çıkıp geri geldiğinde seçim yine
 * eski tercihte duruyordu ve tek görünen şey renklerin değişmemiş olmasıydı:
 * ekran "kaydedilmedi" diyordu. Kayıt yapılmıştı — anlatan yoktu.
 *
 * Bellekte de tutuluyor çünkü `SecureStore.getItem` senkron ama bedava
 * değil; ayarlar ekranı her odaklandığında diske gitmesinin sebebi yok.
 */
let kayitliTema: TemaTercihi = temaTercihi;
export function seciliTema(): TemaTercihi {
  return kayitliTema;
}

/** Seçim, açılıştaki temadan farklı mı? Yani yeniden açılış bekliyor mu? */
export function temaBekliyor(): boolean {
  return kayitliTema !== temaTercihi;
}

/** Tercihi kaydeder. Renkler bir sonraki açılışta değişir. */
export function temaKaydet(t: TemaTercihi): void {
  kayitliTema = t;
  try { SecureStore.setItem(TEMA_ANAHTARI, t); } catch { /* sessizce geç */ }
}


export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48,
};

/** Köşe yarıçapı: büyük yüzey 18, gruplanmış liste 14, rozet hap. */
export const radius = { sm: 6, md: 12, lg: 18, xl: 28, pill: 999 };

/**
 * Inter. IBM Plex'ten geçildi: Plex mühendislik/teknik bir ses taşıyor, finans
 * arayüzlerinin sakin dilini vermiyordu. Inter nötr, tablo rakamları güçlü
 * (`tnum`) ve sütun sütun dizilen tutarlar onunla hizalı okunuyor.
 */
export const fontFamily = {
  regular: "Inter-Regular",
  medium: "Inter-Medium",
  semibold: "Inter-SemiBold",
  bold: "Inter-Bold",
};

/**
 * Yazı ölçeği. Her boyutun satır yüksekliği tanımlı — denetimde 189 yazı
 * stilinden yalnızca 17'sinde vardı, gerisi platform varsayılanıyla sıkışıktı.
 * Ağırlık doğrudan font ailesine çevrilir: React Native'de özel fontlarda
 * fontWeight güvenilir çalışmaz, aile adı kullanılmalıdır.
 *
 * Ağırlıklar bilerek bir kademe hafif: başlıklar Bold değil SemiBold, vurgulu
 * gövde metni SemiBold değil Medium. Büyük punto + 700 kalınlık ekranı
 * bağırtıyordu; büyük punto + 600 + sıkı harf aralığı premium okunuyor.
 */
export const type = {
  caption:   { fontSize: 12, lineHeight: 17, fontFamily: fontFamily.regular },
  captionSb: { fontSize: 12, lineHeight: 17, fontFamily: fontFamily.medium },
  body:      { fontSize: 14, lineHeight: 20, fontFamily: fontFamily.regular },
  bodySb:    { fontSize: 14, lineHeight: 20, fontFamily: fontFamily.medium },
  emph:      { fontSize: 16, lineHeight: 22, fontFamily: fontFamily.semibold, letterSpacing: -0.2 },
  title:     { fontSize: 16, lineHeight: 22, fontFamily: fontFamily.semibold, letterSpacing: -0.2 },
  screen:    { fontSize: 22, lineHeight: 28, fontFamily: fontFamily.semibold, letterSpacing: -0.5 },
  hero:      { fontSize: 34, lineHeight: 41, fontFamily: fontFamily.semibold, letterSpacing: -1.2 },
} as const;

/**
 * Liste ölçüleri. Yoğunluk buradan yönetiliyor: satır ve ikon küçülürken
 * gruplar arası boşluk büyüyor. "Sayfada daha çok veri ama veriler birbirine
 * yapışmasın" isteği tek bir küçültme değil, bu iki yönlü ayar.
 */
export const metrics = {
  rowHeight: 54,      // liste satırı
  rowHeightLg: 64,    // iki katlı satır
  leading: 36,        // satır başındaki ikon yuvası
  icon: 34,           // avatar ve kategori ikonu
  iconSm: 30,
  dividerInset: 64,   // spacing.lg + leading + spacing.md
  cardGap: 20,        // kartlar arası — satır içinden bilerek geniş
} as const;

/** Bölüm etiketi: küçük, harf aralıklı, sessiz — finans arayüzlerinin imzası. */
export const overline = {
  fontSize: 11, lineHeight: 14, fontFamily: fontFamily.medium,
  letterSpacing: 1.1, color: colors.inkTertiary,
} as const;

/** Yükseklik bütçesi: ekran başına bir yüzey. Gerisi düz. */
export const shadow = {
  card: {
    shadowColor: "#0F1B33", shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10, shadowRadius: 14, elevation: 4,
  },
};

export const font = {
  sizes: { sm: 12, base: 15, lg: 17, xl: 19, xxl: 24, hero: 38 },
  weights: { regular: "400" as const, medium: "500" as const, semibold: "600" as const, bold: "700" as const },
};

/** Kategori ikonları — Gemini'nin atadığı anahtarlarla birebir eşleşir. */
/** İki rengi oranla karıştırır (0 = a, 1 = b). */
export const mixHex = (a: string, b: string, t: number) => {
  const h = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
  const k = (i: number) => Math.round(h(a, i) * (1 - t) + h(b, i) * t);
  return `#${[0, 1, 2].map((i) => k(i).toString(16).padStart(2, "0")).join("")}`;
};

export const CATEGORY_ICONS: Record<string, { icon: string; color: string; bg: string }> = {
  // Renkler halka grafiğinde yan yana duruyor ve orada aynı zamanda
  // AÇIKLAMA görevi görüyorlar: liste satırındaki nokta hangi dilim olduğunu
  // söylüyor. Bu yüzden birbirinden ayırt edilebilir ve canlı olmaları şart —
  // önceki ton seti kâğıtta hoştu ama 9 dilim yan yana gelince griye çalıyordu.
  // "diger" bilerek soluk: bir kategori değil, kalanların adı.
  // Tonlar %22 beyaza kaydirildi. Once tam doygundu ve halka tek bir canli
  // kirmiziyla dolunca finans baglaminda "uyari" gibi okunuyordu -- oysa et
  // kategorisinin kirmizi olmasi DOGRU, sorun rengin secimi degil doygunlugu.
  // Ayirt edilebilirlik korundu: hue'lar ve aralari degismedi.
  sut_urunleri: { icon: "cup-outline",         color: "#3DC6DD", bg: "#CFFAFE" },
  meyve_sebze:  { icon: "food-apple-outline",  color: "#53D281", bg: "#DCFCE7" },
  et_balik:     { icon: "food-steak",          color: "#F36D6D", bg: "#FEE2E2" },
  firin:        { icon: "bread-slice-outline", color: "#FCCD54", bg: "#FEF3C7" },
  icecek:       { icon: "bottle-soda-outline", color: "#669EF8", bg: "#DBEAFE" },
  atistirmalik: { icon: "candy-outline",       color: "#F070AF", bg: "#FCE7F3" },
  temel_gida:   { icon: "sack",                color: "#FA9249", bg: "#FFEDD5" },
  ev_urunleri:  { icon: "spray-bottle",        color: "#A580F8", bg: "#EDE9FE" },
  diger:        { icon: "basket-outline",      color: "#8693A5", bg: "#EEF2F7" },
};

// Karanlik temada pastel zeminler goz cikariyor. Ikon RENGI aynen kaliyor
// ("mor = ev urunleri" taninirligi iki temada da ayni), yalnizca zemin o
// rengin koyu zemine karistirilmis haline donuyor.
if (isDark) {
  for (const k of Object.keys(CATEGORY_ICONS)) {
    CATEGORY_ICONS[k] = {
      ...CATEGORY_ICONS[k],
      bg: mixHex(CATEGORY_ICONS[k].color, colors.surface, 0.82),
    };
  }
}

export const CATEGORY_LABEL_TR: Record<string, string> = {
  sut_urunleri: "Süt ürünleri",
  meyve_sebze: "Meyve & sebze",
  et_balik: "Et & şarküteri",
  firin: "Fırın",
  icecek: "İçecek",
  atistirmalik: "Atıştırmalık",
  temel_gida: "Temel gıda",
  ev_urunleri: "Ev ürünleri",
  diger: "Diğer",
};

/**
 * Bilinen zincirlerin marka renkleri — market rozetinde kullanılır.
 * Anahtarlar sunucudaki KNOWN_MERCHANTS listesiyle aynı yazımda olmalı;
 * sunucu market adını o listeye indirgiyor, rozet de oradan renk buluyor.
 */
export const MERCHANT_COLORS: Record<string, string> = {
  // Almanya
  REWE: "#CC071E", EDEKA: "#F0B400", ALDI: "#14B8A6", LIDL: "#0050AA",
  PENNY: "#CC071E", KAUFLAND: "#E10915", NETTO: "#FFD700", NORMA: "#E2001A",
  DM: "#004890", ROSSMANN: "#C8102E", ACTION: "#004E9E", TEDI: "#E30613",
  BAUHAUS: "#F58220", OBI: "#F47C20", HORNBACH: "#F5A800", IKEA: "#0058A3",
  // Türkiye
  "BİM": "#E1251B", A101: "#00A9A5", "ŞOK": "#F9C22E", MIGROS: "#F36F21",
  CARREFOURSA: "#004E9E", MACROCENTER: "#1A1A1A", "TARIM KREDI": "#2E7D32",
  "TARIM KREDİ": "#2E7D32", FILE: "#8DC63F", HAKMAR: "#D6001C",
  "ONUR MARKET": "#005BAA", METRO: "#003D7D",
  // Evin sik gittigi yerel dukkanlar -- havuzdan rastgele renk almasinlar
  // diye burada. Rozet rengi tanidik olunca liste goz taramasiyla okunuyor.
  "BIZIM": "#F2B705", "BİZİM": "#F2B705", "BIZIM GMBH": "#F2B705",
  "BIZIM FLEISCHER": "#7B1E3A", "BİZİM FLEISCHER": "#7B1E3A",
};

/**
 * Tanınmayan marketler için renk havuzu.
 *
 * Hepsi lacivert olunca "Bizim Fleischer", "Tarım Kredi" ve "Metro" tek bir
 * gri kütle gibi okunuyordu. Renk isimden türetiliyor: aynı market her yerde
 * ve her açılışta aynı rengi alıyor — gerçekten rastgele olsaydı liste her
 * yenilemede değişir, hiçbir şey tanınmazdı.
 */
const FALLBACK_COLORS = [
  "#0F766E", "#7C3AED", "#B45309", "#BE123C", "#1D4ED8",
  "#15803D", "#A21CAF", "#C2410C", "#0E7490", "#4D7C0F",
];

/** Ticari unvan ekleri renk aramasını bozmasın: fişin üstünde
 *  "Bizim Fleischer GmbH" yazıyor ama tanıdığımız ad "Bizim Fleischer".
 *  Sunucudaki `normalize_merchant()` ile aynı fikir, burada küçük hâli. */
const LEGAL_SUFFIX = /\s+(GMBH|GMBH\s*&\s*CO\.?\s*KG|MBH|AG|KG|OHG|GBR|E\.?K\.?|SE|A\.?Ş\.?|AS|LTD\.?\s*ŞTİ\.?|LTD\.?|ŞTİ\.?|TİC\.?|SAN\.?|INC\.?|B\.?V\.?)+$/;

export function merchantColor(name?: string | null): string {
  if (!name) return colors.dark;
  const raw = name.trim().toUpperCase();
  const key = raw.replace(LEGAL_SUFFIX, "").trim() || raw;
  const known = MERCHANT_COLORS[key] ?? MERCHANT_COLORS[raw];
  if (known) return known;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

/**
 * Marka rengini PASTEL zemin + koyu yazıya çevirir.
 *
 * Rozetler önce tam doygun dolguydu ve tek kartta yedi renk yarışıyordu.
 * Üstelik renk kimlik işini zaten yapamıyor: Lidl ile Aldi ikisi de mavi,
 * REWE/Penny/Kaufland üçü de kırmızı — ayırt eden şey **isim**. Renk bir
 * *tanıma* yardımcısı, bir *ayırt edici* değil; o yüzden ağırlığı düştü.
 */

export function merchantTint(name?: string | null): { bg: string; fg: string } {
  const base = merchantColor(name);
  // Zemin, iceride bulundugu YUZEYE dogru karistiriliyor: karanlik temada
  // beyaza karistirmak parlak bir leke birakirdi.
  return isDark
    ? { bg: mixHex(base, colors.surface, 0.78), fg: mixHex(base, "#FFFFFF", 0.35) }
    : { bg: mixHex(base, "#FFFFFF", 0.86), fg: mixHex(base, "#000000", 0.38) };
}

/* Avatarlar `src/avatarlar.tsx`e taşındı: artık Ionicon adı değil, çizim.
   Tema dosyası renk ve ölçü tanımlıyor; hayvan çizmek onun işi değil. */
