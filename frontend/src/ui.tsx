/**
 * Ortak arayüz bileşenleri.
 *
 * Tasarım kuralları burada tek yerde toplanır:
 *  - Liste satırları ayrı ayrı kartlara konmaz. Tek kap (`Card`) içinde
 *    `Row`'lar ve aralarında saç teli `Divider` durur. Önceki sürümde her
 *    satır kendi kenarlığı ve gölgesiyle ayrı bir karttı; sekiz harcama
 *    sekiz kenarlık demekti.
 *  - Kart başlığı kartın İÇİNDEDİR (`Card title=`), üstünde gri etiket değil.
 *  - Ekran başına tek yükseltilmiş yüzey: koyu `ScreenHeader`. Kartlar düz.
 *  - Tutarlar sağa yaslı ve eşit genişlikte rakamla (`Money`).
 */
import React from "react";
import {
  View, Text, Pressable, StyleSheet, ViewStyle, StyleProp, Image, TextStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

import {
  colors, spacing, radius, type as T, overline, merchantColor,
  CATEGORY_ICONS, CATEGORY_LABEL_TR, getAvatar,
} from "./theme";

/* ------------------------------------------------------------------ metin */

export function Overline({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[overline, style]}>{children}</Text>;
}

/** Para. Rakamlar eşit genişlikte, böylece alt alta tutarlar hizalanır. */
export function Money({
  value, style, sign = false, color,
}: { value?: number | null; style?: StyleProp<TextStyle>; sign?: boolean; color?: string }) {
  return (
    <Text style={[styles.money, color ? { color } : null, style]}>
      {formatEUR(value, sign)}
    </Text>
  );
}

/* ------------------------------------------------------- koyu ekran başlığı */

/**
 * Tam genişlikte koyu alan; içerik yüzeyi bunun üzerine kavisle biner.
 * Hero bir kart değil, ekranın kendisidir — "her şey dikdörtgen" hissini
 * kıran asıl hamle bu.
 */
export function ScreenHeader({
  overline: over, title, right, children, testID,
}: {
  overline?: string; title?: string; right?: React.ReactNode;
  children?: React.ReactNode; testID?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      colors={[colors.dark, colors.darkAlt]}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[styles.header, { paddingTop: insets.top + spacing.md }]}
      testID={testID}
    >
      {(over || title || right) && (
        <View style={styles.headerTop}>
          <View style={{ flex: 1 }}>
            {over ? <Text style={styles.headerOverline}>{over}</Text> : null}
            {title ? <Text style={styles.headerTitle}>{title}</Text> : null}
          </View>
          {right}
        </View>
      )}
      {children}
    </LinearGradient>
  );
}

