/**
 * OdaHesap design tokens — refresh:
 * Fresh, colorful light theme. Teal primary + mint accents + coral highlights.
 * Trustworthy financial tone; no purple/indigo/AI slop.
 */
export const colors = {
  // Surfaces
  surface: "#FFFFFF",
  surfaceAlt: "#F1FBF9", // pale mint
  surfaceSecondary: "#F3F7F9", // pale seafoam
  surfaceTertiary: "#E6F1EF",
  surfaceInverse: "#0F2A2E", // deep teal
  onSurface: "#0F2A2E",
  onSurfaceSecondary: "#4A5F62",
  onSurfaceTertiary: "#7A8D8F",
  onSurfaceInverse: "#F1FBF9",

  // Brand
  brand: "#0EA5A5", // teal-500 → primary
  brandDark: "#0B8180",
  brandSoft: "#CFF2EF",
  onBrand: "#FFFFFF",
  onBrandSoft: "#065E5E",

  // Accents
  mint: "#22C55E", // for positive/success
  coral: "#F97066", // for negative/warning
  amber: "#F59E0B",
  sky: "#3B82F6", // occasional link accent
  onMint: "#FFFFFF",
  onCoral: "#FFFFFF",

  // Semantic
  success: "#16A34A",
  warning: "#F59E0B",
  error: "#DC2626",
  info: "#0EA5A5",

  border: "#E1EEEB",
  borderStrong: "#B7D3CE",
  divider: "#E8F0EF",

  positive: "#16A34A",
  negative: "#DC2626",
};

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48,
};
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };
export const font = {
  sizes: { sm: 12, base: 14, lg: 16, xl: 20, xxl: 24, hero: 32 },
  weights: {
    regular: "400" as const, medium: "500" as const, semibold: "600" as const, bold: "700" as const,
  },
};
export const shadow = {
  card: { shadowColor: "#0F2A2E", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
};

/** MaterialCommunityIcons names for each category — uniform icon set (no emojis). */
export const CATEGORY_ICONS: Record<string, { icon: string; color: string; bg: string }> = {
  sut_urunleri: { icon: "cup-outline",        color: "#0EA5A5", bg: "#CFF2EF" },
  meyve_sebze:  { icon: "food-apple-outline", color: "#16A34A", bg: "#DCFCE7" },
  et_balik:     { icon: "food-steak",         color: "#DC2626", bg: "#FEE2E2" },
  firin:        { icon: "bread-slice-outline",color: "#B45309", bg: "#FEF3C7" },
  icecek:       { icon: "bottle-soda-outline",color: "#3B82F6", bg: "#DBEAFE" },
  atistirmalik: { icon: "candy-outline",      color: "#DB2777", bg: "#FCE7F3" },
  ev_urunleri:  { icon: "spray-bottle",       color: "#7C3AED", bg: "#EDE9FE" },
  diger:        { icon: "basket-outline",     color: "#4A5F62", bg: "#E8F0EF" },
};

export const CATEGORY_LABEL_TR: Record<string, string> = {
  sut_urunleri: "Süt ürünleri",
  meyve_sebze: "Meyve & sebze",
  et_balik: "Et & balık",
  firin: "Fırın",
  icecek: "İçecek",
  atistirmalik: "Atıştırmalık",
  ev_urunleri: "Ev ürünleri",
  diger: "Diğer",
};

/** Known German merchant chains → brand color, for pill display */
export const MERCHANT_COLORS: Record<string, string> = {
  REWE: "#CC071E",
  EDEKA: "#F0B400",
  ALDI: "#0B4B99",
  LIDL: "#0050AA",
  PENNY: "#CC071E",
  KAUFLAND: "#E10915",
  NETTO: "#FFD700",
  DM: "#004890",
  ROSSMANN: "#C8102E",
  BAUHAUS: "#F58220",
  OBI: "#F47C20",
  HORNBACH: "#F5A800",
  IKEA: "#0058A3",
};

export function merchantColor(name?: string | null): string {
  if (!name) return colors.brand;
  const key = name.trim().toUpperCase();
  return MERCHANT_COLORS[key] || colors.brand;
}

/** 8 preset avatar styles — user can pick one in Settings. */
export type AvatarPreset = { id: number; icon: string; color: string };
export const AVATARS: AvatarPreset[] = [
  { id: 0, icon: "person",      color: "#0EA5A5" },
  { id: 1, icon: "happy",       color: "#F59E0B" },
  { id: 2, icon: "pizza",       color: "#DC2626" },
  { id: 3, icon: "rocket",      color: "#3B82F6" },
  { id: 4, icon: "star",        color: "#8B5CF6" },
  { id: 5, icon: "heart",       color: "#EC4899" },
  { id: 6, icon: "leaf",        color: "#16A34A" },
  { id: 7, icon: "flame",       color: "#F97316" },
];
export const getAvatar = (id?: number | null): AvatarPreset => AVATARS[id ?? 0] || AVATARS[0];
