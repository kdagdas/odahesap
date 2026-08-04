/** Harcama düzenleme — tutar, tarih, market, kategori, kime ait ve not. */
import { useCallback, useEffect, useState } from "react";
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
import { colors, spacing, radius, font, CATEGORY_LABEL_TR } from "@/src/theme";

type Target = { type: "self" | "household" | "roommate"; user_id?: string };
type Item = { name: string; price: number; quantity?: number; category: string };
type Expense = {
  expense_id: string; added_by: string; target_type: string; target_user_id?: string;
  total: number; merchant?: string; category?: string; notes?: string;
  source: string; expense_date?: string; items?: Item[];
};

const SUGGESTED = ["Kira", "Elektrik", "Su", "İnternet", "Isınma", "Tamir", "Temizlik", "Yiyecek", "Ulaşım", "Eğlence", "Diğer"];
const toDDMMYYYY = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };
const fromDDMMYYYY = (s: string): string | null => {
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};

export default function ExpenseEdit() {
  const { expenseId } = useLocalSearchParams<{ expenseId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { members } = useHousehold();

  const [expense, setExpense] = useState<Expense | null>(null);
  const [amount, setAmount] = useState("");
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
      setAmount(String(found.total).replace(".", ","));
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

  const parsedAmount = parseFloat(amount.replace(",", ".")) || 0;
  const otherMembers = members.filter((m) => m.user_id !== user?.user_id);
  const items = expense?.items || [];
  // A receipt carries a per-item breakdown. Editing the total by hand would
  // leave that breakdown disagreeing with it, so say so rather than silently
  // producing a receipt whose lines no longer add up.
  const breakdownWillDrift = items.length > 1 && Math.abs(
    items.reduce((s, i) => s + (i.quantity || 1) * i.price, 0) - parsedAmount
  ) > 0.01;

  const save = async () => {
    setError(null);
    if (parsedAmount <= 0) { setError("Geçerli bir tutar girin"); return; }
    const iso = fromDDMMYYYY(dateInput);
    if (!iso) { setError("Tarih formatı: GG.AA.YYYY"); return; }

    setSaving(true);
    try {
      const body: any = {
        total: parsedAmount,
        expense_date: iso,
        merchant: merchant.trim(),
        category: category.trim(),
        notes: notes.trim(),
        target_type: target.type,
        target_user_id: target.type === "roommate" ? target.user_id : null,
      };
      // Single-item manual entries keep their one line in step with the total.
      if (items.length === 1) {
        body.items = [{ ...items[0], price: parsedAmount, quantity: 1 }];
      }
      await api(`/expenses/${expenseId}`, { method: "PATCH", body: JSON.stringify(body) });
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
          <Text style={styles.title}>Harcamayı düzenle</Text>
          <View style={{ width: 26 }} />
        </View>

        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          {!expense ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <>
              <View style={styles.amountCard}>
                <Text style={styles.amountLabel}>Tutar</Text>
                <View style={styles.amountWrap}>
                  <Text style={styles.currency}>€</Text>
                  <TextInput
                    style={styles.amountInput}
                    value={amount}
                    onChangeText={(t) => setAmount(t.replace(/[^\d.,]/g, ""))}
                    keyboardType="decimal-pad"
                    testID="edit-amount"
                  />
                </View>
              </View>

              {items.length > 1 && (
                <View style={styles.itemsBox}>
                  <Text style={styles.label}>Fiş kalemleri ({items.length})</Text>
                  {items.map((it, i) => (
                    <View key={i} style={styles.itemRow}>
                      <CategoryIcon category={it.category} size={14} />
                      <Text style={styles.itemName} numberOfLines={1}>{it.name}</Text>
                      <Text style={styles.itemPrice}>{formatEUR((it.quantity || 1) * it.price)}</Text>
                    </View>
                  ))}
                  {breakdownWillDrift && (
                    <View style={styles.driftWarn}>
                      <Ionicons name="alert-circle" size={15} color="#B45309" />
                      <Text style={styles.driftTxt}>
                        Kalemlerin toplamı girdiğin tutarla uyuşmuyor. Hesaplarda bu
                        tutar kullanılır, kalem listesi olduğu gibi kalır.
                      </Text>
                    </View>
                  )}
                </View>
              )}

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
            <Pressable style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save}
                       disabled={saving} testID="edit-save">
              {saving ? <ActivityIndicator color={colors.onBrand} /> : (
                <>
                  <Ionicons name="checkmark" size={18} color={colors.onBrand} />
                  <Text style={styles.saveTxt}>Kaydet · {formatEUR(parsedAmount)}</Text>
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
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider, backgroundColor: colors.surface },
  title: { fontSize: font.sizes.xl, fontWeight: font.weights.bold, color: colors.onSurface },
  form: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxxl },
  amountCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  amountLabel: { fontSize: font.sizes.sm, color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: font.weights.semibold },
  amountWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  currency: { fontSize: 36, color: colors.brand, fontWeight: font.weights.bold },
  amountInput: { fontSize: 46, fontWeight: font.weights.bold, color: colors.onSurface, minWidth: 130, textAlign: "center", padding: 0 },
  itemsBox: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  itemName: { flex: 1, fontSize: font.sizes.base, color: colors.onSurface },
  itemPrice: { fontSize: font.sizes.base, color: colors.onSurfaceSecondary, fontWeight: font.weights.semibold },
  driftWarn: { flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: "#FEF3C7", borderRadius: radius.sm, padding: spacing.sm },
  driftTxt: { flex: 1, fontSize: font.sizes.sm, color: "#92400E", lineHeight: 17 },
  label: { fontSize: font.sizes.sm, fontWeight: font.weights.semibold, color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.md },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: font.sizes.lg, color: colors.onSurface, minHeight: 52 },
  merchantRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  notesInput: { minHeight: 88, textAlignVertical: "top" },
  chipRow: { gap: spacing.sm, alignItems: "center", paddingRight: spacing.lg },
  error: { color: colors.error, fontWeight: font.weights.semibold, marginTop: spacing.sm },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surface },
  saveBtn: { backgroundColor: colors.brand, borderRadius: radius.pill, minHeight: 52, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  saveTxt: { color: colors.onBrand, fontWeight: font.weights.semibold, fontSize: font.sizes.lg },
});
