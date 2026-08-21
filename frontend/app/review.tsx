/** Fiş İnceleme — OCR sonucunu düzenle (ad, adet, fiyat, kategori), kalem
 *  bazlı ya da toplu bölüşüm, tarih + market.
 *
 *  Kalem bazlı bölüşüm fişin doğasından geliyor: aynı fişte domates herkese,
 *  yumurta iki kişiye ait olabilir. Aynı kişilerin bölüştüğü kalemler
 *  kaydederken tek harcamada toplanıyor. */
import { useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Keyboard,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, apiGet, apiPost } from "@/src/api";
import { popNext, remaining, totalCount, currentIndex, clearQueue } from "@/src/pendingReviews";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import {
  CategoryPicker, CategoryIcon, MerchantBadge, ScreenHeader, formatEUR, formatDateTR,
  todayISO, nextUnit, UnitPicker, HintCard, SplitPicker, splitAll, splitSummary,
  BottomSheet, Divider, type Split,
  useSikMarketler, marketIpucu,
  OdesmeUyarisi,
} from "@/src/ui";
import {
  colors, spacing, radius, type as T, overline, fontFamily, CATEGORY_ICONS, CATEGORY_LABEL_TR,
  marketKisaAd,
} from "@/src/theme";

/** `generic`: fişteki ad ile ürünün NE olduğu farklı şeyler — fiş
 *  "Gelbwurzel 1kg" yazar, satılan şey havuçtur. Modelden geliyor ve
 *  DEĞİŞTİRİLMİYOR, yalnızca taşınıyor: kullanıcı adı düzeltirse bile
 *  ürünün ne olduğu değişmiyor.
 *
 *  Bu alan kayda kadar taşınmadığı için Tur 8'den beri sessizce
 *  kayboluyordu (206 kalemin hiçbirinde yoktu) ve ürün istatistiği marka
 *  adlarını birleştiremiyordu. */
