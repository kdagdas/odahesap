/** Fiş İnceleme — edit OCR result (name, qty, price, category), per-item or bulk 3-way assignment, tarih + market. */
import { useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiPost } from "@/src/api";
import { popNext, remaining, totalCount, currentIndex, clearQueue } from "@/src/pendingReviews";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import {
  Chip, CategoryIcon, MerchantBadge, ScreenHeader, formatEUR, formatDateTR, todayISO,
} from "@/src/ui";
import {
  colors, spacing, radius, type as T, overline, CATEGORY_ICONS, CATEGORY_LABEL_TR,
} from "@/src/theme";

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
    <View style={styles.root} testID="review-screen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScreenHeader
          right={batchN > 1 ? (
            <View style={styles.batchPill} testID="batch-progress-pill">
              <Ionicons name="albums" size={12} color={colors.onDark} />
              <Text style={styles.batchTxt}>{batchI || 1} / {batchN}</Text>
            </View>
          ) : undefined}
        >
          <View style={styles.headRow}>
            <Pressable onPress={() => router.back()} testID="review-back-btn" hitSlop={14}
                       style={styles.backBtn}>
              <Ionicons name="chevron-back" size={20} color={colors.onDark} />
            </Pressable>
            <Text style={styles.headTitle}>Fişi incele</Text>
          </View>
          <Text style={styles.headMeta}>
            {merchant || "Market yok"} · {formatDateTR(fromDDMMYYYY(dateInput) || todayISO())}
          </Text>
          <Text style={styles.headTotal}>{formatEUR(total)}</Text>
          <Text style={styles.headHint}>{rows.length} kalem · fiyat, adet ve kategoriyi düzenleyebilirsin</Text>
        </ScreenHeader>

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
                    <CategoryIcon category={r.category} size={40} />
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  headRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.lg },
  backBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.darkSurface,
    alignItems: "center", justifyContent: "center",
  },
  headTitle: { ...T.emph, color: colors.onDark },
  headMeta: { ...T.caption, color: colors.onDarkMuted },
  headTotal: { ...T.hero, color: colors.onDark, marginTop: 2 },
  headHint: { ...T.caption, color: colors.onDarkMuted, marginTop: spacing.xs },
  batchPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: colors.darkSurface, paddingHorizontal: spacing.md,
    paddingVertical: 6, borderRadius: radius.pill,
  },
  batchTxt: { ...T.captionSb, color: colors.onDark },
  list: {
    backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    marginTop: -spacing.xl, padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl,
  },
  metaCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    gap: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  metaField: { gap: spacing.xs },
  metaLabelRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaLabel: { ...overline },
  metaInputRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  metaInput: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 46,
    ...T.body, color: colors.ink,
  },
  bulkWrap: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    gap: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  bulkLabel: { ...overline },
  targetRow: { gap: spacing.sm, alignItems: "center", paddingRight: spacing.lg },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { ...T.emph, color: colors.ink },
  emptyDesc: { ...T.body, color: colors.inkSecondary },
  itemCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    gap: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  itemHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  nameInput: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 44,
    ...T.bodySb, color: colors.ink,
  },
  itemBody: { flexDirection: "row", gap: spacing.sm },
  qtyBox: { width: 72 },
  priceBox: { flex: 1 },
  totalBox: { width: 92, alignItems: "flex-end" },
  subLabel: { ...overline, marginBottom: 4 },
  qtyInput: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, minHeight: 44,
    ...T.bodySb, color: colors.ink, textAlign: "center",
  },
  priceInput: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 44,
    ...T.bodySb, color: colors.ink, textAlign: "right",
  },
  rowTotal: { ...T.emph, color: colors.ink, marginTop: spacing.sm, fontVariant: ["tabular-nums"] },
  catLabel: { ...T.caption, color: colors.inkTertiary, marginLeft: 52 },
  addBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    padding: spacing.md, borderRadius: radius.lg, borderWidth: 1,
    borderStyle: "dashed", borderColor: colors.borderStrong, minHeight: 52,
  },
  addTxt: { ...T.bodySb, color: colors.accentDark },
  footer: {
    padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border,
    gap: spacing.sm, backgroundColor: colors.surface,
  },
  footerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  footerLabel: { ...T.caption, color: colors.inkSecondary },
  footerTotal: { ...T.screen, color: colors.ink, fontVariant: ["tabular-nums"] },
  saveBtn: {
    backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.xl,
    minHeight: 54, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6,
  },
  saveTxt: { ...T.emph, color: colors.onBrand },
  error: { ...T.bodySb, color: colors.negative, textAlign: "center" },
  skipBtn: {
    flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: spacing.lg,
    minHeight: 54, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary,
    justifyContent: "center",
  },
  skipTxt: { ...T.bodySb, color: colors.inkSecondary },
});
