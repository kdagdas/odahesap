/** Manuel harcama — no photo. Tarih + market + adet destekli. */
import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiGet, apiPost } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, Sheet, Chip, MerchantBadge, SplitPicker, splitAll, formatEUR, todayISO,
  type Split,
} from "@/src/ui";
import {
  colors, spacing, radius, type as T, overline, fontFamily, CATEGORY_LABEL_TR,
} from "@/src/theme";

/**
 * Kategoriler artık FİŞLERLE AYNI liste.
 *
 * Burada ayrı bir etiket kümesi vardı (Kira, Elektrik, Su, Yiyecek…) ve
 * ekranda çalışıyor görünüyordu ama **hiçbir yere ulaşmıyordu:** seçilen
 * etiket harcamaya yazılıyor, kalemin kategorisi ise kodda sabit `"diger"`
 * kalıyordu. "Nereye Gitti" halkası kalemin kategorisini okuduğu için elle
 * girilen her şey, ne seçilirse seçilsin, Diğer diliminde birikiyordu.
 * Gerçek veride doğrulandı: beş elle harcamanın beşi de etiketliydi, beşinin
 * de kalem kategorisi `diger`.
 *
 * İki listeyi tek listeye indirmek, iki farklı taksonomiyi barıştırmaktan
 * ucuz: kira ve abonelik gibi tekrar eden şeylerin yeri zaten DÜZENLİ
 * ÖDEMELER ekranı; elle giriş çoğunlukla gerçek bir alışveriş oluyor
 * (kasap, market) ve o da bu dokuz kategoriye oturuyor.
 */
const KATEGORILER = [
  "meyve_sebze", "et_balik", "sut_urunleri", "firin", "temel_gida",
  "icecek", "atistirmalik", "ev_urunleri", "diger",
] as const;
const COMMON_MERCHANTS = ["REWE", "EDEKA", "ALDI", "LIDL", "PENNY", "KAUFLAND", "DM", "ROSSMANN", "BAUHAUS", "OBI", "IKEA"];

const toDDMMYYYY = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };
const fromDDMMYYYY = (s: string): string | null => {
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
};

