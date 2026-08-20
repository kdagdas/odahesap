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
  ScreenHeader, Sheet, Card, Divider, Chip, MerchantBadge, CategoryPicker, formatEUR, nextUnit, UnitPicker,
  SplitPicker, splitFromExpense, type Split,
} from "@/src/ui";
import {
  colors, spacing, radius, type as T, overline, fontFamily,
  CATEGORY_ICONS, CATEGORY_LABEL_TR,
} from "@/src/theme";

type Row = {
  name: string; price: string; quantity: string; unit: string; category: string;
  /** Ürünün NE olduğu — gruplamanın tamamı buna dayanıyor, o yüzden
   *  düzenlemede de taşınıyor. Taşınmasaydı burada adı düzeltilen bir kalem
   *  eski genel adıyla kalır ve iki ad sessizce ayrışırdı. */
  generic?: string | null;
};
type Item = { name: string; price: number; quantity?: number; unit?: string; category: string };
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
  const [split, setSplit] = useState<Split>({ mode: "equal", with: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * SAHİPLİK — ekran artık başkasının fişini düzenlemeye açmıyor.
   *
   * Sunucu zaten engelliyordu (`_get_editable_expense` 403 döndürüyor), yani
   * veri hiçbir zaman risk altında değildi. Ama istemci bunu bilmediği için
   * formu açıyor, alanları düzenletiyor ve ancak KAYDET'e basınca hata
   * veriyordu: yapılamayacak bir işi teklif eden bir kapı.
   *
   * Market sayfasından bir fişe dokununca ortaya çıktı ve ev sahibi haklı
   * olarak "ben Salih'in harcamasını düzenleyebiliyorum" diye bildirdi.
   *
   * Başkasının fişi yine de AÇILIYOR, çünkü onu görmeye hakkın var
   * (bölüşme listesindesin); yalnızca salt okunur.
   */
  const benimMi = !!expense && expense.added_by === user?.user_id;
  const ekleyen = expense
    ? (members.find((m) => m.user_id === expense.added_by)?.name || "Bir ev arkadaşın")
    : "";

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
              quantity: String(it.quantity ?? 1).replace(".", ","),
              unit: it.unit || "adet",
              category: it.category || "diger",
              generic: (it as any).generic || null,
            }))
          // Older entries saved before item tracking: seed one line from the
          // total so there is something to edit instead of an empty screen.
          : [{ name: found.merchant || "Harcama", price: String(found.total).replace(".", ","),
               quantity: "1", unit: "adet", category: "diger" }]
      );
      setDateInput(toDDMMYYYY(found.expense_date || ""));
      setMerchant(found.merchant || "");
      setCategory(found.category || "");
      setNotes(found.notes || "");

    } catch (e: any) { setError(e?.message || "Yüklenemedi"); }
    finally { setLoading(false); }
  }, [expenseId]);

  useEffect(() => { load(); }, [load]);

  // Bölüşüm kayıt ile üye listesinin ikisi de geldiğinde bir kez kuruluyor.
  // `load` üye listesine bağlansaydı ev bilgisi her ekran odaklanmasında
  // tazelendiği için kullanıcının yarım kalan düzenlemesi silinirdi.
  useEffect(() => {
    if (expense && members.length && !Object.keys(split.with).length) {
      setSplit(splitFromExpense(expense, members));
    }
  }, [expense, members]);

  const [silinen, setSilinen] = useState<{ satir: Row; index: number } | null>(null);
  const [genelDuzenle, setGenelDuzenle] = useState<number | null>(null);
  useEffect(() => {
    if (!silinen) return;
    const t = setTimeout(() => setSilinen(null), 8000);
    return () => clearTimeout(t);
  }, [silinen]);

  const rowTotal = (r: Row) => num(r.price) * num(r.quantity, 1);
  const total = useMemo(() => rows.reduce((s, r) => s + rowTotal(r), 0), [rows]);

  const updateRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  /* Silme GERİ ALINABİLİR — fiş inceleme ekranındaki kuralın aynısı.
     Onay sorulmuyor: silme çoğu zaman bilinçli ve her seferinde "emin misin?"
     sormak doğru işi cezalandırır. Geri alma yalnızca hata yapana bedel
     ödetiyor, o da tek dokunuş. Satır ESKİ YERİNE dönüyor. */
  const removeRow = (i: number) => {
    const satir = rows[i];
    setRows((rs) => rs.filter((_, idx) => idx !== i));
    if (satir) setSilinen({ satir, index: i });
  };

  const geriAl = () => {
    if (!silinen) return;
    const { satir, index } = silinen;
    setRows((rs) => [...rs.slice(0, index), satir, ...rs.slice(index)]);
    setSilinen(null);
  };
  const addRow = () =>
    setRows((rs) => [...rs, { name: "", price: "0,00", quantity: "1", unit: "adet", category: "diger" }]);

  const save = async () => {
    setError(null);
    const valid = rows.filter((r) => r.name.trim() && num(r.price) !== 0);
    if (valid.length === 0) { setError("En az bir geçerli kalem gerekli"); return; }
    const iso = fromDDMMYYYY(dateInput);
    if (!iso) { setError("Tarih formatı: GG.AA.YYYY"); return; }
    const newTotal = valid.reduce((s, r) => s + rowTotal(r), 0);
    if (newTotal <= 0) { setError("Toplam sıfırdan büyük olmalı"); return; }
    if (!Object.keys(split.with).length) { setError("Bölüşülecek kişi seçin"); return; }
    // Kalem düzenlemek toplamı değiştirir; kişiye özel bölüşüm eski toplama
    // göre girilmişti. Oransal dağıtmak kimsenin onaylamadığı bir borç üretir.
    if (split.mode === "exact") {
      const sum = Object.values(split.with).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - newTotal) > 0.01) {
        setError("Toplam değişti, bölüşümü yeniden düzenleyin");
        return;
      }
    }

    setSaving(true);
    try {
      await api(`/expenses/${expenseId}`, {
        method: "PATCH",
        body: JSON.stringify({
          items: valid.map((r) => ({
            name: r.name.trim(),
            price: num(r.price),
            quantity: num(r.quantity, 1),
            unit: r.unit,
            category: r.category,
            generic: (r.generic || "").trim().toLowerCase() || null,
          })),
          total: newTotal,
          expense_date: iso,
          merchant: merchant.trim(),
          category: category.trim(),
          notes: notes.trim(),
          split_mode: split.mode,
          split_with: split.with,
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
        <Sheet><ActivityIndicator color={colors.ink} style={{ marginTop: spacing.xxl }} /></Sheet>
      </View>
    );
  }

  return (
    <View style={styles.root} testID="expense-edit-screen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        {/* Başlık kaydırma alanının içinde; alttaki Kaydet çubuğu sabit kalıyor. */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.page}
                    keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <ScreenHeader
          overline={benimMi ? "DÜZENLE" : "HARCAMA"}
          title={benimMi ? "Harcamayı Düzenle" : "Harcama Detayı"}
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
          {/* Başkasının fişinde form DOKUNULMAZ. Alanları düzenletip
              KAYDET'te hata vermek, yapılamayacak bir işi teklif etmekti.
              `pointerEvents="none"` tek satırda bütün girdileri kapatıyor ve
              dokunuşlar ScrollView'a geçtiği için sayfa yine kayıyor. */}
          <View style={styles.form} pointerEvents={benimMi ? "auto" : "none"}>
            {!expense ? (
              <Text style={styles.error}>{error}</Text>
            ) : (
              <>
                {/* Neden düzenleyemediğini SÖYLÜYOR. Sessizce salt okunur
                    yapmak "uygulama bozuk mu" sorusu bırakırdı; kural basit
                    ve savunulabilir: bir harcamayı yalnızca ekleyen
                    değiştirebilir, çünkü onu gören tek kişi o değil ama
                    fişi elinde tutan o. */}
                {!benimMi && (
                  <View style={styles.saltOkunur}>
                    <Ionicons name="lock-closed-outline" size={16} color={colors.inkSecondary} />
                    <Text style={styles.saltOkunurTxt}>
                      Bu harcamayı {ekleyen.split(" ")[0]} ekledi. Görebilirsin
                      ama yalnızca ekleyen kişi değiştirebilir.
                    </Text>
                  </View>
                )}
                {/* Kalemler tek kap içinde: sekiz kalem sekiz kenarlık demek değil. */}
                <Card title="Kalemler">
                  {rows.map((r, i) => (
                    <View key={i} testID={`edit-item-${i}`}>
                      {i > 0 && <Divider inset={spacing.lg} />}
                      <View style={styles.item}>
                        <View style={styles.itemHeader}>
                          <CategoryPicker
                            category={r.category} size={36}
                            onPress={() => updateRow(i, { category: nextCategory(r.category) })}
                            testID={`edit-item-${i}-category`}
                          />
                          <View style={{ flex: 1, gap: 2 }}>
                            <TextInput
                              style={styles.nameInput}
                              value={r.name}
                              onChangeText={(t) => updateRow(i, { name: t })}
                              placeholder="Ürün adı"
                              placeholderTextColor={colors.inkTertiary}
                              testID={`edit-item-${i}-name`}
                            />
                            {/* KATEGORİ · GENEL AD — fiş inceleme ekranıyla
                                birebir aynı. Genel ad ürün gruplamasının
                                tamamını besliyor; burada görünmezse kayıtlı
                                bir fişte ürün adını düzelten kişi genel adı
                                eskisiyle bırakır ve iki ad birbirinden
                                sessizce ayrışır. */}
                            <View style={styles.etiketSatir}>
                              <Text style={styles.catLabel}>{CATEGORY_LABEL_TR[r.category]}</Text>
                              <Text style={styles.catAyrac}>·</Text>
                              {genelDuzenle === i ? (
                                <TextInput
                                  style={styles.genelInput}
                                  value={r.generic || ""}
                                  onChangeText={(t) => updateRow(i, { generic: t || null })}
                                  onBlur={() => setGenelDuzenle(null)}
                                  onSubmitEditing={() => setGenelDuzenle(null)}
                                  placeholder="süt, sucuk…"
                                  placeholderTextColor={colors.inkTertiary}
                                  autoCapitalize="none"
                                  autoFocus
                                  returnKeyType="done"
                                  testID={`edit-item-${i}-generic`}
                                />
                              ) : (
                                <Pressable onPress={() => setGenelDuzenle(i)} hitSlop={8}
                                           testID={`edit-item-${i}-generic-edit`}>
                                  <Text style={[styles.genelTxt, !r.generic && styles.genelBos]}>
                                    {r.generic || "genel ad yok"}
                                  </Text>
                                </Pressable>
                              )}
                            </View>
                          </View>
                          {/* ÇÖP KUTUSU, çarpı değil. `close-circle` "kapat"
                              diye okunuyordu ve fiş inceleme ekranında tam bu
                              yüzden kaza oldu. Burada satırlar zaten açık
                              olduğu için yazılı bir eylem satırı her kaleme
                              tekrar ederdi; simgeyi DEĞİŞTİRMEK yetiyor —
                              çöp kutusu ne yaptığını kendi söylüyor. Yanlış
                              dokunuşun bedelini de geri alma karşılıyor. */}
                          <Pressable onPress={() => removeRow(i)} hitSlop={10}
                                     style={styles.silDugme}
                                     testID={`edit-item-${i}-delete`}>
                            <Ionicons name="trash-outline" size={17} color={colors.negative} />
                          </Pressable>
                        </View>
                        {/* Etiket satırı sabit yükseklikte: "BİRİM FİYAT" iki
                            satıra sarınca altındaki kutular kayıyordu. */}
                        <View style={styles.itemBody}>
                          <View style={styles.qtyBox}>
                            <View style={styles.labelRow}>
                              <UnitPicker unit={r.unit}
                                          onPress={() => updateRow(i, { unit: nextUnit(r.unit) })}
                                          testID={`edit-item-${i}-unit`} />
                            </View>
                            <TextInput
                              style={styles.qtyInput}
                              value={r.quantity}
                              onChangeText={(t) => updateRow(i, { quantity: t.replace(/[^\d.,]/g, "") })}
                              keyboardType="decimal-pad"
                              testID={`edit-item-${i}-qty`}
                            />
                          </View>
                          <View style={styles.priceBox}>
                            <View style={styles.labelRow}>
                              <Text style={styles.subLabel} numberOfLines={1}>FİYAT</Text>
                            </View>
                            <TextInput
                              style={styles.priceInput}
                              value={r.price}
                              onChangeText={(t) => updateRow(i, { price: t.replace(/[^\d.,-]/g, "") })}
                              keyboardType="decimal-pad"
                              testID={`edit-item-${i}-price`}
                            />
                          </View>
                          <View style={styles.totalBox}>
                            <View style={styles.labelRow}>
                              <Text style={styles.subLabel} numberOfLines={1}>TOPLAM</Text>
                            </View>
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

                <View style={styles.splitBox}>
                  <SplitPicker
                    label="BU HARCAMA KİME AİT?"
                    value={split}
                    onChange={setSplit}
                    members={members}
                    meId={user?.user_id}
                    total={total}
                    testID="edit-split"
                  />
                </View>

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
          </View>
        </Sheet>
        </ScrollView>

        {silinen && (
          <View style={styles.geriSerit} testID="edit-undo">
            <Ionicons name="trash-outline" size={16} color={colors.onDarkMuted} />
            <Text style={styles.geriTxt} numberOfLines={1}>
              {silinen.satir.name || "Kalem"} silindi
            </Text>
            <Pressable onPress={geriAl} hitSlop={10} testID="edit-undo-btn">
              <Text style={styles.geriBtn}>Geri al</Text>
            </Pressable>
          </View>
        )}

        {expense && benimMi && (
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
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  page: { backgroundColor: colors.bg, flexGrow: 1 },
  saltOkunur: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  saltOkunurTxt: { ...T.caption, color: colors.inkSecondary, flex: 1 },
  headBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.darkSurface,
    alignItems: "center", justifyContent: "center",
  },
  heroLabel: { ...T.caption, color: colors.onDarkMuted },
  heroTotal: {
    fontSize: 32, lineHeight: 40, fontFamily: fontFamily.semibold, color: colors.onDark,
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
  geriSerit: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.dark, marginHorizontal: spacing.lg,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  geriTxt: { ...T.caption, color: colors.onDark, flex: 1 },
  geriBtn: { ...T.bodySb, color: colors.accentOnDark },
  etiketSatir: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 20 },
  catAyrac: { ...T.caption, color: colors.onSurfaceTertiary },
  genelTxt: { ...T.captionSb, color: colors.inkSecondary },
  genelBos: { ...T.caption, color: colors.onSurfaceTertiary, fontStyle: "italic" },
  genelInput: {
    ...T.captionSb, color: colors.ink, padding: 0, minWidth: 90,
    borderBottomWidth: 1, borderBottomColor: colors.accent,
  },
  /* 44 piksellik dokunma alanı; ikon 17 ama basılacak yer daha geniş. */
  silDugme: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  catLabel: { ...T.caption, color: colors.inkTertiary, marginLeft: 2 },
  itemBody: { flexDirection: "row", gap: spacing.sm, paddingLeft: 52 },
  qtyBox: { width: 74 },
  priceBox: { flex: 1 },
  totalBox: { width: 90, alignItems: "flex-end" },
  subLabel: { ...overline, fontSize: 10, letterSpacing: 0.8 },
  // Sabit yukseklik: etiketlerden biri sarsa bile altlarindaki kutular hizali kalir.
  labelRow: { height: 22, justifyContent: "center", marginBottom: 4 },
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
  splitBox: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    borderRadius: radius.md, marginTop: spacing.md, overflow: "hidden",
  },
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
