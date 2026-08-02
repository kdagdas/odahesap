/** Manuel harcama — no photo. Tarih + market + adet destekli. */
import { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiPost } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import { Chip, MerchantBadge, formatEUR, todayISO } from "@/src/ui";
import { colors, spacing, radius, font } from "@/src/theme";

type Target = { type: "self" | "household" | "roommate"; user_id?: string };

const SUGGESTED_TAGS = ["Kira", "Elektrik", "Su", "İnternet", "Isınma", "Tamir", "Temizlik", "Yiyecek", "Ulaşım", "Eğlence", "Diğer"];
const COMMON_MERCHANTS = ["REWE", "EDEKA", "ALDI", "LIDL", "PENNY", "KAUFLAND", "DM", "ROSSMANN", "BAUHAUS", "OBI", "IKEA"];

const toDDMMYYYY = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };
const fromDDMMYYYY = (s: string): string | null => {
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
};

export default function Manual() {
  const router = useRouter();
  const { user } = useAuth();
  const { members } = useHousehold();
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [title, setTitle] = useState("");
  const [merchant, setMerchant] = useState<string>("");
  const [dateInput, setDateInput] = useState(toDDMMYYYY(todayISO()));
  const [category, setCategory] = useState<string>("Kira");
  const [notes, setNotes] = useState("");
  const [target, setTarget] = useState<Target>({ type: "household" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedAmount = parseFloat(amount.replace(",", ".")) || 0;
  const parsedQty = parseFloat(quantity.replace(",", ".")) || 1;
  const totalAmount = parsedAmount * parsedQty;
  const otherMembers = members.filter((m) => m.user_id !== user?.user_id);

  const save = async () => {
    setError(null);
    if (parsedAmount <= 0) { setError("Geçerli bir tutar girin"); return; }
    if (!title.trim()) { setError("Kısa bir açıklama girin"); return; }
    const iso = fromDDMMYYYY(dateInput);
    if (!iso) { setError("Tarih formatı: GG.AA.YYYY"); return; }
    setSaving(true);
    try {
      await apiPost("/expenses", {
        target_type: target.type,
        target_user_id: target.user_id || null,
        items: [{ name: title.trim(), price: parsedAmount, quantity: parsedQty, category: "diger" }],
        total: totalAmount,
        source: "manual",
        category,
        merchant: merchant.trim() || null,
        notes: notes.trim() || null,
        expense_date: iso,
      });
      router.replace("/(tabs)/panel");
    } catch (e: any) { setError(e.message || "Kaydetme başarısız"); }
    finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="manual-screen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} testID="manual-back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.title}>Manuel harcama</Text>
          <View style={{ width: 26 }} />
        </View>

        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <View style={styles.amountCard}>
            <Text style={styles.amountLabel}>Tutar</Text>
            <View style={styles.amountWrap}>
              <Text style={styles.currency}>€</Text>
              <TextInput
                style={styles.amountInput}
                value={amount}
                onChangeText={(t) => setAmount(t.replace(/[^\d.,]/g, ""))}
                placeholder="0,00"
                placeholderTextColor={colors.borderStrong}
                keyboardType="decimal-pad"
                testID="manual-amount-input"
              />
            </View>
            {parsedQty !== 1 && (
              <Text style={styles.amountPreview}>× {parsedQty} adet = {formatEUR(totalAmount)}</Text>
            )}
          </View>

          <Text style={styles.label}>Başlık</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Örn. Ekim ayı elektrik faturası"
            placeholderTextColor={colors.onSurfaceTertiary}
            testID="manual-title-input"
          />

          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Adet</Text>
              <TextInput
                style={styles.input}
                value={quantity}
                onChangeText={(t) => setQuantity(t.replace(/[^\d.,]/g, ""))}
                keyboardType="decimal-pad"
                testID="manual-quantity-input"
              />
            </View>
            <View style={{ flex: 2 }}>
              <Text style={styles.label}>Tarih</Text>
              <TextInput
                style={styles.input}
                value={dateInput}
                onChangeText={setDateInput}
                placeholder="GG.AA.YYYY"
                keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
                placeholderTextColor={colors.onSurfaceTertiary}
                testID="manual-date-input"
              />
            </View>
          </View>

          <Text style={styles.label}>Market / satıcı (opsiyonel)</Text>
          <View style={styles.merchantRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={merchant}
              onChangeText={setMerchant}
              placeholder="REWE, EDEKA, elektrik şirketi…"
              placeholderTextColor={colors.onSurfaceTertiary}
              autoCapitalize="characters"
              testID="manual-merchant-input"
            />
            {merchant ? <MerchantBadge name={merchant} /> : null}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {COMMON_MERCHANTS.map((m) => (
              <Chip key={m} label={m} active={merchant === m} onPress={() => setMerchant(merchant === m ? "" : m)} testID={`manual-merchant-${m}`} />
            ))}
          </ScrollView>

          <Text style={styles.label}>Kategori</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {SUGGESTED_TAGS.map((t) => (
              <Chip key={t} label={t} active={category === t} onPress={() => setCategory(t)} testID={`manual-cat-${t}`} />
            ))}
          </ScrollView>

          <Text style={styles.label}>Bu harcama kime ait?</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            <Chip label="Ev" icon="home" active={target.type === "household"} onPress={() => setTarget({ type: "household" })} testID="manual-target-household" />
            <Chip label="Kendim" icon="person" active={target.type === "self"} onPress={() => setTarget({ type: "self" })} testID="manual-target-self" />
            {otherMembers.map((m) => (
              <Chip
                key={m.user_id}
                label={`→ ${m.name.split(" ")[0]}`}
                active={target.type === "roommate" && target.user_id === m.user_id}
                onPress={() => setTarget({ type: "roommate", user_id: m.user_id })}
                testID={`manual-target-roommate-${m.user_id}`}
              />
            ))}
          </ScrollView>

          <Text style={styles.label}>Not (opsiyonel)</Text>
          <TextInput
            style={[styles.input, styles.notesInput]}
            value={notes}
            onChangeText={setNotes}
            multiline
            placeholder="Ek detaylar…"
            placeholderTextColor={colors.onSurfaceTertiary}
            testID="manual-notes-input"
          />

          {error && <Text style={styles.error} testID="manual-error">{error}</Text>}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} testID="manual-save-btn">
            {saving ? <ActivityIndicator color={colors.onBrand} /> : (
              <>
                <Ionicons name="checkmark" size={18} color={colors.onBrand} />
                <Text style={styles.saveTxt}>Ekle · {formatEUR(totalAmount)}</Text>
              </>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceAlt },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider, backgroundColor: colors.surface },
  title: { fontSize: font.sizes.xl, fontWeight: font.weights.bold, color: colors.onSurface },
  form: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxxl },
  amountCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs, borderWidth: 1, borderColor: colors.border, alignItems: "center", marginBottom: spacing.sm },
  amountLabel: { fontSize: font.sizes.sm, color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: font.weights.semibold },
  amountWrap: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  currency: { fontSize: 40, color: colors.brand, fontWeight: font.weights.bold },
  amountInput: { fontSize: 52, fontWeight: font.weights.bold, color: colors.onSurface, minWidth: 140, textAlign: "center", padding: 0 },
  amountPreview: { fontSize: font.sizes.base, color: colors.brand, fontWeight: font.weights.semibold, marginTop: 4 },
  label: { fontSize: font.sizes.sm, fontWeight: font.weights.semibold, color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.md },
  row2: { flexDirection: "row", gap: spacing.md },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: font.sizes.lg, color: colors.onSurface, minHeight: 52 },
  merchantRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  notesInput: { minHeight: 96, textAlignVertical: "top" },
  chipRow: { gap: spacing.sm, alignItems: "center", paddingRight: spacing.lg },
  error: { color: colors.error, fontWeight: font.weights.semibold, marginTop: spacing.sm },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surface },
  saveBtn: { backgroundColor: colors.brand, borderRadius: radius.pill, minHeight: 52, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  saveTxt: { color: colors.onBrand, fontWeight: font.weights.semibold, fontSize: font.sizes.lg },
});
