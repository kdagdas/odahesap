/** Fiş İnceleme — edit OCR result (name, qty, price, category), per-item or bulk 3-way assignment, tarih + market. */
import { useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiPost } from "@/src/api";
import { popNext, remaining, totalCount, currentIndex, clearQueue } from "@/src/pendingReviews";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import { Chip, CategoryIcon, MerchantBadge, formatEUR, formatDateTR, todayISO } from "@/src/ui";
import { colors, spacing, radius, font, CATEGORY_ICONS, CATEGORY_LABEL_TR } from "@/src/theme";

type Target = { type: "self" | "household" | "roommate"; user_id?: string };
type Row = { name: string; price: string; quantity: string; category: string; target: Target };

const CAT_KEYS = Object.keys(CATEGORY_ICONS);
const nextCategory = (c: string) => CAT_KEYS[(CAT_KEYS.indexOf(c) + 1) % CAT_KEYS.length];

// Convert YYYY-MM-DD ↔ DD.MM.YYYY for input UX
const toDDMMYYYY = (iso: string) => {
  const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`;
};
const fromDDMMYYYY = (s: string): string | null => {
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
};

export default function Review() {
  const { payload, batchTotal, batchIndex } = useLocalSearchParams<{ payload?: string; batchTotal?: string; batchIndex?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { members } = useHousehold();

  // Batch progress (multi-receipt gallery pick)
  const batchN = Number(batchTotal || totalCount() || 0);
  const batchI = Number(batchIndex || currentIndex() || 0);
  const hasMore = remaining() > 0;

  const initial = useMemo(() => {
    try { return payload ? JSON.parse(payload as string) : null; } catch { return null; }
  }, [payload]);

  const [merchant, setMerchant] = useState<string>(initial?.merchant || "");
  const [dateInput, setDateInput] = useState<string>(
    toDDMMYYYY(initial?.date || todayISO())
  );
  const [rows, setRows] = useState<Row[]>(
    (initial?.items || []).map((it: any) => ({
      name: it.name || "",
      price: String(it.price ?? 0).replace(".", ","),
      quantity: String(it.quantity ?? 1),
      category: it.category || "diger",
      target: { type: "household" as const },
    }))
  );
  const [bulkTarget, setBulkTarget] = useState<Target>({ type: "household" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedPrice = (p: string) => parseFloat(p.replace(",", ".")) || 0;
  const parsedQty = (q: string) => parseFloat(q.replace(",", ".")) || 1;
  const rowTotal = (r: Row) => parsedPrice(r.price) * parsedQty(r.quantity);
  const total = rows.reduce((s, r) => s + rowTotal(r), 0);

  const updateRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));
  const addRow = () =>
    setRows((rs) => [...rs, { name: "", price: "0,00", quantity: "1", category: "diger", target: bulkTarget }]);

  const applyBulk = (t: Target) => {
    setBulkTarget(t);
    setRows((rs) => rs.map((r) => ({ ...r, target: t })));
  };

  const otherMembers = members.filter((m) => m.user_id !== user?.user_id);

  // Consume the queue: after saving/skipping current receipt, jump to next.
  const goToNextOrExit = () => {
    const next = popNext();
    if (next) {
      const nextIndex = (batchI || 1) + 1;
      router.replace({
        pathname: "/review",
        params: { payload: next, batchTotal: String(batchN), batchIndex: String(nextIndex) },
      });
    } else {
      clearQueue();
      router.replace("/(tabs)/panel");
    }
  };
  const skipReceipt = () => goToNextOrExit();

  const save = async () => {
    setError(null);
    const valid = rows.filter((r) => r.name.trim() && parsedPrice(r.price) > 0);
    if (valid.length === 0) { setError("Kaydedilecek geçerli kalem yok"); return; }
    const iso = fromDDMMYYYY(dateInput);
    if (!iso) { setError("Tarih formatı: GG.AA.YYYY"); return; }

    setSaving(true);
    try {
      const groups: Record<string, Row[]> = {};
      for (const r of valid) {
        const key = `${r.target.type}:${r.target.user_id || ""}`;
        (groups[key] ||= []).push(r);
      }
      for (const [key, group] of Object.entries(groups)) {
        const [type, uid] = key.split(":");
        const groupTotal = group.reduce((s, r) => s + rowTotal(r), 0);
        await apiPost("/expenses", {
          target_type: type,
          target_user_id: uid || null,
          items: group.map((g) => ({
            name: g.name.trim(),
            price: parsedPrice(g.price),
            quantity: parsedQty(g.quantity),
            category: g.category,
          })),
          total: groupTotal,
          source: "receipt",
          merchant: merchant.trim() || null,
          expense_date: iso,
        });
      }
      goToNextOrExit();
    } catch (e: any) { setError(e.message || "Kaydetme başarısız"); }
    finally { setSaving(false); }
  };

  const renderTargetChips = (target: Target, onChange: (t: Target) => void, keyPrefix: string) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.targetRow}>
      <Chip label="Ev" icon="home" active={target.type === "household"} onPress={() => onChange({ type: "household" })} testID={`${keyPrefix}-target-household`} />
      <Chip label="Kendim" icon="person" active={target.type === "self"} onPress={() => onChange({ type: "self" })} testID={`${keyPrefix}-target-self`} />
      {otherMembers.map((m) => (
        <Chip
          key={m.user_id}
          label={`→ ${m.name.split(" ")[0]}`}
          active={target.type === "roommate" && target.user_id === m.user_id}
          onPress={() => onChange({ type: "roommate", user_id: m.user_id })}
          testID={`${keyPrefix}-target-roommate-${m.user_id}`}
        />
      ))}
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="review-screen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} testID="review-back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={styles.title}>Fişi incele</Text>
              {batchN > 1 && (
                <View style={styles.batchPill} testID="batch-progress-pill">
                  <Ionicons name="albums" size={12} color={colors.brand} />
                  <Text style={styles.batchTxt}>{batchI || 1} / {batchN}</Text>
                </View>
              )}
            </View>
            <Text style={styles.headerSub}>Fiyat, adet ve kategoriyi düzenleyebilirsin</Text>
          </View>
          <Text style={styles.headerTotal}>{formatEUR(total)}</Text>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          <View style={styles.metaCard}>
            <View style={styles.metaField}>
              <View style={styles.metaLabelRow}>
                <Ionicons name="storefront-outline" size={14} color={colors.brand} />
                <Text style={styles.metaLabel}>Market</Text>
              </View>
              <View style={styles.metaInputRow}>
                <TextInput
                  style={styles.metaInput}
                  value={merchant}
                  onChangeText={setMerchant}
                  placeholder="REWE, EDEKA, ALDI…"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  testID="review-merchant-input"
                />
                {merchant ? <MerchantBadge name={merchant} /> : null}
              </View>
            </View>
            <View style={styles.metaField}>
              <View style={styles.metaLabelRow}>
                <Ionicons name="calendar-outline" size={14} color={colors.brand} />
                <Text style={styles.metaLabel}>Tarih</Text>
              </View>
              <TextInput
                style={styles.metaInput}
                value={dateInput}
                onChangeText={setDateInput}
                placeholder="GG.AA.YYYY"
                keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
                placeholderTextColor={colors.onSurfaceTertiary}
                testID="review-date-input"
              />
            </View>
          </View>

          <View style={styles.bulkWrap}>
            <Text style={styles.bulkLabel}>Tümüne uygula</Text>
            {renderTargetChips(bulkTarget, applyBulk, "bulk")}
          </View>

          {rows.length === 0 && (
            <View style={styles.empty} testID="review-empty">
              <Ionicons name="search-outline" size={40} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyTitle}>Kalem bulunamadı</Text>
              <Text style={styles.emptyDesc}>Manuel olarak ekleyebilirsin.</Text>
            </View>
          )}

          {rows.map((r, i) => {
            const CAT = CATEGORY_ICONS[r.category] || CATEGORY_ICONS.diger;
            return (
              <View key={i} style={styles.itemCard} testID={`review-item-${i}`}>
                <View style={styles.itemHeader}>
                  <Pressable
                    onPress={() => updateRow(i, { category: nextCategory(r.category) })}
                    testID={`review-item-${i}-category`}
                  >
                    <CategoryIcon category={r.category} size={22} />
                  </Pressable>
                  <TextInput
                    style={styles.nameInput}
                    value={r.name}
                    onChangeText={(t) => updateRow(i, { name: t })}
                    placeholder="Ürün adı"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    testID={`review-item-${i}-name`}
                  />
                  <Pressable onPress={() => removeRow(i)} testID={`review-item-${i}-delete`} hitSlop={8}>
                    <Ionicons name="close-circle" size={22} color={colors.onSurfaceTertiary} />
                  </Pressable>
                </View>
                <View style={styles.itemBody}>
                  <View style={styles.qtyBox}>
                    <Text style={styles.subLabel}>Adet</Text>
                    <TextInput
                      style={styles.qtyInput}
                      value={r.quantity}
                      onChangeText={(t) => updateRow(i, { quantity: t.replace(/[^\d.,]/g, "") })}
                      keyboardType="decimal-pad"
                      testID={`review-item-${i}-quantity`}
                    />
                  </View>
                  <View style={styles.priceBox}>
                    <Text style={styles.subLabel}>Birim fiyat</Text>
                    <TextInput
                      style={styles.priceInput}
                      value={r.price}
                      onChangeText={(t) => updateRow(i, { price: t.replace(/[^\d.,]/g, "") })}
                      keyboardType="decimal-pad"
                      testID={`review-item-${i}-price`}
                    />
                  </View>
                  <View style={styles.totalBox}>
                    <Text style={styles.subLabel}>Toplam</Text>
                    <Text style={styles.rowTotal}>{formatEUR(rowTotal(r))}</Text>
                  </View>
                </View>
                <Text style={styles.catLabel}>{CATEGORY_LABEL_TR[r.category]}</Text>
                {renderTargetChips(r.target, (t) => updateRow(i, { target: t }), `item-${i}`)}
              </View>
            );
          })}
          <Pressable style={styles.addBtn} onPress={addRow} testID="review-add-item">
            <Ionicons name="add-circle-outline" size={20} color={colors.brand} />
            <Text style={styles.addTxt}>Kalem ekle</Text>
          </Pressable>
        </ScrollView>

        <View style={styles.footer}>
          {error && <Text style={styles.error} testID="review-error">{error}</Text>}
          <View style={styles.footerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.footerLabel}>Toplam · {formatDateTR(fromDDMMYYYY(dateInput) || todayISO())}</Text>
              <Text style={styles.footerTotal}>{formatEUR(total)}</Text>
            </View>
            {batchN > 1 && (
              <Pressable style={styles.skipBtn} onPress={skipReceipt} testID="review-skip-btn">
                <Ionicons name="play-forward" size={16} color={colors.onSurfaceSecondary} />
                <Text style={styles.skipTxt}>Atla</Text>
              </Pressable>
            )}
            <Pressable style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} testID="review-save-btn">
              {saving ? <ActivityIndicator color={colors.onBrand} /> : (
                <>
                  <Ionicons name={hasMore ? "arrow-forward" : "checkmark"} size={18} color={colors.onBrand} />
                  <Text style={styles.saveTxt}>{hasMore ? "Kaydet & Sonraki" : "Kaydet"}</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceAlt },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider, backgroundColor: colors.surface },
  title: { fontSize: font.sizes.xl, fontWeight: font.weights.bold, color: colors.onSurface },
  headerSub: { fontSize: font.sizes.sm, color: colors.onSurfaceTertiary },
  headerTotal: { fontSize: font.sizes.xl, fontWeight: font.weights.bold, color: colors.brand },
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  metaCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  metaField: { gap: spacing.xs },
  metaLabelRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaLabel: { fontSize: font.sizes.sm, fontWeight: font.weights.semibold, color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  metaInputRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  metaInput: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: font.sizes.base, color: colors.onSurface, minHeight: 44,
  },
  bulkWrap: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  bulkLabel: { fontSize: font.sizes.sm, fontWeight: font.weights.semibold, color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  targetRow: { gap: spacing.sm, alignItems: "center", paddingRight: spacing.lg },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { fontSize: font.sizes.lg, fontWeight: font.weights.semibold, color: colors.onSurface },
  emptyDesc: { fontSize: font.sizes.base, color: colors.onSurfaceSecondary },
  itemCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  itemHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  nameInput: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: font.sizes.base, color: colors.onSurface, minHeight: 40 },
  itemBody: { flexDirection: "row", gap: spacing.sm },
  qtyBox: { width: 72 },
  priceBox: { flex: 1 },
  totalBox: { width: 90, alignItems: "flex-end" },
  subLabel: { fontSize: 11, color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4, fontWeight: font.weights.semibold },
  qtyInput: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, fontSize: font.sizes.base, color: colors.onSurface, textAlign: "center", fontWeight: font.weights.semibold },
  priceInput: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: font.sizes.base, color: colors.onSurface, textAlign: "right", fontWeight: font.weights.semibold },
  rowTotal: { fontSize: font.sizes.lg, fontWeight: font.weights.bold, color: colors.brand, marginTop: spacing.sm },
  catLabel: { fontSize: font.sizes.sm, color: colors.onSurfaceTertiary, marginLeft: 46 },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: colors.borderStrong },
  addTxt: { color: colors.brand, fontWeight: font.weights.semibold, fontSize: font.sizes.base },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider, gap: spacing.sm, backgroundColor: colors.surface },
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  footerLabel: { fontSize: font.sizes.sm, color: colors.onSurfaceSecondary, fontWeight: font.weights.semibold },
  footerTotal: { fontSize: 26, fontWeight: font.weights.bold, color: colors.onSurface, letterSpacing: -0.5 },
  saveBtn: { backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.xl, minHeight: 52, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  saveTxt: { color: colors.onBrand, fontWeight: font.weights.semibold, fontSize: font.sizes.lg },
  error: { color: colors.error, fontWeight: font.weights.semibold, textAlign: "center" },
  batchPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brandSoft, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  batchTxt: { color: colors.onBrandSoft, fontSize: 11, fontWeight: font.weights.bold },
  skipBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  skipTxt: { color: colors.onSurfaceSecondary, fontWeight: font.weights.semibold, fontSize: font.sizes.sm },
});
