/** Manuel harcama — no photo. Tarih + market + adet destekli. */
import { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  KeyboardAvoidingView, Platform, ActivityIndicator, Keyboard,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiGet, apiPost } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, Sheet, Chip, MerchantBadge, SplitPicker, splitAll, formatEUR, todayISO,
  CategoryIcon, AnchorMenu, MenuSatir, useSikMarketler, marketIpucu,
  type Split, type MenuTutamak,
  OdesmeUyarisi,
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
  const { members, household } = useHousehold();
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [title, setTitle] = useState("");
  const [merchant, setMerchant] = useState<string>("");
  /** Çipler ve yer tutucu EVİN KENDİ geçmişinden, sabit listeden değil.
   *  Burada on bir Alman zinciri yazılıydı ve bu evin en sık gittiği yer
   *  olan "kasap" listede yoktu; listedeki OBI/IKEA ise hiç geçmiyordu.
   *  Üstelik sabit liste tek ülkeye göre yazılmıştı — Alanya'daki ev için
   *  REWE diye bir şey yok. Geçmiş, çeviri dosyası olmadan yerelleşiyor. */
  const siklar = useSikMarketler(6);
  const [dateInput, setDateInput] = useState(toDDMMYYYY(todayISO()));
  const [category, setCategory] = useState<string>("diger");
  /** Ürünün NE olduğu. Elle girişte de toplanıyor; yoksa bu kayıtlar ürün
   *  listelerinde ham adlarıyla tek tek durur. */
  const [generic, setGeneric] = useState("");
  /** Evin kendi geçmişinden gelen genel ad önerileri. */
  /** Öneriler: genel ad + o adın geçmişteki kategorisi. */
  const [oneriler, setOneriler] = useState<{ name: string; category: string }[]>([]);
  const [katAcik, setKatAcik] = useState(false);
  const [katTutamak, setKatTutamak] = useState<MenuTutamak | null>(null);
  const katRef = useRef<any>(null);
  const [notAcik, setNotAcik] = useState(false);
  /* Başlık yazıldıkça evin geçmişinden genel ad önerisi.
     Ayrı bir uç yazılmadı: `/search` zaten ürünleri genel adıyla döndürüyor
     ve aynı kaynaktan beslenmek iki listenin ayrışmasını imkânsız kılıyor.
     250 ms bekleme, her harfte istek atmamak için. */
  useEffect(() => {
    /* BAŞLIĞIN TAMAMI DEĞİL, İÇİNDEKİ EN UZUN KELİME aranıyor.
       İlk sürüm başlığı olduğu gibi gönderiyordu ve hiç sonuç vermiyordu:
       başlıklar cümle ("Ekim ayı elektrik faturası"), ürün adları ise kelime
       ("süt"). Cümleyi ürün adıyla karşılaştırmak hiçbir zaman tutmuyor. */
    const kelime = title.trim().split(/\s+/)
      .filter((w) => w.length >= 3)
      .sort((a, b) => a.length - b.length)
      .pop();
    if (!kelime || generic) { setOneriler([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await apiGet<{ products: { name: string; category?: string }[] }>(
          `/search?q=${encodeURIComponent(kelime)}`);
        setOneriler((r.products || []).slice(0, 4).map(
          (p) => ({ name: p.name, category: p.category || "diger" })));
      } catch { setOneriler([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [title, generic]);
  const [notes, setNotes] = useState("");
  const [split, setSplit] = useState<Split>({ mode: "equal", with: {} });
  const [saving, setSaving] = useState(false);
  /* Klavye açıkken KAYDET çubuğu gizleniyor — fiş ekranındaki kuralın
     aynısı. Orada "Kaydet" düzenlenen alanın altına gelip "bu düzeltmeyi
     kaydet" gibi okunuyordu; burada da aynı yakınlık aynı yanlış okumayı
     üretiyor. */
  const [klavyeAcik, setKlavyeAcik] = useState(false);
  useEffect(() => {
    const ac = Keyboard.addListener("keyboardDidShow", () => setKlavyeAcik(true));
    const kapa = Keyboard.addListener("keyboardDidHide", () => setKlavyeAcik(false));
    return () => { ac.remove(); kapa.remove(); };
  }, []);
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
      {/* Android'de telafi YOK: `adjustResize` zaten pencereyi yeniden
          boyutlandırıyor, `behavior="height"` aynı işi bir kez daha yapıyor ve
          kenardan kenara çizimde ikisi üst üste binip altta boş bir şerit
          bırakıyordu. Fiş ekranında da aynı sebeple kaldırıldı. */}
      <KeyboardAvoidingView behavior="padding"
                            style={{ flex: 1 }}>
        {/* Başlık kaydırma alanının içinde; alttaki Kaydet çubuğu sabit kalıyor.
            Tutar koyu alanda: ekranın tek büyük rakamı, kart içinde değil. */}
        {/* Klavye payı — gerekçesi `useScrollPad` içinde yazılı. Bu ekran o
            kancayı kullanmıyor (kendi tam ekran düzeni var), pay elle. */}
        <ScrollView style={{ flex: 1 }}
                    contentContainerStyle={styles.page}
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
            {/* Uyarı satırın ALTINDA, tarih alanının içinde değil: iki alanlı
                satırda alanın altına sıkıştırılan bir cümle ötekini de
                aşağı itip hizayı bozardı. */}
            <OdesmeUyarisi tarihISO={fromDDMMYYYY(dateInput)}
                           sonOdesme={household?.last_settlement}
                           testID="manual-odesme-uyari" />

            {/* "(OPSİYONEL)" kalktı: yer tutucu zaten örnek veriyor ve
                zorunlu alanlar kaydetmeye basınca kendini söylüyor. Etiket
                bir uyarı yeri değil bir ad yeri. */}
            <Text style={styles.label}>MARKET</Text>
            <View style={styles.merchantRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={merchant}
                onChangeText={setMerchant}
                placeholder={marketIpucu(siklar)}
                placeholderTextColor={colors.inkTertiary}
                autoCapitalize="characters"
                testID="manual-merchant-input"
              />
              {merchant ? <MerchantBadge name={merchant} /> : null}
            </View>
            {/* Geçmiş boşsa şerit HİÇ çizilmiyor. Yeni bir eve tahmin
                göstermektense boş bırakmak doğru: yanlış çip, yazmaktan
                daha yavaş — insan önce okuyor, sonra yine yazıyor. */}
            {siklar.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                          style={styles.altSerit} contentContainerStyle={styles.chipRow}>
                {siklar.map((m) => (
                  <Chip key={m} label={m} active={merchant === m}
                        onPress={() => setMerchant(merchant === m ? "" : m)}
                        testID={`manual-merchant-${m}`} />
                ))}
              </ScrollView>
            )}

            {/* KATEGORİ + GENEL AD TEK SATIRDA.
                Önce dokuz kategori çipi yan yana duruyordu ve altında ayrı
                bir "BU NE?" alanı vardı — iki etiket, iki blok, ekranın
                üçte biri. İkisi de aynı soruyu farklı kabalıkta soruyor
                ("bu kalem ne"), o yüzden aynı satırda.

                Dokuz seçenek KOMPAKT MENÜ: kural yazılı — kısa liste ve iş
                bir seçimse menü. Çip şeridi seçileni göstermiyordu bile,
                yatayda kayıp gidiyordu. */}
            <View style={styles.kategoriSatir}>
              <Pressable ref={katRef} style={styles.katHap}
                         onPress={() => katRef.current?.measureInWindow?.(
                           (x: number, y: number, w: number, h: number) => {
                             setKatTutamak({ x, y, width: w, height: h });
                             setKatAcik(true);
                           })}
                         testID="manual-cat">
                <CategoryIcon category={category} size={22} />
                <Text style={styles.katTxt}>{CATEGORY_LABEL_TR[category]}</Text>
                <Ionicons name="chevron-down" size={13} color={colors.inkTertiary} />
              </Pressable>
              <Text style={styles.katAyrac}>·</Text>
              <TextInput
                style={styles.genelInput}
                value={generic}
                onChangeText={setGeneric}
                placeholder="bu ne? (süt, sucuk…)"
                placeholderTextColor={colors.inkTertiary}
                autoCapitalize="none"
                testID="manual-generic-input"
              />
            </View>
            <AnchorMenu visible={katAcik} tutamak={katTutamak}
                        onClose={() => setKatAcik(false)} testID="manual-cat-menu">
              {KATEGORILER.map((k) => (
                <MenuSatir key={k} label={CATEGORY_LABEL_TR[k]} secili={category === k}
                           leading={<CategoryIcon category={k} size={22} />}
                           onPress={() => { setCategory(k); setKatAcik(false); }}
                           testID={`manual-cat-${k}`} />
              ))}
            </AnchorMenu>

            {/* Öneriler evin KENDİ geçmişinden (`/search`) — ayrı sözlük yok.
                Amaç yazdırmak değil DOKUNDURMAK: en ucuz yol zaten tutarlı
                olan yol olunca kimseye "tutarlı ol" demeye gerek kalmıyor. */}
            {oneriler.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                          style={styles.altSerit} contentContainerStyle={styles.chipRow}>
                {/* Öneriye dokunmak KATEGORİYİ de dolduruyor.
                    "Yüzey temizlik mendili" daha önce ev ürünleri diye
                    işaretlendiyse aynı soruyu bir daha sormanın anlamı yok —
                    cevabı zaten evin kendi geçmişinde yazılı. Bir dokunuş iki
                    alanı dolduruyor ve tutarlılık kendiliğinden oluşuyor. */}
                {oneriler.map((o) => (
                  <Chip key={o.name} label={o.name}
                        active={generic.toLowerCase() === o.name.toLowerCase()}
                        onPress={() => {
                          setGeneric(o.name.toLowerCase());
                          setCategory(o.category);
                        }}
                        testID={`manual-generic-${o.name}`} />
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

            {/* NOT KATLANDI. Nadiren dolduruluyor ama her açılışta 96
                piksellik boş bir kutu olarak duruyordu — ekranın en büyük
                boşluğu, en az kullanılan alandı. */}
            {!notAcik && !notes ? (
              <Pressable onPress={() => setNotAcik(true)} hitSlop={8}
                         style={styles.notEkle} testID="manual-not-ekle">
                <Ionicons name="add" size={15} color={colors.accentDark} />
                <Text style={styles.notEkleTxt}>Not ekle</Text>
              </Pressable>
            ) : (
            <>
            <Text style={styles.label}>NOT</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={notes}
              onChangeText={setNotes}
              multiline
              placeholder="Ek detaylar…"
              placeholderTextColor={colors.inkTertiary}
              testID="manual-notes-input"
            />
            </>
            )}

            {error && <Text style={styles.error} testID="manual-error">{error}</Text>}
          </View>
        </Sheet>
        </ScrollView>

        {!klavyeAcik && (
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
        )}
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
  /* TEK RİTİM.
     Önce `form` bütün çocuklara 8 piksel boşluk veriyordu, `label` üstüne
     ayrıca 12 ekliyordu ve çip şeritleriyle seçici kutunun kendi
     `marginTop`ları vardı. Sonuç: alan araları 8 ile 20 arasında gidip
     geliyordu ve göz bunu "hizasız" diye okuyordu.

     Kural artık iki sayı: alan grupları arası 16, etiket ile kendi
     kontrolü arası 4. Aradaki her şey bu ikisinden birini kullanıyor. */
  /* BOŞLUKLARIN TEK KAYNAĞI GRUP BAŞLARI.
     Formda `gap` yok ve bu bilerek: bir grup "etiket + girdi + (şerit)"
     üçlüsü, yani gap grup İÇİNE de boşluk koyardı. Gruplar arası mesafeyi
     grubun ilk öğesi taşıyor — etiketi olan grupta `label`, etiketi olmayan
     grupta (kategori satırı, not düğmesi) kendi `marginTop`'u.

     `paddingTop` KALDIRILDI: ilk etiketin `marginTop`'u zaten var, ikisi
     üst üste binince ilk alan ötekilerden daha aşağıda başlıyordu ve
     "boşluklar düzensiz" hissini üreten şey buydu. */
  form: { padding: spacing.lg, paddingTop: 0, gap: 0, paddingBottom: spacing.xxl },
  label: { ...overline, marginTop: spacing.lg, marginBottom: spacing.xs },
  row2: { flexDirection: "row", gap: spacing.md },
  /* Girdiye AİT olan şerit: gruplar arası değil, grup içi boşluk. */
  altSerit: { marginTop: spacing.xs },
  input: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    fontSize: 16, fontFamily: fontFamily.regular, color: colors.ink, minHeight: 52,
  },
  merchantRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  /* Kategori + genel ad tek satır: ikisi de "bu kalem ne" sorusunun cevabı. */
  kategoriSatir: {
    marginTop: spacing.lg,
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 52,
  },
  katHap: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: spacing.md },
  katTxt: { ...T.body, color: colors.ink },
  katAyrac: { ...T.body, color: colors.onSurfaceTertiary },
  genelInput: {
    flex: 1, ...T.body, color: colors.ink, padding: 0, minWidth: 60,
  },
  notEkle: {
    flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start",
    /* Grup başı, grup içi değil: ötekilerle aynı mesafede dursun. */
    minHeight: 44, marginTop: spacing.lg,
  },
  notEkleTxt: { ...T.bodySb, color: colors.accentDark },
  // Seçici bir girdi alanı gibi okunmalı: çevresindeki TextInput'larla aynı
  // kenarlık ve yüzey, ama içindeki satırın kendi dolgusu var.
  splitBox: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    borderRadius: radius.md, marginTop: spacing.lg, overflow: "hidden",
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
