/** Harcama düzenleme — kalem kalem. Yanlış yazılan domates düzeltilir,
 *  unutulan kalem eklenir, fazladan girilen silinir; toplam kalemlerden
 *  hesaplanır, elle girilmez. */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, apiGet } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import { Chip, MerchantBadge, CategoryIcon, formatEUR } from "@/src/ui";
import { colors, spacing, radius, font, CATEGORY_ICONS, CATEGORY_LABEL_TR } from "@/src/theme";

type Target = { type: "self" | "household" | "roommate"; user_id?: string };
type Row = { name: string; price: string; quantity: string; category: string };
type Item = { name: string; price: number; quantity?: number; category: string };
type Expense = {
  expense_id: string; added_by: string; target_type: string; target_user_id?: string;
  total: number; merchant?: string; category?: string; notes?: string;
  source: string; expense_date?: string; items?: Item[];
};

const CAT_KEYS = Object.keys(CATEGORY_ICONS);
const nextCategory = (c: string) => CAT_KEYS[(CAT_KEYS.indexOf(c) + 1) % CAT_KEYS.length];
const SUGGESTED = ["Kira", "Elektrik", "Su", "İnternet", "Isınma", "Tamir", "Temizlik", "Yiyecek", "Ulaşım", "Eğlence", "Diğer"];

const toDDMMYYYY = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };
const fromDDMMYYYY = (s: string): string | null => {
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};
const num = (s: string, fallback = 0) => {
  const v = parseFloat(s.replace(",", "."));
  return Number.isFinite(v) ? v : fallback;
};

