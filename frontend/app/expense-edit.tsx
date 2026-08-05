/** Harcama düzenleme — kalem kalem. Yanlış yazılan domates düzeltilir,
 *  unutulan kalem eklenir, fazladan girilen silinir; toplam kalemlerden
 *  hesaplanır, elle girilmez. */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, apiGet } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, Sheet, Card, Divider, Chip, MerchantBadge, CategoryIcon, formatEUR,
} from "@/src/ui";
import {
  colors, spacing, radius, type as T, overline, fontFamily,
  CATEGORY_ICONS, CATEGORY_LABEL_TR,
} from "@/src/theme";

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
  const insets = useSafeAreaInsets();
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
      <View style={styles.root}>
        <ScreenHeader overline="DÜZENLE" title="Harcama" />
        <Sheet><ActivityIndicator color={colors.dark} style={{ marginTop: spacing.xxl }} /></Sheet>
      </View>
    );
  }

  return (
    <View style={styles.root} testID="expense-edit-screen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScreenHeader
          overline="DÜZENLE"
          title="Harcamayı düzenle"
          right={
            <Pressable onPress={() => router.back()} hitSlop={12} testID="edit-back" style={styles.headBtn}>
              <Ionicons name="close" size={20} color={colors.onDark} />
            </Pressable>
          }
        >
          <Text style={styles.heroLabel}>Kalemlerden hesaplanan toplam</Text>
          <Text style={styles.heroTotal}>{formatEUR(total)}</Text>
        </ScreenHeader>

        <Sheet>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            {!expense ? (
              <Text style={styles.error}>{error}</Text>
            ) : (
              <>
                {/* Kalemler tek kap içinde: sekiz kalem sekiz kenarlık demek değil. */}
                <Card title="Kalemler">
                  {rows.map((r, i) => (
                    <View key={i} testID={`edit-item-${i}`}>
                      {i > 0 && <Divider inset={spacing.lg} />}
                      <View style={styles.item}>
                        <View style={styles.itemHeader}>
                          <Pressable
                            onPress={() => updateRow(i, { category: nextCategory(r.category) })}
                            testID={`edit-item-${i}-category`}
                          >
                            <CategoryIcon category={r.category} size={40} />
                          </Pressable>
                          <View style={{ flex: 1, gap: 2 }}>
                            <TextInput
                              style={styles.nameInput}
                              value={r.name}
                              onChangeText={(t) => updateRow(i, { name: t })}
                              placeholder="Ürün adı"
                              placeholderTextColor={colors.inkTertiary}
                              testID={`edit-item-${i}-name`}
                            />
                            <Text style={styles.catLabel}>{CATEGORY_LABEL_TR[r.category]}</Text>
                          </View>
                          <Pressable onPress={() => removeRow(i)} hitSlop={8} testID={`edit-item-${i}-delete`}>
                            <Ionicons name="close-circle" size={22} color={colors.inkTertiary} />
                          </Pressable>
                        </View>
                        <View style={styles.itemBody}>
                          <View style={styles.qtyBox}>
                            <Text style={styles.subLabel}>ADET</Text>
                            <TextInput
                              style={styles.qtyInput}
                              value={r.quantity}
                              onChangeText={(t) => updateRow(i, { quantity: t.replace(/[^\d.,]/g, "") })}
                              keyboardType="decimal-pad"
                              testID={`edit-item-${i}-qty`}
                            />
                          </View>
                          <View style={styles.priceBox}>
                            <Text style={styles.subLabel}>BİRİM FİYAT</Text>
                            <TextInput
                              style={styles.priceInput}
                              value={r.price}
                              onChangeText={(t) => updateRow(i, { price: t.replace(/[^\d.,-]/g, "") })}
                              keyboardType="decimal-pad"
                              testID={`edit-item-${i}-price`}
                            />
                          </View>
                          <View style={styles.totalBox}>
                            <Text style={styles.subLabel}>TOPLAM</Text>
                            <Text style={styles.rowTotal}>{formatEUR(rowTotal(r))}</Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  ))}
                  <Divider inset={spacing.lg} />
                  <Pressable style={styles.addBtn} onPress={addRow} testID="edit-add-item">
                    <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
                    <Text style={styles.addTxt}>Kalem ekle</Text>
                  </Pressable>
                </Card>

                <Text style={styles.label}>TARİH</Text>
                <TextInput
                  style={styles.input}
                  value={dateInput}
                  onChangeText={setDateInput}
                  placeholder="GG.AA.YYYY"
                  keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
                  placeholderTextColor={colors.inkTertiary}
                  testID="edit-date"
                />

                <Text style={styles.label}>MARKET / SATICI</Text>
                <View style={styles.merchantRow}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={merchant}
                    onChangeText={setMerchant}
                    placeholder="REWE, EDEKA…"
                    placeholderTextColor={colors.inkTertiary}
                    autoCapitalize="characters"
                    testID="edit-merchant"
                  />
                  {merchant ? <MerchantBadge name={merchant} /> : null}
                </View>

                <Text style={styles.label}>KATEGORİ</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                  {SUGGESTED.map((t) => (
                    <Chip key={t} label={t} active={category === t}
                          onPress={() => setCategory(category === t ? "" : t)} testID={`edit-cat-${t}`} />
                  ))}
                </ScrollView>

                <Text style={styles.label}>BU HARCAMA KİME AİT?</Text>
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

                <Text style={styles.label}>NOT</Text>
                <TextInput
                  style={[styles.input, styles.notesInput]}
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  placeholder="Ek detaylar…"
                  placeholderTextColor={colors.inkTertiary}
                  testID="edit-notes"
                />

                {error && <Text style={styles.error} testID="edit-error">{error}</Text>}
              </>
            )}
          </ScrollView>

          {expense && (
            <View style={[styles.footer, { paddingBottom: spacing.lg + insets.bottom }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.footerLabel}>YENİ TOPLAM</Text>
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
        </Sheet>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  headBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.darkSurface,
    alignItems: "center", justifyContent: "center",
  },
  heroLabel: { ...T.caption, color: colors.onDarkMuted },
  heroTotal: {
    fontSize: 36, lineHeight: 44, fontFamily: fontFamily.bold, color: colors.onDark,
    letterSpacing: -0.8, fontVariant: ["tabular-nums"],
  },
  form: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm, paddingBottom: spacing.xxl },
  item: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  itemHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  nameInput: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: 15, fontFamily: fontFamily.medium, color: colors.ink, minHeight: 40,
  },
  catLabel: { ...T.caption, color: colors.inkTertiary, marginLeft: 2 },
  itemBody: { flexDirection: "row", gap: spacing.sm, paddingLeft: 52 },
  qtyBox: { width: 66 },
  priceBox: { flex: 1 },
  totalBox: { width: 90, alignItems: "flex-end" },
  subLabel: { ...overline, fontSize: 10, letterSpacing: 0.8, marginBottom: 4 },
  qtyInput: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    fontSize: 15, color: colors.ink, textAlign: "center", fontFamily: fontFamily.semibold,
  },
  priceInput: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: 15, color: colors.ink, textAlign: "right", fontFamily: fontFamily.semibold,
  },
  rowTotal: { ...T.emph, color: colors.ink, marginTop: 10, fontVariant: ["tabular-nums"] },
  addBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: spacing.lg,
  },
  addTxt: { ...T.bodySb, color: colors.accent },
  label: { ...overline, marginTop: spacing.md },
  input: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    fontSize: 16, fontFamily: fontFamily.regular, color: colors.ink, minHeight: 52,
  },
  merchantRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  notesInput: { minHeight: 88, textAlignVertical: "top" },
  chipRow: { gap: spacing.sm, alignItems: "center", paddingRight: spacing.lg, paddingVertical: 2 },
  error: { ...T.bodySb, color: colors.negative, marginTop: spacing.md },
  footer: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  footerLabel: { ...overline },
  footerTotal: {
    ...T.screen, color: colors.ink, fontVariant: ["tabular-nums"], marginTop: 2,
  },
  saveBtn: {
    backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.xl,
    minHeight: 52, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6,
  },
  saveTxt: { ...T.emph, color: colors.onBrand },
});
