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
  caption:   { fontSize: 12, lineHeight: 16, fontFamily: fontFamily.regular },
  captionSb: { fontSize: 12, lineHeight: 16, fontFamily: fontFamily.medium },
  body:      { fontSize: 15, lineHeight: 21, fontFamily: fontFamily.regular },
  bodySb:    { fontSize: 15, lineHeight: 21, fontFamily: fontFamily.medium },
  emph:      { fontSize: 17, lineHeight: 23, fontFamily: fontFamily.semibold, letterSpacing: -0.2 },
  title:     { fontSize: 18, lineHeight: 24, fontFamily: fontFamily.semibold, letterSpacing: -0.3 },
  screen:    { fontSize: 23, lineHeight: 29, fontFamily: fontFamily.semibold, letterSpacing: -0.5 },
  hero:      { fontSize: 38, lineHeight: 45, fontFamily: fontFamily.semibold, letterSpacing: -1.4 },
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
  sut_urunleri: { icon: "cup-outline",         color: "#0EA5A5", bg: "#D7F4F3" },
  meyve_sebze:  { icon: "food-apple-outline",  color: "#10B981", bg: "#DBF7ED" },
  et_balik:     { icon: "food-steak",          color: "#E14141", bg: "#FEE8E8" },
  firin:        { icon: "bread-slice-outline", color: "#D97706", bg: "#FEF0D6" },
  icecek:       { icon: "bottle-soda-outline", color: "#3B82F6", bg: "#E2EEFF" },
  atistirmalik: { icon: "candy-outline",       color: "#DB2777", bg: "#FCE7F3" },
  temel_gida:   { icon: "sack",                color: "#A16207", bg: "#FBF0DA" },
  ev_urunleri:  { icon: "spray-bottle",        color: "#7C3AED", bg: "#EDE9FE" },
  diger:        { icon: "basket-outline",      color: "#5F6F85", bg: "#EEF2F7" },
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

/** Bilinen zincirlerin marka renkleri — market rozetinde kullanılır. */
export const MERCHANT_COLORS: Record<string, string> = {
  REWE: "#CC071E", EDEKA: "#F0B400", ALDI: "#0B4B99", LIDL: "#0050AA",
  PENNY: "#CC071E", KAUFLAND: "#E10915", NETTO: "#FFD700", DM: "#004890",
  ROSSMANN: "#C8102E", BAUHAUS: "#F58220", OBI: "#F47C20", HORNBACH: "#F5A800",
  IKEA: "#0058A3",
};

export function merchantColor(name?: string | null): string {
  if (!name) return colors.dark;
  return MERCHANT_COLORS[name.trim().toUpperCase()] || colors.dark;
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
