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
export const colors = {
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
  // ortası katılma uyarısıyla aynı sesle konuşurdu. Lacivert–beyaz palette
  // dikkat çekecek başka yuva yok, o yüzden ayrı ve daha canlı bir amber.
  // Yalnızca küçük işaretlerde kullanılır; yüzey doldurmaz.
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
export const CATEGORY_ICONS: Record<string, { icon: string; color: string; bg: string }> = {
  // Renkler halka grafiğinde yan yana duruyor ve orada aynı zamanda
  // AÇIKLAMA görevi görüyorlar: liste satırındaki nokta hangi dilim olduğunu
  // söylüyor. Bu yüzden birbirinden ayırt edilebilir ve canlı olmaları şart —
  // önceki ton seti kâğıtta hoştu ama 9 dilim yan yana gelince griye çalıyordu.
  // "diger" bilerek soluk: bir kategori değil, kalanların adı.
  sut_urunleri: { icon: "cup-outline",         color: "#06B6D4", bg: "#CFFAFE" },
  meyve_sebze:  { icon: "food-apple-outline",  color: "#22C55E", bg: "#DCFCE7" },
  et_balik:     { icon: "food-steak",          color: "#EF4444", bg: "#FEE2E2" },
  firin:        { icon: "bread-slice-outline", color: "#FBBF24", bg: "#FEF3C7" },
  icecek:       { icon: "bottle-soda-outline", color: "#3B82F6", bg: "#DBEAFE" },
  atistirmalik: { icon: "candy-outline",       color: "#EC4899", bg: "#FCE7F3" },
  temel_gida:   { icon: "sack",                color: "#F97316", bg: "#FFEDD5" },
  ev_urunleri:  { icon: "spray-bottle",        color: "#8B5CF6", bg: "#EDE9FE" },
  diger:        { icon: "basket-outline",      color: "#64748B", bg: "#EEF2F7" },
};

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

/** 8 hazır avatar — fotoğraf yüklenmediğinde kullanılır. */
export type AvatarPreset = { id: number; icon: string; color: string };
export const AVATARS: AvatarPreset[] = [
  { id: 0, icon: "person", color: "#0F1B33" },
  { id: 1, icon: "happy",  color: "#F59E0B" },
  { id: 2, icon: "pizza",  color: "#E14141" },
  { id: 3, icon: "rocket", color: "#3B82F6" },
  { id: 4, icon: "star",   color: "#8B5CF6" },
  { id: 5, icon: "heart",  color: "#EC4899" },
  { id: 6, icon: "leaf",   color: "#10B981" },
  { id: 7, icon: "flame",  color: "#F97316" },
];
export const getAvatar = (id?: number | null): AvatarPreset => AVATARS[id ?? 0] || AVATARS[0];