/** Koyu başlığın içindeki iki sütunlu istatistik bloğu. */
export function HeaderSplit({ items }: { items: { label: string; value: string; accent?: boolean }[] }) {
  return (
    <View style={styles.split}>
      {items.map((it, i) => (
        <React.Fragment key={it.label}>
          {i > 0 && <View style={styles.splitLine} />}
          <View style={{ flex: 1 }}>
            <Text style={styles.splitLabel}>{it.label}</Text>
            <Text style={[styles.splitValue, it.accent && { color: colors.accentOnDark }]}>
              {it.value}
            </Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

/** Koyu başlıkta yüzde değişimi rozeti. */
export function TrendBadge({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <View style={styles.trend}>
      <Ionicons name={up ? "trending-up" : "trending-down"} size={13} color={colors.accentOnDark} />
      <Text style={styles.trendTxt}>%{Math.abs(pct)} {up ? "artış" : "azalış"}</Text>
    </View>
  );
}

/** İçerik yüzeyi — koyu başlığın üzerine kavisle biner. */
export function Sheet({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.sheet, style]}>{children}</View>;
}

/* ---------------------------------------------------------------- kartlar */

export function Card({
  children, title, action, onAction, style, testID, padded = false,
}: {
  children?: React.ReactNode; title?: string; action?: string; onAction?: () => void;
  style?: StyleProp<ViewStyle>; testID?: string; padded?: boolean;
}) {
  return (
    <View style={[styles.card, style]} testID={testID}>
      {title ? (
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>{title}</Text>
          {action ? (
            <Pressable onPress={onAction} hitSlop={10}>
              <Text style={styles.cardAction}>{action}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={padded ? styles.cardBody : undefined}>{children}</View>
    </View>
  );
}

/** Kap içindeki tek satır. Sol yuva 40, ortada metin, sağda değer. */
export function Row({
  leading, title, subtitle, right, onPress, testID, minHeight = 60,
}: {
  leading?: React.ReactNode; title?: React.ReactNode; subtitle?: React.ReactNode;
  right?: React.ReactNode; onPress?: () => void; testID?: string; minHeight?: number;
}) {
  const body = (
    <View style={[styles.row, { minHeight }]}>
      {leading ? <View style={styles.rowLeading}>{leading}</View> : null}
      <View style={{ flex: 1 }}>
        {typeof title === "string" ? <Text style={styles.rowTitle}>{title}</Text> : title}
        {typeof subtitle === "string"
          ? <Text style={styles.rowSub}>{subtitle}</Text>
          : subtitle}
      </View>
      {right}
    </View>
  );
  return onPress
    ? <Pressable onPress={onPress} testID={testID} android_ripple={{ color: colors.divider }}>{body}</Pressable>
    : <View testID={testID}>{body}</View>;
}

/** Satır arası saç teli. Metin başlangıcına hizalanır. */
export function Divider({ inset = 58 }: { inset?: number }) {
  return <View style={[styles.divider, { marginLeft: inset }]} />;
}

/* ------------------------------------------------------------ ikon / avatar */

/** Dairesel renkli ikon kabı — referans finans uygulamalarındaki gibi. */
export function IconPill({
  name, color, tint, size = 40, mci = false,
}: { name: string; color: string; tint: string; size?: number; mci?: boolean }) {
  const Icon: any = mci ? MaterialCommunityIcons : Ionicons;
  return (
    <View style={[styles.iconPill, { width: size, height: size, borderRadius: size / 2, backgroundColor: tint }]}>
      <Icon name={name} size={Math.round(size * 0.46)} color={color} />
    </View>
  );
}

export function CategoryIcon({ category, size = 40 }: { category: string; size?: number }) {
  const c = CATEGORY_ICONS[category] || CATEGORY_ICONS.diger;
  return <IconPill name={c.icon} color={c.color} tint={c.bg} size={size} mci />;
}

export function categoryLabel(key: string) {
  return CATEGORY_LABEL_TR[key] || CATEGORY_LABEL_TR.diger;
}

export function Avatar({
  name, size = 36, avatarId, userId, photoVersion,
}: {
  name?: string; size?: number; avatarId?: number | null;
  userId?: string | null; photoVersion?: string | null;
}) {
  const preset = getAvatar(avatarId);
  const [token, setToken] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const wants = !!(userId && photoVersion);

  React.useEffect(() => {
    let alive = true;
    if (!wants) return;
    setFailed(false);
    require("./api").getToken().then((t: string | null) => { if (alive) setToken(t); });
    return () => { alive = false; };
  }, [wants, photoVersion]);

  const box = { width: size, height: size, borderRadius: size / 2 };

  if (wants && token && !failed) {
    return (
      <Image
        source={{
          uri: `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/users/${userId}/photo?v=${photoVersion}`,
          headers: { Authorization: `Bearer ${token}` },
        }}
        style={[styles.avatar, box, { backgroundColor: preset.color }]}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <View style={[styles.avatar, box, { backgroundColor: preset.color }]}>
      <Ionicons name={preset.icon as any} size={Math.floor(size * 0.5)} color="#fff" />
    </View>
  );
}

/* --------------------------------------------------------------- rozetler */

export function Tag({
  label, tint, color, style,
}: { label: string; tint: string; color: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.tag, { backgroundColor: tint }, style]}>
      <Text style={[styles.tagTxt, { color }]}>{label}</Text>
    </View>
  );
}

export function MerchantBadge({ name }: { name?: string | null }) {
  if (!name) return null;
  return (
    <View style={[styles.merchant, { backgroundColor: merchantColor(name) }]}>
      <Text style={styles.merchantTxt} numberOfLines={1}>{name.toUpperCase()}</Text>
    </View>
  );
}

export function Chip({
  label, active, onPress, testID, icon,
}: { label: string; active?: boolean; onPress?: () => void; testID?: string; icon?: any }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]} testID={testID}>
      {icon && (
        <Ionicons name={icon} size={14} color={active ? colors.onBrand : colors.inkSecondary}
                  style={{ marginRight: 5 }} />
      )}
      <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{label}</Text>
    </Pressable>
  );
}

export function PrimaryButton({
  label, onPress, disabled, testID, style, icon,
}: {
  label: string; onPress?: () => void; disabled?: boolean; testID?: string;
  style?: StyleProp<ViewStyle>; icon?: any;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled}
               style={[styles.primary, disabled && { opacity: 0.5 }, style]} testID={testID}>
      {icon && <Ionicons name={icon} size={18} color={colors.onBrand} style={{ marginRight: 8 }} />}
      <Text style={styles.primaryTxt}>{label}</Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------- biçimleyici */

export function formatEUR(n: number | null | undefined, sign = false) {
  if (n === null || n === undefined || isNaN(n as number)) return "0,00 €";
  const v = Number(n);
  const abs = Math.abs(v);
  const [int, dec] = abs.toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const prefix = sign ? (v >= 0 ? "+ " : "− ") : (v < 0 ? "−" : "");
  return `${prefix}${grouped},${dec} €`;
}

export function formatDateTR(iso?: string | null) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return !y || !m || !d ? iso : `${d}.${m}.${y}`;
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ stiller */

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl + spacing.md, // yüzey buraya biner
  },
  headerTop: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.lg },
  headerOverline: { ...overline, color: colors.onDarkMuted },
  headerTitle: { ...T.screen, color: colors.onDark },
  split: { flexDirection: "row", alignItems: "center", marginTop: spacing.lg },
  splitLine: { width: 1, height: 34, backgroundColor: "rgba(255,255,255,0.14)", marginRight: spacing.lg },
  splitLabel: { ...T.caption, color: colors.onDarkMuted },
  splitValue: { ...T.emph, color: colors.onDark, marginTop: 1 },
  trend: {
    flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start",
    backgroundColor: "rgba(16,185,129,0.18)", paddingHorizontal: spacing.md,
    paddingVertical: 5, borderRadius: radius.pill, marginTop: spacing.md,
  },
  trendTxt: { ...T.captionSb, color: colors.accentOnDark },
  sheet: {
    flex: 1, backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    marginTop: -spacing.xl, paddingTop: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, overflow: "hidden",
  },
  cardBody: { padding: spacing.lg, paddingTop: 0 },
  cardHead: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm,
  },
  cardTitle: { ...T.title, color: colors.ink },
  cardAction: { ...T.captionSb, color: colors.accent },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  rowLeading: { width: 40, alignItems: "center" },
  rowTitle: { ...T.bodySb, color: colors.ink },
  rowSub: { ...T.caption, color: colors.inkTertiary, marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider },
  money: { ...T.emph, color: colors.ink, fontVariant: ["tabular-nums"] },
  iconPill: { alignItems: "center", justifyContent: "center" },
  avatar: { alignItems: "center", justifyContent: "center" },
  tag: { paddingHorizontal: spacing.sm + 2, paddingVertical: 3, borderRadius: radius.pill, alignSelf: "flex-start" },
  tagTxt: { fontSize: 11, lineHeight: 14, fontFamily: "IBMPlexSans-SemiBold" },
  merchant: { alignSelf: "flex-start", paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm },
  merchantTxt: { color: "#fff", fontSize: 10, lineHeight: 13, fontFamily: "IBMPlexSans-Bold", letterSpacing: 0.4 },
  chip: {
    flexDirection: "row", alignItems: "center", height: 38, paddingHorizontal: spacing.lg,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, flexShrink: 0,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipTxt: { ...T.bodySb, color: colors.inkSecondary },
  chipTxtActive: { color: colors.onBrand },
  primary: {
    backgroundColor: colors.brand, borderRadius: radius.pill, minHeight: 54,
    alignItems: "center", justifyContent: "center", flexDirection: "row",
    paddingHorizontal: spacing.xl,
  },
  primaryTxt: { ...T.emph, color: colors.onBrand },
});