export default function Manual() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { members } = useHousehold();
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [title, setTitle] = useState("");
  const [merchant, setMerchant] = useState<string>("");
  const [dateInput, setDateInput] = useState(toDDMMYYYY(todayISO()));
  const [category, setCategory] = useState<string>("diger");
  /** Ürünün NE olduğu. Elle girişte de toplanıyor; yoksa bu kayıtlar ürün
   *  listelerinde ham adlarıyla tek tek durur. */
  const [generic, setGeneric] = useState("");
  /** Evin kendi geçmişinden gelen genel ad önerileri. */
  const [oneriler, setOneriler] = useState<string[]>([]);
  /* Başlık yazıldıkça evin geçmişinden genel ad önerisi.
     Ayrı bir uç yazılmadı: `/search` zaten ürünleri genel adıyla döndürüyor
     ve aynı kaynaktan beslenmek iki listenin ayrışmasını imkânsız kılıyor.
     250 ms bekleme, her harfte istek atmamak için. */
  useEffect(() => {
    const k = title.trim();
    if (k.length < 3 || generic) { setOneriler([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await apiGet<{ products: { name: string }[] }>(
          `/search?q=${encodeURIComponent(k)}`);
        setOneriler((r.products || []).slice(0, 4).map((p) => p.name));
      } catch { setOneriler([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [title, generic]);
  const [notes, setNotes] = useState("");
  const [split, setSplit] = useState<Split>({ mode: "equal", with: {} });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedAmount = parseFloat(amount.replace(",", ".")) || 0;
  const parsedQty = parseFloat(quantity.replace(",", ".")) || 1;
  const totalAmount = parsedAmount * parsedQty;

  // Ev bilgisi ekran açılırken hâlâ iniyor olabiliyor; varsayılan liste
  // üyeler gelince kuruluyor. Kullanıcı seçim yaptıysa üstüne yazılmıyor.
  useEffect(() => {
    if (members.length && !Object.keys(split.with).length) setSplit(splitAll(members));
  }, [members]);

  const save = async () => {
    setError(null);
    if (parsedAmount <= 0) { setError("Geçerli bir tutar girin"); return; }
    if (!title.trim()) { setError("Kısa bir açıklama girin"); return; }
    const iso = fromDDMMYYYY(dateInput);
    if (!iso) { setError("Tarih formatı: GG.AA.YYYY"); return; }
    if (!Object.keys(split.with).length) { setError("Bölüşülecek kişi seçin"); return; }
    // Kişiye özel tutarlar girildikten sonra üstteki tutar değiştirilmiş olabilir.
    // Sunucu da reddediyor ama hata orada "kaydedilemedi" gibi okunuyor.
    if (split.mode === "exact") {
      const sum = Object.values(split.with).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - totalAmount) > 0.01) {
        setError("Tutar değişti, bölüşümü yeniden düzenleyin");
        return;
      }
    }
    setSaving(true);
    try {
      await apiPost("/expenses", {
        split_mode: split.mode,
        split_with: split.with,
        items: [{
          name: title.trim(), price: parsedAmount, quantity: parsedQty,
          // Kategori artık SEÇİLENİ yazıyor. Sabit "diger" olduğu için elle
          // girilen her şey analizde Diğer'e düşüyordu.
          category,
          generic: generic.trim().toLowerCase() || null,
        }],
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
    <View style={styles.root} testID="manual-screen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        {/* Başlık kaydırma alanının içinde; alttaki Kaydet çubuğu sabit kalıyor.
            Tutar koyu alanda: ekranın tek büyük rakamı, kart içinde değil. */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.page}
                    keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <ScreenHeader
          size="l"
          overline="MANUEL HARCAMA"
          title="Yeni Kayıt"
          right={
            <Pressable onPress={() => router.back()} testID="manual-back-btn" hitSlop={12} style={styles.headBtn}>
              <Ionicons name="close" size={20} color={colors.onDark} />
            </Pressable>
          }
        >
          <View style={styles.amountWrap}>
            <Text style={styles.currency}>€</Text>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={(t) => setAmount(t.replace(/[^\d.,]/g, ""))}
              placeholder="0,00"
              placeholderTextColor={colors.onDarkMuted}
              keyboardType="decimal-pad"
              testID="manual-amount-input"
            />
          </View>
          {parsedQty !== 1 && (
            <Text style={styles.amountPreview}>× {parsedQty} adet = {formatEUR(totalAmount)}</Text>
          )}
        </ScreenHeader>

        <Sheet>
          <View style={styles.form}>
            <Text style={styles.label}>BAŞLIK</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Örn. Ekim ayı elektrik faturası"
              placeholderTextColor={colors.inkTertiary}
              testID="manual-title-input"
            />

            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>ADET</Text>
                <TextInput
                  style={styles.input}
                  value={quantity}
                  onChangeText={(t) => setQuantity(t.replace(/[^\d.,]/g, ""))}
                  keyboardType="decimal-pad"
                  testID="manual-quantity-input"
                />
              </View>
              <View style={{ flex: 2 }}>
                <Text style={styles.label}>TARİH</Text>
                <TextInput
                  style={styles.input}
                  value={dateInput}
                  onChangeText={setDateInput}
                  placeholder="GG.AA.YYYY"
                  keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
                  placeholderTextColor={colors.inkTertiary}
                  testID="manual-date-input"
                />
              </View>
            </View>

            <Text style={styles.label}>MARKET / SATICI (OPSİYONEL)</Text>
            <View style={styles.merchantRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={merchant}
                onChangeText={setMerchant}
                placeholder="REWE, EDEKA, elektrik şirketi…"
                placeholderTextColor={colors.inkTertiary}
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

            <Text style={styles.label}>KATEGORİ</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {KATEGORILER.map((k) => (
                <Chip key={k} label={CATEGORY_LABEL_TR[k]} active={category === k}
                      onPress={() => setCategory(k)} testID={`manual-cat-${k}`} />
              ))}
            </ScrollView>

            {/* GENEL AD — fişteki gibi, kategorinin hemen altında ve küçük.
                Altındaki öneriler evin KENDİ geçmişinden geliyor (`/search`),
                yani ayrı bir sözlük tutulmuyor. Amaç yazdırmak değil
                DOKUNDURMAK: "elektrik faturası"nı yeniden yazmak yerine
                geçen ayın kelimesine basmak hem hızlı hem de tutarlılığı
                kendiliğinden üretiyor. Kimseye kategori sorulmuyor, en ucuz
                yol zaten tutarlı olan yol. */}
            <Text style={styles.label}>BU NE? (OPSİYONEL)</Text>
            <TextInput
              style={styles.input}
              value={generic}
              onChangeText={setGeneric}
              placeholder="süt, sucuk, elektrik faturası…"
              placeholderTextColor={colors.inkTertiary}
              autoCapitalize="none"
              testID="manual-generic-input"
            />
            {oneriler.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                          contentContainerStyle={styles.chipRow}>
                {oneriler.map((o) => (
                  <Chip key={o} label={o} active={generic.toLowerCase() === o.toLowerCase()}
                        onPress={() => setGeneric(o.toLowerCase())}
                        testID={`manual-generic-${o}`} />
                ))}
              </ScrollView>
            )}

            <View style={styles.splitBox}>
              <SplitPicker
                label="BU HARCAMA KİME AİT?"
                value={split}
                onChange={setSplit}
                members={members}
                meId={user?.user_id}
                total={totalAmount}
                testID="manual-split"
              />
            </View>

            <Text style={styles.label}>NOT (OPSİYONEL)</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={notes}
              onChangeText={setNotes}
              multiline
              placeholder="Ek detaylar…"
              placeholderTextColor={colors.inkTertiary}
              testID="manual-notes-input"
            />

            {error && <Text style={styles.error} testID="manual-error">{error}</Text>}
          </View>
        </Sheet>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: spacing.lg + insets.bottom }]}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  headBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.darkSurface,
    alignItems: "center", justifyContent: "center",
  },
  amountWrap: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  currency: { fontSize: 28, color: colors.accentOnDark, fontFamily: fontFamily.bold },
  amountInput: {
    fontSize: 46, lineHeight: 54, fontFamily: fontFamily.bold, color: colors.onDark,
    flex: 1, padding: 0, letterSpacing: -1,
  },
  amountPreview: { ...T.captionSb, color: colors.accentOnDark, marginTop: spacing.xs },
  page: { backgroundColor: colors.bg, flexGrow: 1 },
  form: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm, paddingBottom: spacing.xxl },
  label: { ...overline, marginTop: spacing.md },
  row2: { flexDirection: "row", gap: spacing.md },
  input: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    fontSize: 16, fontFamily: fontFamily.regular, color: colors.ink, minHeight: 52,
  },
  merchantRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  // Seçici bir girdi alanı gibi okunmalı: çevresindeki TextInput'larla aynı
  // kenarlık ve yüzey, ama içindeki satırın kendi dolgusu var.
  splitBox: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    borderRadius: radius.md, marginTop: spacing.md, overflow: "hidden",
  },
  notesInput: { minHeight: 96, textAlignVertical: "top" },
  chipRow: { gap: spacing.sm, alignItems: "center", paddingRight: spacing.lg, paddingVertical: 2 },
  error: { ...T.bodySb, color: colors.negative, marginTop: spacing.md },
  footer: {
    padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border, backgroundColor: colors.surface,
  },
  saveBtn: {
    backgroundColor: colors.brand, borderRadius: radius.pill, minHeight: 54,
    alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6,
  },
  saveTxt: { ...T.emph, color: colors.onBrand },
});
