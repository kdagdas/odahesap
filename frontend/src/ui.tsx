/** Shared UI helpers for OdaHesap. */
import React from "react";
import { View, Text, Pressable, StyleSheet, ViewStyle, StyleProp } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, radius, font, merchantColor } from "./theme";

export function Card({
  children, style, testID,
}: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  return <View style={[styles.card, style]} testID={testID}>{children}</View>;
}

export function Chip({
  label, active, onPress, testID, icon,
}: { label: string; active?: boolean; onPress?: () => void; testID?: string; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]} testID={testID}>
      {icon && <Ionicons name={icon} size={14} color={active ? colors.onBrand : colors.onSurfaceSecondary} style={{ marginRight: 4 }} />}
      <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{label}</Text>
    </Pressable>
  );
}

export function PrimaryButton({
  label, onPress, disabled, testID, style, icon,
}: {
  label: string; onPress?: () => void; disabled?: boolean; testID?: string;
  style?: StyleProp<ViewStyle>; icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.primary, disabled && { opacity: 0.5 }, style]} testID={testID}>
      {icon && <Ionicons name={icon} size={18} color={colors.onBrand} style={{ marginRight: 8 }} />}
      <Text style={styles.primaryTxt}>{label}</Text>
    </Pressable>
  );
}

export function Avatar({ name, size = 32, avatarId }: { name: string; size?: number; avatarId?: number | null }) {
  const preset = require("./theme").getAvatar(avatarId);
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: preset.color }]}>
      <Ionicons name={preset.icon as any} size={Math.floor(size * 0.55)} color="#fff" />
    </View>
  );
}

export function CategoryIcon({
  category, size = 24, bg,
}: { category: string; size?: number; bg?: string }) {
  const CAT = require("./theme").CATEGORY_ICONS[category] || require("./theme").CATEGORY_ICONS.diger;
  return (
    <View style={[styles.catIcon, { width: size + 16, height: size + 16, borderRadius: (size + 16) / 2, backgroundColor: bg || CAT.bg }]}>
      <MaterialCommunityIcons name={CAT.icon} size={size} color={CAT.color} />
    </View>
  );
}

export function MerchantBadge({ name }: { name?: string | null }) {
  if (!name) return null;
  const bg = merchantColor(name);
  return (
    <View style={[styles.merchantBadge, { backgroundColor: bg }]}>
      <Text style={styles.merchantTxt} numberOfLines={1}>{name.toUpperCase()}</Text>
    </View>
  );
}

export function formatEUR(n: number | null | undefined) {
  if (n === null || n === undefined || isNaN(n as number)) return "0,00 €";
  return `${Number(n).toFixed(2).replace(".", ",")} €`;
}

export function formatDateTR(iso?: string | null) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.lg, borderWidth: 1, borderColor: colors.border,
    shadowColor: "#0F2A2E", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 1,
  },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, flexShrink: 0, flexDirection: "row", alignItems: "center", height: 36,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipTxt: { color: colors.onSurfaceSecondary, fontWeight: font.weights.semibold, fontSize: font.sizes.base },
  chipTxtActive: { color: colors.onBrand },
  primary: {
    backgroundColor: colors.brand, borderRadius: radius.pill, minHeight: 52,
    alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, flexDirection: "row",
  },
  primaryTxt: { color: colors.onBrand, fontSize: font.sizes.lg, fontWeight: font.weights.semibold },
  avatar: { alignItems: "center", justifyContent: "center" },
  catIcon: { alignItems: "center", justifyContent: "center" },
  merchantBadge: {
    alignSelf: "flex-start", paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.sm,
  },
  merchantTxt: { color: "#fff", fontSize: 10, fontWeight: font.weights.bold, letterSpacing: 0.4 },
});