type Row = {
  name: string; price: string; quantity: string; unit: string;
  category: string; generic?: string | null; split: Split;
};

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
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { members, household } = useHousehold();
  const meId = user?.user_id || "";
  /** Acik olan kalem. Tek satir acik kalir: iki kalem birden duzenlenmiyor. */
  /* Market yer tutucusu evin kendi geçmişinden; sabit "REWE, EDEKA"
     başka bir ülkedeki evde anlamsız kalıyordu. */
  const sikMarketler = useSikMarketler(2);
  const [acikSatir, setAcikSatir] = useState<number | null>(null);

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
      quantity: String(it.quantity ?? 1).replace(".", ","),
      unit: it.unit || "adet",
      category: it.category || "diger",
      // Modelden geliyor, ekranda gösterilmiyor, kayda taşınıyor.
      generic: it.generic || null,
      split: { mode: "equal" as const, with: {} },
    }))
  );
  const [bulkSplit, setBulkSplit] = useState<Split>({ mode: "equal", with: {} });
  /** Son silinen kalem ve YERİ — geri alma şeridi bundan besleniyor. */
  const [silinen, setSilinen] = useState<{ satir: Row; index: number } | null>(null);
  /** Hangi satırın genel adı düzenleniyor. Aynı anda tek satır. */
  const [genelDuzenle, setGenelDuzenle] = useState<number | null>(null);

  /**
   * Klavye açıkken KAYDET ÇUBUĞU GİZLENİYOR.
   *
   * Cihazda şu yaşandı: genel ad alanı düzenlenirken klavye açıldı, "Kaydet"
   * çubuğu düzenlenen alanın hemen altına geldi ve **"bu düzeltmeyi kaydet"**
   * gibi okundu. Oysa o düğme fişin tamamını kaydedip ekrandan çıkarıyor.
   *
   * Yakınlık bir anlam üretir: iki şey yan yana duruyorsa insan onları
   * ilişkili sanar. Buradaki yakınlık tesadüftü — klavye itmişti — ama okuma
   * gerçekti. Yazarken çubuğu hiç göstermemek, hem yanlış okumayı hem de
   * listeden çalınan yeri ortadan kaldırıyor.
   */
  const [klavyeAcik, setKlavyeAcik] = useState(false);
  useEffect(() => {
    const ac = Keyboard.addListener("keyboardDidShow", () => setKlavyeAcik(true));
    const kapa = Keyboard.addListener("keyboardDidHide", () => setKlavyeAcik(false));
    return () => { ac.remove(); kapa.remove(); };
  }, []);

  // Ev bilgisi fiş okunurken hâlâ iniyor olabiliyor, kalemler ise OCR yanıtı
  // gelir gelmez kuruluyor. Varsayılan "tüm ev" bölüşümü üyeler geldiğinde
  // yalnızca henüz seçim yapılmamış kalemlere yazılıyor.
  useEffect(() => {
    if (!members.length) return;
    const all = splitAll(members);
    setBulkSplit((b) => (Object.keys(b.with).length ? b : all));
    setRows((rs) => rs.map((r) => (Object.keys(r.split.with).length ? r : { ...r, split: all })));
  }, [members]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedPrice = (p: string) => parseFloat(p.replace(",", ".")) || 0;
  const parsedQty = (q: string) => parseFloat(q.replace(",", ".")) || 1;
  const rowTotal = (r: Row) => parsedPrice(r.price) * parsedQty(r.quantity);
  const total = rows.reduce((s, r) => s + rowTotal(r), 0);

  const updateRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  /**
   * Kalem silme — GERİ ALINABİLİR.
   *
   * Çarpı, adı düzenlerken parmağın hemen yanında duruyor ve yanlışlıkla
   * basılıyor. Bedeli orantısız: gitmiş kalemi geri koymak ya fişi yeniden
   * taramayı ya da ad/adet/fiyat/birim/kategori/genel ad'ın hepsini elle
   * yazmayı gerektiriyordu.
   *
   * Çözüm ONAY SORMAK DEĞİL: silme çoğu zaman bilinçli (fişteki depozito
   * satırı, poşet). Her silmede "emin misin?" sormak doğru işi cezalandırır.
   * Geri alma ise yalnızca hata yapana bedel ödetiyor — ve o bedel bir
   * dokunuş.
   *
   * Satır ESKİ YERİNE dönüyor: sona eklemek "hangisiydi" sorusunu doğurur,
   * uzun fişte kaybolur.
   */
  const removeRow = (i: number) => {
    const satir = rows[i];
    setRows((rs) => rs.filter((_, idx) => idx !== i));
    setAcikSatir(null);
    if (satir) setSilinen({ satir, index: i });
  };

  useEffect(() => {
    if (!silinen) return;
    const t = setTimeout(() => setSilinen(null), 8000);
    return () => clearTimeout(t);
  }, [silinen]);

  const geriAl = () => {
    if (!silinen) return;
    const { satir, index } = silinen;
    setRows((rs) => [...rs.slice(0, index), satir, ...rs.slice(index)]);
    setSilinen(null);
  };
  const addRow = () =>
    // Elle eklenen kalemde genel ad YOK: modelin bilgisi değil kullanıcının
    // yazdığı ad var, ve uydurmak yanlış birleştirmeye yol açar.
    setRows((rs) => [...rs, { name: "", price: "0,00", quantity: "1", unit: "adet", category: "diger", generic: null, split: bulkSplit }]);

  const applyBulk = (sp: Split) => {
    setBulkSplit(sp);
    setRows((rs) => rs.map((r) => ({ ...r, split: sp })));
  };

  // Aynı fiş daha önce kaydedilmiş mi? Galeriden aynı fişin iki fotoğrafı
  // seçilebiliyor ve dosya karşılaştırması bunu yakalayamıyor — iki ayrı
  // fotoğraf. Market, tarih ve toplam üçlüsüne bakıyoruz. Engellemiyoruz:
  // aynı gün aynı marketten aynı tutarda iki alışveriş gerçekten olur.
  const [dupe, setDupe] = useState<any | null>(null);
  const [dupeDismissed, setDupeDismissed] = useState(false);
  useEffect(() => {
    const iso = fromDDMMYYYY(dateInput);
    if (!iso || total <= 0) { setDupe(null); return; }
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const q = new URLSearchParams({ total: String(total), expense_date: iso });
        if (merchant.trim()) q.set("merchant", merchant.trim());
        const res = await apiGet<{ duplicates: any[] }>(`/expenses/duplicate-check?${q}`);
        if (alive) setDupe((res.duplicates || [])[0] || null);
      } catch { /* uyarı isteğe bağlı; başarısız olursa sessiz kal */ }
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
  }, [total, dateInput, merchant]);

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

  /**
   * Alinacaklar koprusu — Tur 8'in GENEL URUN ADI isinin uzerine kuruluyor.
   *
   * Fiste `SAHNE 200G` yaziyor, listede `Krema`; ikisi de ayni anahtara
   * dusuyor ve market donusu listeyi elle temizlemek gerekmiyor. Rakiplerin
   * hicbiri bunu yapamaz cunku hicbiri fisi kalem kalem okumuyor.
   *
   * Sunucu yalnizca ONERIYOR; isaretleme burada, kullanicinin onayiyla
   * oluyor. Liste PAYLASILAN bir sey -- ev arkadasinin yazdigi maddeyi haber
   * vermeden silmek uygulamanin en cok guven kaybedecegi yer olurdu.
   */
  type Eslesme = {
    item_id: string; text: string; receipt_name: string; sure: boolean;
    /** Ev listesi mi kendi listen mi. Sunucu artik ikisine de bakiyor;
     *  hangisini dusurdugunu bilmeden onaylamak dogru olmaz. */
    scope?: "household" | "self";
  };
  const [kopru, setKopru] = useState<Eslesme[] | null>(null);
  const [secili, setSecili] = useState<Record<string, boolean>>({});

  const bulEslesme = async (): Promise<Eslesme[]> => {
    try {
      /* Ham ad ile GENEL AD birlikte gidiyor, aynı sırada.
         Eşleştirmenin çoğunu artık genel ad yapıyor: listede "arpa şehriye
         2 tane" yazıyor, fişte "ANKARA ARPA SEHRIYE" — iki ham ad birbirini
         tutmuyor ama kalemin genel adı "şehriye" ve listedeki metnin içinde
         tam kelime olarak geçiyor. */
      const dolu = rows.filter((r) => r.name.trim());
      const adlar = dolu.map((r) => r.name.trim());
      const genels = dolu.map((r) => (r.generic || "").trim() || null);
      if (!adlar.length) return [];
      // Fişin ÜSTÜNDEKİ tarih gidiyor: fişten eski olmayan maddeler
      // eşleşebilir. Bir hafta önceki fişi bugün taratınca dün yazılmış
      // "Süt" aday çıkıyordu — o sütü almadın, madde daha ortada yoktu.
      const res = await apiPost<{ matches: Eslesme[] }>("/shopping/match", {
        names: adlar, generics: genels,
        expense_date: fromDDMMYYYY(dateInput) || todayISO(),
      });
      const m = res.matches || [];
      // Emin olunmayan eslesme ISARETSIZ geliyor: yanlis dusurmek,
      // dusurmemekten pahali.
      setSecili(Object.fromEntries(m.map((x) => [x.item_id, x.sure])));
      return m;
    } catch { return []; }
  };

  const dusur = async () => {
    const secilenler = (kopru || []).filter((m) => secili[m.item_id]);
    await Promise.all(secilenler.map((m) =>
      api(`/shopping/${m.item_id}`, { method: "PATCH", body: JSON.stringify({ done: true }) })
        .catch(() => {})));
    setKopru(null);
    goToNextOrExit();
  };

  /**
   * Sarı bant tek başına yetmiyor — kaydırıp geçilebiliyor. Kesme anı burası:
   * uyarı pasif kalsın, ama geri dönüşü olan son noktada bir kez sorulsun.
   * Engellemek değil, "gerçekten mi" demek.
   */
  const save = () => {
    if (dupe && !dupeDismissed) {
      Alert.alert(
        "Bu fiş zaten kayıtlı olabilir",
        `${marketKisaAd(dupe.merchant) || "Market yok"} · ${formatDateTR(dupe.expense_date)} · ${formatEUR(dupe.total)}\n\n` +
        "Aynı gün aynı marketten iki alışveriş olabilir. Yine de kaydedilsin mi?",
        [
          { text: "Vazgeç", style: "cancel" },
          { text: "Yine de kaydet", style: "destructive",
            onPress: () => { setDupeDismissed(true); doSave(); } },
        ],
      );
      return;
    }
    doSave();
  };

  const doSave = async () => {
    setError(null);
    const valid = rows.filter((r) => r.name.trim() && parsedPrice(r.price) > 0);
    if (valid.length === 0) { setError("Kaydedilecek geçerli kalem yok"); return; }
    const iso = fromDDMMYYYY(dateInput);
    if (!iso) { setError("Tarih formatı: GG.AA.YYYY"); return; }

    setSaving(true);
    try {
      // Ayni kisilerin bolustugu kalemler tek harcamada toplaniyor: fisteki
      // domates ile sut "ev", yumurta ise "sen + Salih" olunca iki kayit
      // cikiyor. Anahtar SIRALI kimlik listesi -- secim sirasi kayda gecmemeli,
      // yoksa ayni iki kisi iki ayri harcama uretir.
      const groups: Record<string, Row[]> = {};
      for (const r of valid) {
        const key = Object.keys(r.split.with).sort().join(",");
        (groups[key] ||= []).push(r);
      }
      for (const [key, group] of Object.entries(groups)) {
        if (!key) { setError("Bölüşülecek kişi seçilmemiş bir kalem var"); return; }
        const groupTotal = group.reduce((s, r) => s + rowTotal(r), 0);
        await apiPost("/expenses", {
          split_mode: "equal",
          split_with: Object.fromEntries(key.split(",").map((id) => [id, 1])),
          items: group.map((g) => ({
            name: g.name.trim(),
            price: parsedPrice(g.price),
            quantity: parsedQty(g.quantity),
            unit: g.unit,
            category: g.category,
            // Modelin ürün bilgisi kayda kadar taşınıyor: "En Çok
            // Aldıklarımız" üç marketin kendi markasını bununla birleştiriyor.
            generic: g.generic || null,
          })),
          total: groupTotal,
          source: "receipt",
          merchant: merchant.trim() || null,
          expense_date: iso,
        });
      }
      // Fis kaydedildi. Simdi alinacaklar listesiyle eslesen var mi?
      // Eslesme YOKSA hiçbir sey gorunmuyor -- kesintisiz devam ediyor.
      const eslesme = await bulEslesme();
      if (eslesme.length) { setKopru(eslesme); return; }
      goToNextOrExit();
    } catch (e: any) { setError(e.message || "Kaydetme başarısız"); }
    finally { setSaving(false); }
  };

  /** Fis kaleminde "Tutar gir" kapali: kalemin fiyati zaten belli,
   *  sorulan tek sey kimlerin bolustugu. */
  const renderSplit = (
    value: Split, onChange: (s: Split) => void, label: string, amount: number, keyPrefix: string,
  ) => (
    <View style={styles.splitBox}>
      <SplitPicker
        label={label}
        value={value}
        onChange={onChange}
        members={members}
        meId={user?.user_id}
        total={amount}
        allowExact={false}
        testID={`${keyPrefix}-split`}
      />
    </View>
  );

  return (
    <View style={styles.root} testID="review-screen">
      {/* Android'de KAYDIRMA TELAFİSİ YOK ve bu bilerek.
          `behavior="height"` pencereyi kendi yeniden ölçüyor; Android zaten
          `adjustResize` ile aynı işi yapıyor ve kenardan kenara çizimde ikisi
          üst üste binip alt tarafta boş bir şerit bırakıyordu — ekranın altı
          Kaydet düğmesinden sonra kocaman boş kalıyordu.

          Telafiye artık ihtiyaç da yok: klavye açılınca Kaydet çubuğu zaten
          gizleniyor, geriye kalan tek iş odaklanılan alanı görünür tutmak ve
          onu `ScrollView` kendisi yapıyor. */}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}
                            style={{ flex: 1 }}>
        {/* Başlık kaydırma alanının içinde; alttaki Kaydet çubuğu sabit kalıyor. */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.page}
                    keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Sag ustteki rozet kaldirildi: ayni bilgi baslikta ("Fis 1 / 2") ve
            altindaki ilerleme cizgilerinde zaten iki kez duruyordu. */}
        <ScreenHeader>
          <View style={styles.headRow}>
            <Pressable onPress={() => router.back()} testID="review-back-btn" hitSlop={14}
                       style={styles.backBtn}>
              <Ionicons name="chevron-back" size={20} color={colors.onDark} />
            </Pressable>
            {/* Kaç fişten kaçıncısındasınız — köşedeki küçük rozet tek başına
                fark edilmiyordu, oysa sıradaki fişin geleceğini bilmek
                "Kaydet"e mi "Kaydet & Sonraki"ye mi bastığınızı belirliyor. */}
            <Text style={styles.headTitle}>
              {batchN > 1 ? `Fiş ${batchI || 1} / ${batchN}` : "Fişi incele"}
            </Text>
          </View>
          <Text style={styles.headMeta}>
            {merchant || "Market yok"} · {formatDateTR(fromDDMMYYYY(dateInput) || todayISO())}
          </Text>
          <Text style={styles.headTotal}>{formatEUR(total)}</Text>
          <Text style={styles.headHint}>{rows.length} kalem · fiyat, miktar ve kategoriyi düzenleyebilirsin</Text>
          {batchN > 1 && (
            <View style={styles.batchBar} testID="batch-progress-bar">
              {Array.from({ length: batchN }).map((_, i) => (
                <View key={i} style={[styles.batchDot, i < (batchI || 1) && styles.batchDotDone]} />
              ))}
            </View>
          )}
        </ScreenHeader>

        <View style={styles.list}>
          <HintCard hintKey="review-tap" testID="review-hint">
            Kategori simgesine ve <Text style={{ fontFamily: fontFamily.semibold }}>ADET</Text> etiketine
            dokunarak değiştirebilirsin.
          </HintCard>
          {dupe && !dupeDismissed && (
            <View style={styles.dupeBox} testID="duplicate-warning">
              <Ionicons name="copy-outline" size={18} color={colors.onWarning} />
              <View style={{ flex: 1 }}>
                <Text style={styles.dupeTitle}>Bu fiş zaten kayıtlı olabilir</Text>
                <Text style={styles.dupeTxt}>
                  {marketKisaAd(dupe.merchant) || "Market yok"} · {formatDateTR(dupe.expense_date)} · {formatEUR(dupe.total)}
                </Text>
              </View>
              <Pressable onPress={() => setDupeDismissed(true)} hitSlop={10} testID="dismiss-duplicate">
                <Text style={styles.dupeDismiss}>Yine de kaydet</Text>
              </Pressable>
            </View>
          )}
          <View style={styles.metaCard}>
            <View style={styles.metaField}>
              <View style={styles.metaLabelRow}>
                <Ionicons name="storefront-outline" size={14} color={colors.inkSecondary} />
                <Text style={styles.metaLabel}>Market</Text>
              </View>
              <View style={styles.metaInputRow}>
                <TextInput
                  style={styles.metaInput}
                  value={merchant}
                  onChangeText={setMerchant}
                  placeholder={marketIpucu(sikMarketler)}
                  placeholderTextColor={colors.onSurfaceTertiary}
                  testID="review-merchant-input"
                />
                {merchant ? <MerchantBadge name={merchant} /> : null}
              </View>
            </View>
            <View style={styles.metaField}>
              <View style={styles.metaLabelRow}>
                <Ionicons name="calendar-outline" size={14} color={colors.inkSecondary} />
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
          <OdesmeUyarisi tarihISO={fromDDMMYYYY(dateInput)}
                         sonOdesme={household?.last_settlement}
                         testID="review-odesme-uyari" />

          {/* TÜMÜNE UYGULA — çerçeveli 64 piksellik kutudan tek satıra indi.
              Ölçüldü: blok 64 piksel, kalem satırı 52; bir kez ayarlanan
              kontrol on beş kez okunan satırdan uzundu. Asıl mesele yükseklik
              değil AĞIRLIK: tam genişlikte çerçeveli bir kutu "benimle
              ilgilen" diye okunuyor, oysa çoğu fişte varsayılan zaten doğru.

              Küçültmenin doğru anı da bu: satır başına bölüşüm ucuzlayınca
              bu kontrol "tek hızlı yol" olmaktan çıktı. Öncesinde küçültmek,
              yerine geçecek şey daha yokken hızlı yolu zayıflatmak olurdu. */}
          <View style={styles.bulkWrap}>
            <SplitPicker
              value={bulkSplit}
              onChange={applyBulk}
              members={members}
              meId={meId}
              total={total}
              allowExact={false}
              kompakt
              testID="bulk-split"
              renderTrigger={(ac, ozet, ref) => (
                <Pressable ref={ref} style={styles.bulkRow} onPress={ac} testID="bulk-split">
                  <Text style={styles.bulkLabel}>TÜMÜ</Text>
                  <View style={styles.bulkHap}>
                    <Ionicons name="home" size={13} color={colors.inkSecondary} />
                    <Text style={styles.bulkTxt} numberOfLines={1}>{ozet}</Text>
                    <Ionicons name="chevron-down" size={12} color={colors.inkTertiary} />
                  </View>
                </Pressable>
              )}
            />
          </View>

          {rows.length === 0 && (
            <View style={styles.empty} testID="review-empty">
              <Ionicons name="search-outline" size={40} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyTitle}>Kalem bulunamadı</Text>
              <Text style={styles.emptyDesc}>Manuel olarak ekleyebilirsin.</Text>
            </View>
          )}

          {/* Kalemler AYRI KART degil, tek kabin icinde satir.
              `ui.tsx`in kendi kurali bunu zaten soyluyordu ("liste satirlari
              ayri ayri kartlara konmaz") ama bu ekran onu ciğniyordu: 15
              kalemli bir fiste 15 kart, ~2850 piksel. Simdi kapali satir
              ~48 piksel ve cogu kalemde zaten duzeltilecek bir sey yok --
              tarama dogru okuduysa bakip geciliyor. */}
          <View style={styles.itemsWrap}>
          {rows.map((r, i) => {
            const acik = acikSatir === i;
            if (!acik) {
              // Bolusum yalnizca TOPLU ayardan farkliysa yaziliyor: ustte
              // zaten "Tumune uygula" duruyor, her kalemde tekrarlamak
              // kullanicinin bildigini yeniden anlatmak olurdu.
              const farkli = splitSummary(r.split, members, meId)
                !== splitSummary(bulkSplit, members, meId);
              /* SATIRIN KENDİSİ BÖLÜŞÜMÜ AÇIYOR; düzenleme kenardaki
                 düğmede.
                 Ev sahibinin gözlemi: "biz genellikle o satıra tıklamamızın
                 sebebi bölüşüm." Veri de öyle diyor. Öyleyse satırın asıl
                 dokunuşu zaten o olmalı; ad/adet/fiyat düzeltmek nadir ve
                 kendi düğmesini hak ediyor.

                 Önce satırın içine küçük bir "bölüşüm hapı" konması
                 düşünüldü ve ARİTMETİK ELEDİ: Apple 44 punto, Google 48 dp
                 dokunma alanı istiyor; 22 piksellik bir hapı 44'e büyütmek
                 üstündeki ürün adının satırını yutuyordu. Yanlış dokunma
                 çözülmüyor, yön değiştiriyordu.

                 Şimdi iki hedef KOMŞU DEĞİL: biri satırın tamamı, diğeri
                 sağ kenarda 46 piksellik şerit. Başparmak satıra basarken
                 ortaya düşer; kenar kasıtlı bir hareket ister.

                 Ok değil KALEM: aşağı bakan ok "bu satır açılır" demek ve
                 satır artık açılmıyor. Kalem başka bir söz veriyor ve o söz
                 tutuluyor. */
              return (
                <View key={i} style={[styles.satirKap, i > 0 && styles.satirCizgi]}>
                  <SplitPicker
                    value={r.split}
                    onChange={(sp) => updateRow(i, { split: sp })}
                    members={members}
                    meId={meId}
                    total={rowTotal(r)}
                    allowExact={false}
                    kompakt
                    testID={`item-${i}-split`}
                    renderTrigger={(ac, ozet, ref) => (
                      <Pressable ref={ref} style={styles.satir} onPress={ac}
                                 android_ripple={{ color: colors.divider }}
                                 testID={`review-item-${i}`}>
                        <CategoryIcon category={r.category} size={30} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.satirAd} numberOfLines={1}>
                            {r.name || "Adsız kalem"}
                          </Text>
                          {/* Bölüşüm HER satırda yazıyor ama istisna olanlar
                              vurgulu. Hap artık satırın asıl eylemi olduğu
                              için her satırda bulunmak zorunda; "bir kez
                              söyle" düzeni ise vurguyla korunuyor — göz
                              yeşilleri tarıyor. */}
                          <View style={[styles.bolusumHap, farkli && styles.bolusumHapVar]}>
                            <Ionicons name={farkli ? "person" : "home"} size={11}
                                      color={farkli ? colors.accentDark : colors.inkTertiary} />
                            <Text style={[styles.bolusumTxt, farkli && styles.bolusumTxtVar]}
                                  numberOfLines={1}>
                              {ozet}
                            </Text>
                            <Ionicons name="chevron-down" size={10}
                                      color={farkli ? colors.accentDark : colors.inkTertiary} />
                          </View>
                        </View>
                        <Text style={styles.satirTutar}>{formatEUR(rowTotal(r))}</Text>
                      </Pressable>
                    )}
                  />
                  <Pressable style={styles.duzenleBtn} onPress={() => setAcikSatir(i)}
                             testID={`review-item-${i}-edit`}>
                    <View style={styles.duzenleKutu}>
                      <Ionicons name="pencil" size={14} color={colors.inkSecondary} />
                    </View>
                  </Pressable>
                </View>
              );
            }
            return (
              <View key={i} style={[styles.itemCard, i > 0 && styles.satirCizgi]}
                    testID={`review-item-${i}`}>
                <View style={styles.itemHeader}>
                  <CategoryPicker
                    category={r.category} size={36}
                    onPress={() => updateRow(i, { category: nextCategory(r.category) })}
                    testID={`review-item-${i}-category`}
                  />
                  <TextInput
                    style={styles.nameInput}
                    value={r.name}
                    onChangeText={(t) => updateRow(i, { name: t })}
                    placeholder="Ürün adı"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    testID={`review-item-${i}-name`}
                  />
                  {/* AYNI YER, TERS İŞLEM.
                      Burada `close-circle` duruyordu ve SİLME demekti. Kapalı
                      satırda tam aynı noktada kalem düğmesi var; kullanıcı
                      kalemle açtığı satırı aynı yere basarak kapatmayı
                      bekliyor ve bunun yerine kalemi siliyordu. Bu bir zevk
                      meselesi değil: aynı konumda, biri yıkıcı iki farklı
                      eylem. Silme aşağıya, ADIYLA birlikte indi. */}
                  <Pressable onPress={() => setAcikSatir(null)} style={styles.duzenleBtn}
                             testID={`review-item-${i}-collapse`}>
                    <View style={styles.duzenleKutu}>
                      <Ionicons name="chevron-up" size={15} color={colors.inkSecondary} />
                    </View>
                  </Pressable>
                </View>
                <View style={styles.itemBody}>
                  <View style={styles.qtyBox}>
                    <View style={styles.labelRow}>
                      <UnitPicker unit={r.unit}
                                  onPress={() => updateRow(i, { unit: nextUnit(r.unit) })}
                                  testID={`review-item-${i}-unit`} />
                    </View>
                    <TextInput
                      style={styles.qtyInput}
                      value={r.quantity}
                      onChangeText={(t) => updateRow(i, { quantity: t.replace(/[^\d.,]/g, "") })}
                      keyboardType="decimal-pad"
                      testID={`review-item-${i}-quantity`}
                    />
                  </View>
                  <View style={styles.priceBox}>
                    <View style={styles.labelRow}>
                      <Text style={styles.subLabel} numberOfLines={1}>FİYAT</Text>
                    </View>
                    <TextInput
                      style={styles.priceInput}
                      value={r.price}
                      onChangeText={(t) => updateRow(i, { price: t.replace(/[^\d.,]/g, "") })}
                      keyboardType="decimal-pad"
                      testID={`review-item-${i}-price`}
                    />
                  </View>
                  <View style={styles.totalBox}>
                    <View style={styles.labelRow}>
                      <Text style={styles.subLabel} numberOfLines={1}>TOPLAM</Text>
                    </View>
                    <Text style={styles.rowTotal}>{formatEUR(rowTotal(r))}</Text>
                  </View>
                </View>
                {/* KATEGORİ · GENEL AD — tek satır, ikisi de küçük.
                    Genel ad ilk denemede kendi kutusunda, "BU ÜRÜN ASLINDA
                    NE?" başlığıyla duruyordu ve fazla yer kaplıyordu. Ev
                    sahibinin itirazı doğruydu: Türkiye'de fişte zaten "Dost
                    1 lt Süt" yazıyor, kimse onun süt olduğunu merak etmiyor.
                    Alan yalnızca Almanya'daki gibi fişte markadan başka bir
                    şey yazmadığında düzeltiliyor — yani çok nadiren.

                    Ama GÖRÜNÜR kalması şart: arka planda toplanmaya devam
                    ediyor ve ürün gruplamasının tamamı buna dayanıyor.
                    Görünmezse yanlışı da fark edilmez. Çözüm: kategorinin
                    yanında aynı puntoda, dokunulunca düzeltilebilir. */}
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
                      placeholderTextColor={colors.onSurfaceTertiary}
                      autoCapitalize="none"
                      autoFocus
                      returnKeyType="done"
                      testID={`review-item-${i}-generic`}
                    />
                  ) : (
                    <Pressable onPress={() => setGenelDuzenle(i)} hitSlop={8}
                               testID={`review-item-${i}-generic-edit`}>
                      <Text style={[styles.genelTxt, !r.generic && styles.genelBos]}>
                        {r.generic || "genel ad yok"}
                      </Text>
                    </Pressable>
                  )}
                </View>
                {renderSplit(r.split, (sp) => updateRow(i, { split: sp }), "BÖLÜŞÜM", rowTotal(r), `item-${i}`)}
                {/* Silme artık ADIYLA duruyor ve kırmızı. Simge tek başına
                    yıkıcı bir eylemi taşıyamaz — ne yaptığını yazması gerekir.
                    Geri alma şeridi yine devrede, yani yanlışlıkla basılırsa
                    bedeli tek dokunuş. */}
                <View style={styles.altEylemler}>
                  <Pressable onPress={() => removeRow(i)} style={styles.silBtn}
                             testID={`review-item-${i}-delete`} hitSlop={6}>
                    <Ionicons name="trash-outline" size={15} color={colors.negative} />
                    <Text style={styles.silTxt}>Kalemi sil</Text>
                  </Pressable>
                  <Pressable onPress={() => setAcikSatir(null)} style={styles.kapatSatir}
                             testID={`review-item-${i}-close`} hitSlop={6}>
                    <Ionicons name="chevron-up" size={15} color={colors.inkSecondary} />
                    <Text style={styles.kapatTxt}>Kapat</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
          </View>
          <Pressable style={styles.addBtn} onPress={addRow} testID="review-add-item">
            <Ionicons name="add-circle-outline" size={20} color={colors.inkSecondary} />
            <Text style={styles.addTxt}>Kalem ekle</Text>
          </Pressable>
        </View>
        </ScrollView>

        {/* GERİ ALMA ŞERİDİ — kaydet çubuğunun hemen üstünde.
            Kalıcı değil: sekiz saniye durup kayboluyor. Kalıcı olsaydı
            bilerek silen kişi onu her seferinde kapatmak zorunda kalırdı,
            yani doğru işi yapan cezalandırılırdı. */}
        {silinen && (
          <View style={styles.geriSerit} testID="review-undo">
            <Ionicons name="trash-outline" size={16} color={colors.onDarkMuted} />
            <Text style={styles.geriTxt} numberOfLines={1}>
              {silinen.satir.name || "Kalem"} silindi
            </Text>
            <Pressable onPress={geriAl} hitSlop={10} testID="review-undo-btn">
              <Text style={styles.geriBtn}>Geri al</Text>
            </Pressable>
          </View>
        )}

        {/* Alt cubuk telefonun gezinme cubugunun altinda kaliyordu: kenardan
            kenara cizim acik oldugu icin guvenli alan payini elle eklemek sart. */}
        {!klavyeAcik && (
        <View style={[styles.footer, { paddingBottom: spacing.lg + insets.bottom }]}>
          {error && <Text style={styles.error} testID="review-error">{error}</Text>}
          {/* Toplam buradan kaldırıldı: başlıkta zaten kocaman duruyor.
              İki düğmeyle aynı satırı paylaşınca sıkışıp okunmaz hale
              geliyordu ve tekrar etmesinin bir faydası yoktu. */}
          <View style={styles.footerRow}>
            {batchN > 1 && (
              <Pressable style={styles.skipBtn} onPress={skipReceipt} testID="review-skip-btn">
                <Ionicons name="play-forward" size={15} color={colors.inkSecondary} />
                <Text style={styles.skipTxt}>Atla</Text>
              </Pressable>
            )}
            <Pressable style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save}
                       disabled={saving} testID="review-save-btn">
              {saving ? <ActivityIndicator color={colors.onBrand} /> : (
                <>
                  <Ionicons name={hasMore ? "arrow-forward" : "checkmark"} size={18} color={colors.onBrand} />
                  <Text style={styles.saveTxt} numberOfLines={1}>
                    {hasMore ? "Kaydet & Sonraki" : "Kaydet"}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
        )}
      </KeyboardAvoidingView>

      {/* Fis kaydedildikten SONRA aciliyor: kaydetmeden once kalemler hala
          degisebilir. Eslesme yoksa hic gorunmuyor. */}
      <BottomSheet visible={!!kopru} onClose={() => { setKopru(null); goToNextOrExit(); }}
                   testID="kopru-sheet">
        <View style={styles.kopruBas}>
          <View style={styles.kopruIkon}>
            <Ionicons name="cart" size={18} color={colors.accentDark} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.kopruTitle}>Listeden düşürelim mi?</Text>
            <Text style={styles.kopruDesc}>
              Fişte {kopru?.length} ürün listede de vardı
            </Text>
          </View>
        </View>

        {(kopru || []).map((m, i) => {
          const on = !!secili[m.item_id];
          return (
            <View key={m.item_id}>
              {i > 0 && <Divider inset={52} />}
              <Pressable style={styles.kopruRow}
                         onPress={() => setSecili((s) => ({ ...s, [m.item_id]: !on }))}
                         testID={`kopru-${m.item_id}`}>
                <Ionicons name={on ? "checkbox" : "square-outline"} size={21}
                          color={on ? colors.accent : colors.inkTertiary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.kopruAd}>{m.text}</Text>
                  <Text style={styles.kopruFis} numberOfLines={1}>
                    {/* Kapsam yalnizca KENDIM oldugunda yaziliyor. Ev listesi
                        varsayilan; "Ev" yazmak her satirda bilinen bir seyi
                        tekrarlamak olurdu. */}
                    {m.scope === "self" ? "Kendim · " : ""}{m.receipt_name}
                  </Text>
                </View>
                {!m.sure && (
                  <View style={styles.kopruSuphe}>
                    <Text style={styles.kopruSupheTxt}>emin değil</Text>
                  </View>
                )}
              </Pressable>
            </View>
          );
        })}

        <View style={styles.kopruAlt}>
          <Pressable style={styles.kopruKalsin}
                     onPress={() => { setKopru(null); goToNextOrExit(); }}
                     testID="kopru-kalsin">
            <Text style={styles.kopruKalsinTxt}>Kalsın</Text>
          </Pressable>
          <Pressable style={styles.kopruOnay} onPress={dusur} testID="kopru-dusur">
            <Text style={styles.kopruOnayTxt}>
              {(kopru || []).filter((m) => secili[m.item_id]).length} ürünü düşür
            </Text>
          </Pressable>
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  page: { backgroundColor: colors.bg, flexGrow: 1 },
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
  batchBar: { flexDirection: "row", gap: 4, marginTop: spacing.md },
  batchDot: { flex: 1, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.22)" },
  batchDotDone: { backgroundColor: colors.accentOnDark },
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
  bulkWrap: { marginBottom: spacing.xs },
  /* 38 piksel; dokunma alanı hapın kendisinden geniş çünkü satırın tamamı
     tetik. Apple'ın 44 pt sınırı satır yüksekliğiyle sağlanıyor. */
  bulkRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    minHeight: 44, paddingHorizontal: 2,
  },
  bulkLabel: { ...overline, color: colors.onSurfaceTertiary },
  bulkHap: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5,
    flexShrink: 1,
  },
  bulkTxt: { ...T.body, color: colors.ink, flexShrink: 1 },
  etiketSatir: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 22 },
  catAyrac: { ...T.caption, color: colors.onSurfaceTertiary },
  /* Genel ad kategoriyle AYNI puntoda: ikisi de "bu kalem ne" sorusunun
     cevabı ve biri diğerinden önemli değil. */
  genelTxt: { ...T.captionSb, color: colors.inkSecondary },
  genelBos: { ...T.caption, color: colors.onSurfaceTertiary, fontStyle: "italic" },
  genelInput: {
    ...T.captionSb, color: colors.ink, padding: 0, minWidth: 90,
    borderBottomWidth: 1, borderBottomColor: colors.accent,
  },
  /* Koyu şerit: kartların üstünde durduğunu ve GEÇİCİ olduğunu söylüyor.
     Beyaz bir satır listenin devamı gibi okunurdu. */
  geriSerit: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.dark, marginHorizontal: spacing.lg,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  geriTxt: { ...T.caption, color: colors.onDark, flex: 1 },
  geriBtn: { ...T.bodySb, color: colors.accentOnDark },
  splitBox: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    borderRadius: radius.md, marginTop: spacing.sm, overflow: "hidden",
  },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { ...T.emph, color: colors.ink },
  emptyDesc: { ...T.body, color: colors.inkSecondary },
  // Tek kap: kalemler kart degil satir.
  kopruBas: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
  },
  kopruIkon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.accentSoft,
    alignItems: "center", justifyContent: "center",
  },
  kopruTitle: { ...T.emph, color: colors.ink },
  kopruDesc: { ...T.caption, color: colors.inkTertiary, marginTop: 1 },
  kopruRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, minHeight: 52,
  },
  kopruAd: { ...T.body, color: colors.ink },
  kopruFis: { ...T.caption, color: colors.inkTertiary, marginTop: 1 },
  kopruSuphe: {
    backgroundColor: colors.warningSoft, borderRadius: 6,
    paddingHorizontal: spacing.sm, paddingVertical: 2,
  },
  kopruSupheTxt: { ...T.caption, fontSize: 10, color: colors.onWarning },
  kopruAlt: {
    flexDirection: "row", gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md,
  },
  kopruKalsin: {
    paddingHorizontal: spacing.xl, minHeight: 48, alignItems: "center",
    justifyContent: "center", borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border,
  },
  kopruKalsinTxt: { ...T.bodySb, color: colors.inkSecondary },
  kopruOnay: {
    flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center",
    borderRadius: radius.pill, backgroundColor: colors.brand,
  },
  kopruOnayTxt: { ...T.bodySb, color: colors.onBrand },
  itemsWrap: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, overflow: "hidden",
  },
  satirCizgi: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  /* Kap SATIR YÖNLÜ: solda bölüşüm tetiği (esner), sağda düzenle düğmesi. */
  satirKap: { flexDirection: "row", alignItems: "stretch" },
  satir: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingLeft: spacing.md, paddingRight: spacing.sm,
    paddingVertical: spacing.sm, minHeight: 52,
  },
  satirAd: { ...T.body, color: colors.ink },
  /* Düğme 46×52 — Apple'ın 44 pt, Google'ın 48 dp alt sınırının üstünde.
     İkon 28 piksel görünüyor ama dokunulabilir alan tüm şerit. */
  duzenleBtn: {
    width: 46, alignItems: "center", justifyContent: "center",
  },
  duzenleKutu: {
    width: 28, height: 28, borderRadius: radius.sm,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  bolusumHap: {
    flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3,
    alignSelf: "flex-start",
  },
  bolusumHapVar: {
    backgroundColor: colors.accentSoft, borderRadius: radius.pill,
    paddingHorizontal: 7, paddingVertical: 1, marginLeft: -1,
  },
  bolusumTxt: { ...T.caption, fontSize: 11, color: colors.inkTertiary, flexShrink: 1 },
  bolusumTxtVar: { color: colors.accentDark },
  satirTutar: { ...T.bodySb, color: colors.ink },
  /* İki eylem de en az 44 piksel yüksekliğinde ve UÇLARDA — yanlışlıkla
     birine basıp diğerini yapma ihtimali en aza iniyor. */
  altEylemler: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  silBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    minHeight: 44, paddingRight: spacing.lg,
  },
  silTxt: { ...T.captionSb, color: colors.negative },
  kapatSatir: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    minHeight: 44, paddingLeft: spacing.lg,
  },
  kapatTxt: { ...T.captionSb, color: colors.inkSecondary },
  // Acik kalem: kendi cercevesi YOK, tek kabin icinde vurgulu bir bolge.
  itemCard: {
    backgroundColor: colors.surfaceAlt, padding: spacing.md,
    gap: spacing.md,
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
  subLabel: { ...overline },
  // Sabit yukseklik: etiketlerden biri sarsa bile altlarindaki kutular hizali kalir.
  labelRow: { height: 22, justifyContent: "center", marginBottom: 4 },
  dupeBox: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.warningSoft, borderRadius: radius.md, padding: spacing.md,
  },
  dupeTitle: { ...T.bodySb, color: colors.onWarning },
  dupeTxt: { ...T.caption, color: colors.onWarning, marginTop: 1 },
  dupeDismiss: { ...T.captionSb, color: colors.onWarning, textDecorationLine: "underline" },
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
  footerLabel: { ...overline },
  footerTotal: { ...T.screen, color: colors.ink, fontVariant: ["tabular-nums"] },
  saveBtn: {
    backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.lg,
    minHeight: 54, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6,
    flex: 1,
  },
  saveTxt: { ...T.bodySb, color: colors.onBrand, flexShrink: 1 },
  error: { ...T.bodySb, color: colors.negative, textAlign: "center" },
  // Ikincil eylem: sabit ve dar. Asil dugmeyle yer paylasinca "Kaydet &
  // Sonraki" yazisi sigmiyordu; birincil eylem her zaman genis kalmali.
  skipBtn: {
    flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md,
    minHeight: 54, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary,
    justifyContent: "center", flexShrink: 0,
  },
  skipTxt: { ...T.captionSb, color: colors.inkSecondary },
});