export default function ExpenseEdit() {
  const { expenseId } = useLocalSearchParams<{ expenseId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { members } = useHousehold();

  const [expense, setExpense] = useState<Expense | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [dateInput, setDateInput] = useState("");
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [target, setTarget] = useState<Target>({ type: "household" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ expenses: Expense[] }>("/expenses");
      const found = (res.expenses || []).find((e) => e.expense_id === expenseId);
      if (!found) { setError("Harcama bulunamadı ya da artık görünmüyor"); return; }
      setExpense(found);
      const items = found.items || [];
      setRows(
        items.length
          ? items.map((it) => ({
              name: it.name || "",
              price: String(it.price ?? 0).replace(".", ","),
              quantity: String(it.quantity ?? 1),
              category: it.category || "diger",
            }))
          // Older entries saved before item tracking: seed one line from the
          // total so there is something to edit instead of an empty screen.
          : [{ name: found.merchant || "Harcama", price: String(found.total).replace(".", ","),
               quantity: "1", category: "diger" }]
      );
      setDateInput(toDDMMYYYY(found.expense_date || ""));
      setMerchant(found.merchant || "");
      setCategory(found.category || "");
      setNotes(found.notes || "");
      setTarget({
        type: found.target_type as Target["type"],
        user_id: found.target_user_id || undefined,
      });
    } catch (e: any) { setError(e?.message || "Yüklenemedi"); }
    finally { setLoading(false); }
  }, [expenseId]);

  useEffect(() => { load(); }, [load]);

  const rowTotal = (r: Row) => num(r.price) * num(r.quantity, 1);
  const total = useMemo(() => rows.reduce((s, r) => s + rowTotal(r), 0), [rows]);
  const otherMembers = members.filter((m) => m.user_id !== user?.user_id);

  const updateRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));
  const addRow = () =>
    setRows((rs) => [...rs, { name: "", price: "0,00", quantity: "1", category: "diger" }]);

  const save = async () => {
    setError(null);
    const valid = rows.filter((r) => r.name.trim() && num(r.price) !== 0);
    if (valid.length === 0) { setError("En az bir geçerli kalem gerekli"); return; }
    const iso = fromDDMMYYYY(dateInput);
    if (!iso) { setError("Tarih formatı: GG.AA.YYYY"); return; }
    const newTotal = valid.reduce((s, r) => s + rowTotal(r), 0);
    if (newTotal <= 0) { setError("Toplam sıfırdan büyük olmalı"); return; }

    setSaving(true);
    try {
      await api(`/expenses/${expenseId}`, {
        method: "PATCH",
        body: JSON.stringify({
          items: valid.map((r) => ({
            name: r.name.trim(),
            price: num(r.price),
            quantity: num(r.quantity, 1),
            category: r.category,
          })),
          total: newTotal,
          expense_date: iso,
          merchant: merchant.trim(),
          category: category.trim(),
          notes: notes.trim(),
          target_type: target.type,
          target_user_id: target.type === "roommate" ? target.user_id : null,
        }),
      });
      router.back();
    } catch (e: any) { setError(e?.message || "Kaydedilemedi"); }
    finally { setSaving(false); }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xxl }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="expense-edit-screen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="edit-back">
            <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Harcamayı düzenle</Text>
            <Text style={styles.headerSub}>Kalem ekle, düzelt veya sil</Text>
          </View>
          <Text style={styles.headerTotal}>{formatEUR(total)}</Text>
        </View>

        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          {!expense ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <>
              {rows.map((r, i) => (
                <View key={i} style={styles.itemCard} testID={`edit-item-${i}`}>
                  <View style={styles.itemHeader}>
                    <Pressable
                      onPress={() => updateRow(i, { category: nextCategory(r.category) })}
                      testID={`edit-item-${i}-category`}
                    >
                      <CategoryIcon category={r.category} size={22} />
                    </Pressable>
                    <TextInput
                      style={styles.nameInput}
                      value={r.name}
                      onChangeText={(t) => updateRow(i, { name: t })}
                      placeholder="Ürün adı"
                      placeholderTextColor={colors.onSurfaceTertiary}
                      testID={`edit-item-${i}-name`}
                    />
                    <Pressable onPress={() => removeRow(i)} hitSlop={8} testID={`edit-item-${i}-delete`}>
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
                        testID={`edit-item-${i}-qty`}
                      />
                    </View>
                    <View style={styles.priceBox}>
                      <Text style={styles.subLabel}>Birim fiyat</Text>
                      <TextInput
                        style={styles.priceInput}
                        value={r.price}
                        onChangeText={(t) => updateRow(i, { price: t.replace(/[^\d.,-]/g, "") })}
                        keyboardType="decimal-pad"
                        testID={`edit-item-${i}-price`}
                      />
                    </View>
                    <View style={styles.totalBox}>
                      <Text style={styles.subLabel}>Toplam</Text>
                      <Text style={styles.rowTotal}>{formatEUR(rowTotal(r))}</Text>
                    </View>
                  </View>
                  <Text style={styles.catLabel}>{CATEGORY_LABEL_TR[r.category]}</Text>
                </View>
              ))}

              <Pressable style={styles.addBtn} onPress={addRow} testID="edit-add-item">
                <Ionicons name="add-circle-outline" size={20} color={colors.brand} />
                <Text style={styles.addTxt}>Kalem ekle</Text>
              </Pressable>

              <Text style={styles.label}>Tarih</Text>
              <TextInput
                style={styles.input}
                value={dateInput}
                onChangeText={setDateInput}
                placeholder="GG.AA.YYYY"
                keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
                placeholderTextColor={colors.onSurfaceTertiary}
                testID="edit-date"
              />

              <Text style={styles.label}>Market / satıcı</Text>
              <View style={styles.merchantRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={merchant}
                  onChangeText={setMerchant}
                  placeholder="REWE, EDEKA…"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  autoCapitalize="characters"
                  testID="edit-merchant"
                />
                {merchant ? <MerchantBadge name={merchant} /> : null}
              </View>

              <Text style={styles.label}>Kategori</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {SUGGESTED.map((t) => (
                  <Chip key={t} label={t} active={category === t}
                        onPress={() => setCategory(category === t ? "" : t)} testID={`edit-cat-${t}`} />
                ))}
              </ScrollView>

              <Text style={styles.label}>Bu harcama kime ait?</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                <Chip label="Ev" icon="home" active={target.type === "household"}
                      onPress={() => setTarget({ type: "household" })} testID="edit-target-household" />
                <Chip label="Kendim" icon="person" active={target.type === "self"}
                      onPress={() => setTarget({ type: "self" })} testID="edit-target-self" />
                {otherMembers.map((m) => (
                  <Chip key={m.user_id} label={`→ ${m.name.split(" ")[0]}`}
                        active={target.type === "roommate" && target.user_id === m.user_id}
                        onPress={() => setTarget({ type: "roommate", user_id: m.user_id })}
                        testID={`edit-target-${m.user_id}`} />
                ))}
              </ScrollView>

              <Text style={styles.label}>Not</Text>
              <TextInput
                style={[styles.input, styles.notesInput]}
                value={notes}
                onChangeText={setNotes}
                multiline
                placeholder="Ek detaylar…"
                placeholderTextColor={colors.onSurfaceTertiary}
                testID="edit-notes"
              />

              {error && <Text style={styles.error} testID="edit-error">{error}</Text>}
            </>
          )}
        </ScrollView>

        {expense && (
          <View style={styles.footer}>
            <View style={{ flex: 1 }}>
              <Text style={styles.footerLabel}>Yeni toplam</Text>
              <Text style={styles.footerTotal}>{formatEUR(total)}</Text>
            </View>
            <Pressable style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save}
                       disabled={saving} testID="edit-save">
              {saving ? <ActivityIndicator color={colors.onBrand} /> : (
                <>
                  <Ionicons name="checkmark" size={18} color={colors.onBrand} />
                  <Text style={styles.saveTxt}>Kaydet</Text>
                </>
              )}
            </Pressable>
          </View>
        )}
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
  form: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
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
  label: { fontSize: font.sizes.sm, fontWeight: font.weights.semibold, color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: font.sizes.lg, color: colors.onSurface, minHeight: 52 },
  merchantRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  notesInput: { minHeight: 88, textAlignVertical: "top" },
  chipRow: { gap: spacing.sm, alignItems: "center", paddingRight: spacing.lg },
  error: { color: colors.error, fontWeight: font.weights.semibold, marginTop: spacing.sm },
  footer: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surface },
  footerLabel: { fontSize: font.sizes.sm, color: colors.onSurfaceSecondary, fontWeight: font.weights.semibold },
  footerTotal: { fontSize: 24, fontWeight: font.weights.bold, color: colors.onSurface, letterSpacing: -0.5 },
  saveBtn: { backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.xl, minHeight: 52, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  saveTxt: { color: colors.onBrand, fontWeight: font.weights.semibold, fontSize: font.sizes.lg },
});
