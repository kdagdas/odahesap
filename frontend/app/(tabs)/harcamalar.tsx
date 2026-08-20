import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, ActivityIndicator,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiGet, apiDelete } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, HeaderSplit, Sheet, Card, Divider, Avatar, CategoryIcon,
  MerchantBadge, Money, splitBadge, formatEUR, formatQty,
  HeaderPills, HeaderPill, useScrollPad, useGeriDon, yenileme,
  ayAdi, buAy, sonAylar,
} from "@/src/ui";
import { colors, spacing, radius, type as T, overline, metrics } from "@/src/theme";

type Item = { name: string; price: number; quantity?: number; unit?: string; category: string };
type Expense = {
  expense_id: string; added_by: string; target_type: string; target_user_id?: string;
  split_mode?: string; split_with?: Record<string, number> | null;
  total: number; merchant?: string; category?: string; source: string;
  created_at: string; expense_date?: string;
  items?: Item[]; notes?: string;
  /** Bu fişten sana düşen. `month` süzgeciyle geliyor. */
  my_share?: number;
  /** Bu harcama kimin için: `ev` · `bana` · `baskasi` · `kendim`. */
  kime?: string | null;
  /** Ödeşme günü (`YYYY-MM-DD`) — kayıt ödeşilmiş bir döneme aitse.
   *  Dönem yalnızca ödeşilince kapandığı için kapalı dönem = ödeşilmiş. */
  odesme?: string | null;
};

/**
 * "Kimin için" ekseni — sunucudaki `kime_kategori()` ile birebir.
 *
 * Kural ALICIDAN BAĞIMSIZ: kategoriyi bölüşme listesi belirliyor, kimin
 * ödediği değil. "Kim aldı" ayrı bir eksen (kişi süzgeci) ve ikisi
 * çarpılabiliyor — "Kemal'in eve aldıkları" = Eve alınanlar + Kişi:Kemal,
 * "başkalarının eve aldığından senin payın" = Eve alınanlar + Kişi:Herkes.
 *
 * Bu yüzden "Senin ödediklerin" diye ayrı bir seçenek YOK: kişi süzgecinde
 * kendini seçmek zaten onu veriyor, ikinci bir yol aynı işi iki kez yazmak
 * olurdu.
 *
 * `bana` gizliliğe takılmıyor: karşı taraf zaten senin için almış, "bana ne
 * alındı" senin görebileceğin bir şey.
 */
const AKIS_ADI: Record<string, string> = {
  ev: "Eve alınanlar",
  bana: "Sana alınanlar",
  baskasi: "Başkası için aldıkların",
  kendim: "Kendine aldıkların",
};
/**
 * HAPTA yazılan kısa ad. Uzun adlar (yukarıda) kart başlığında ve başlıktaki
 * sayının etiketinde kalıyor — orada yer var ve cümle tam olmalı.
 *
 * Hapta ise "Tüm hareketler" tek başına satırın üçte birini yiyordu ve üç hap
 * alt satıra kayıyordu. İkon zaten ne olduğunu söylüyor; hapın işi hangi
 * değerin seçili olduğunu bildirmek, tanımı tekrar etmek değil.
 */
const AKIS_KISA: Record<string, string> = {
  ev: "Eve",
  bana: "Sana",
  baskasi: "Başkasına",
  kendim: "Kendine",
};

const AKIS_ALT: Record<string, string> = {
  ev: "evin tamamına bölünen",
  bana: "seni içeren, başkasının aldığı",
  baskasi: "senin aldığın, başkasını içeren",
  kendim: "yalnızca senin",
};
const AKIS_ICON: Record<string, string> = {
  ev: "home-outline",
  bana: "gift-outline",
  baskasi: "arrow-up-circle-outline",
  kendim: "person-outline",
};

const AY_UZUN = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
                 "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const GUNLER = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

/** "15 Temmuz" — ödeşme çizgisinin üstündeki tarih. */
const kisaTarih = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()} ${AY_UZUN[d.getMonth()]}`;
};

/** "15 AĞUSTOS · CUMARTESİ" — bugün ve dün ayrıca adlandırılır. */
const gunBasligi = (iso: string) => {
  const d = new Date(iso);
  const bugun = new Date();
  const ayni = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (ayni(d, bugun)) return "BUGÜN";
  if (ayni(d, new Date(bugun.getTime() - 86400000))) return "DÜN";
  return `${d.getDate()} ${AY_UZUN[d.getMonth()]} · ${GUNLER[d.getDay()]}`
    .toLocaleUpperCase("tr");
};

// Was a tab; the shopping list earns that slot because it is used daily while
// this history is opened occasionally. Reached from "Tümü" on the home screen.
export default function Harcamalar() {
  // Gezinme cubugu payi -- ic dolgu zaten var, buraya yalnizca cihazin payi.
  const altPay = useScrollPad({ tabs: true, extra: 0 });
  const { user } = useAuth();
  const router = useRouter();
  /* Geri, geldiği yere: Kasa'dan girildiyse Kasa'ya. Sekme gezgininde
     `back()` yığının dibindeki Anasayfa'ya düşüyor. */
  const geriDon = useGeriDon();
  const { members, household } = useHousehold();
  /* Kasa'daki bir ekstre satırından gelinmişse süzgeç hazır geliyor. */
  const params = useLocalSearchParams<{
    akis?: string; ay?: string; kisi?: string; expense?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  /* Bildirimden gelinen fiş — ekrana getirebilmek için satırın kendisi. */
  const hedefSatir = useRef<View | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [akis, setAkis] = useState<string | undefined>(
    params.akis && AKIS_ADI[params.akis] ? params.akis : undefined);
  const [ay, setAy] = useState<string>(
    typeof params.ay === "string" && params.ay.length === 7 ? params.ay : buAy());
  const [memberFilter, setMemberFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /* Kasa'dan gelen süzgeci UYGULA — asıl hata buradaydı.
     Harcamalar bir sekme ekranı; Kasa'dan buraya "atlamak" onu yeniden
     kurmuyor, zaten kurulu ekrana yeni parametre veriyor. `useState` yalnızca
     İLK kuruluşta okuduğu için, daha önce bu sekmeye uğramış biri Kasa'dan
     "Senin için alınanlar"a dokununca hiçbir şey değişmiyordu — filtre eski
     hâlinde kalıyordu. Parametre değiştikçe durumu senkronluyoruz. */
  useEffect(() => {
    setAkis(params.akis && AKIS_ADI[params.akis] ? params.akis : undefined);
  }, [params.akis]);
  useEffect(() => {
    if (typeof params.ay === "string" && params.ay.length === 7) setAy(params.ay);
  }, [params.ay]);
  /* Kasa iki ekseni birden verebiliyor: "senin ödediğin ev alışverişleri" =
     akış:ev + kişi:sen. Boş `kisi` "Herkes" demek, yani süzgeci temizler. */
  useEffect(() => {
    setMemberFilter(typeof params.kisi === "string" && params.kisi ? params.kisi : undefined);
  }, [params.kisi]);

  /* BİLDİRİMDEN GELEN FİŞ.
     "Kadir ortak bir harcama yaptı" bildirimine dokunan kişinin sorusu
     "benim için ne aldı" — cevabı satırın açılımındaki kalemler. Ayrı bir
     fiş ekranı çizilmiyor, var olan açılım kullanılıyor.

     Fiş listede YOKSA (silinmiş, ya da eski bir bildirimde `ay` yazmadığı
     için başka bir ay açılmış) hiçbir şey açılmıyor ve hiçbir yere
     kaydırılmıyor: yanlış bir fişi doğruymuş gibi göstermektense sessiz
     kalmak. */
  const acilacak = typeof params.expense === "string" ? params.expense : undefined;
  useEffect(() => { if (acilacak) setExpandedId(acilacak); }, [acilacak]);

  useEffect(() => {
    if (!acilacak || loading) return;
    if (!expenses.some((e) => e.expense_id === acilacak)) return;
    // Açılım yerleşsin diye kısa bir bekleme; ölçüm ondan önce yapılırsa
    // satırın son konumu değil eski konumu bulunuyor.
    const t = setTimeout(() => {
      const kok = (scrollRef.current as any)?.getInnerViewNode?.();
      const satir = hedefSatir.current as any;
      if (kok == null || !satir?.measureLayout) return;
      satir.measureLayout(
        kok,
        (_x: number, y: number) =>
          scrollRef.current?.scrollTo({ y: Math.max(y - 90, 0), animated: true }),
        () => { /* ölçülemediyse satır yine açık; kaydırma bir konfor */ },
      );
    }, 320);
    return () => clearTimeout(t);
  }, [acilacak, loading, expenses]);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ month: ay });
      // Akış süzgeci SUNUCUDA: istemcideki `split_with` süzgeci Tur 4 öncesi
      // kayıtları kaçırıyordu ve belirtisi "Senin için alınanlar 3 €" yazıp
      // içinin boş açılmasıydı.
      if (akis) q.set("akis", akis);
      if (memberFilter) q.set("member_id", memberFilter);
      const exp = await apiGet<{ expenses: Expense[] }>(`/expenses?${q.toString()}`);
      setExpenses(exp.expenses || []);
    } catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [ay, akis, memberFilter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onDelete = async (id: string) => {
    try { await apiDelete(`/expenses/${id}`); load(); } catch (e) { console.log(e); }
  };

  /* Toplam YALNIZCA bir süzgeç seçiliyken gösteriliyor.
     Filtresizken "Süzülen toplam 417,18" yazıyordu ve o sayı ev harcamasını,
     kişiseli, başkası için alınanı bir torbaya atıyordu — kimsenin sorduğu
     bir soruya cevap vermiyor, yalnızca "bu ne?" dedirtiyordu. Bir süzgeç
     seçilince toplam bir ANLAM kazanıyor ("Eve alınanlar 128,40") ve o zaman
     çiziliyor. */
  const listedTotal = expenses.reduce((s, e) => s + (e.total || 0), 0);
  const listedShare = expenses.reduce((s, e) => s + (e.my_share || 0), 0);

  return (
    <View style={styles.root} testID="harcamalar-screen">
      {/* Başlık kaydırma alanının içinde: aşağı inerken beyaz yüzey koyu alanı
          örtüp yerini alıyor. Sabit kalan koyu bant listeden yer çalıyordu. */}
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.page, altPay]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl {...yenileme(refreshing, () => { setRefreshing(true); load(); })} />
        }
      >
        <ScreenHeader
          overline="GEÇMİŞ"
          title="Harcamalar"
          right={
            <Pressable onPress={geriDon} hitSlop={12} testID="harcamalar-back" style={styles.headBtn}>
              <Ionicons name="close" size={20} color={colors.onDark} />
            </Pressable>
          }
        >
          {/* Süzgeç yokken TEK sayı: kaç kayıt. Toplam ancak bir süzgeçle
              anlam kazanıyor; "Eve alınanlar 128,40" bir cevap, süzgeçsiz
              "417,18" ise ev + kişisel + başkası karışımı ve kimsenin
              sorduğu bir şey değil.

              Süzgeçliyken ikinci sütun SENİN PAYIN — ev harcamasının tamamı
              ile senin payın farklı sayılar ve ikincisi Kasa'daki borcunu
              açıklayan taraf. */}
          <HeaderSplit
            items={akis
              ? [
                  { label: AKIS_ADI[akis], value: formatEUR(listedTotal), accent: true },
                  ...(Math.abs(listedShare - listedTotal) > 0.005
                    ? [{ label: "Senin payın", value: formatEUR(listedShare) }]
                    : [{ label: "Kayıt", value: `${expenses.length}` }]),
                ]
              : [
                  { label: ayAdi(ay), value: `${expenses.length} harcama` },
                ]}
          />
          {/* Üç bağımsız eksen, üç hap: KİMİN İÇİN (akış) · NE ZAMAN (ay) ·
              KİM EKLEDİ (kişi). Kasa'dan gelen birinin süzgeci akış hapında
              seçili geliyor; oradan başka bir akışa da geçebiliyor. */}
          <HeaderPills>
            {/* KİMİN İÇİN — seçilebilir. Önce yalnızca Kasa'dan gelen bir çip
                olarak vardı ve doğrudan seçilemiyordu; oysa "bana ne alındı"
                buraya girip bakılacak bir soru. */}
            <HeaderPill
              value={akis ?? ""}
              options={[
                { value: "", label: "Tümü", icon: "swap-vertical-outline" },
                ...(["ev", "bana", "baskasi", "kendim"] as const).map((k) => ({
                  value: k, label: AKIS_KISA[k], hint: AKIS_ALT[k], icon: AKIS_ICON[k],
                })),
              ]}
              onSelect={(v) => setAkis(v || undefined)}
              menu
              testID="filter-akis"
            />
            <HeaderPill
              value={ay}
              options={sonAylar(household?.created_at, household?.first_expense_month)
                .map((m) => ({
                  value: m, label: ayAdi(m).split(" ")[0],
                  hint: ayAdi(m), icon: "calendar-outline",
                  iconAccent: m === buAy(),
                }))}
              onSelect={setAy}
              testID="filter-ay"
            />
            {/* Kişi süzgeci. Alt satır (hint) YOK: "Kemal" başlığının altına
                yine "Kemal" yazmak boş bir tekrardı. Her kişi kendi avatarını
                taşıyor; "Herkes" ikonla kalıyor — üç avatarın yığını dar hapta
                yazıyla çakışıyordu. */}
            <HeaderPill
              value={memberFilter ?? ""}
              options={[
                { value: "", label: "Herkes", icon: "people", hint: `${members.length} kişi` },
                ...members.map((m) => ({
                  value: m.user_id, label: m.name.split(" ")[0],
                  avatar: {
                    name: m.name, avatarId: (m as any).avatar_id,
                    userId: m.user_id, photoVersion: (m as any).photo_version,
                  },
                })),
              ]}
              onSelect={(v) => setMemberFilter(v || undefined)}
              menu
              testID="filter-member"
            />
          </HeaderPills>
        </ScreenHeader>

        <Sheet>
          <View style={styles.scroll}>

          {loading ? (
            <ActivityIndicator color={colors.ink} style={{ marginTop: spacing.xl }} />
          ) : expenses.length === 0 ? (
            <View style={styles.empty} testID="expenses-empty">
              <View style={styles.emptyRing}>
                <Ionicons name="file-tray-outline" size={30} color={colors.inkTertiary} />
              </View>
              <Text style={styles.emptyTitle}>
                {akis ? `${ayAdi(ay)} ayında bu türde kayıt yok`
                      : `${ayAdi(ay)} ayında harcama yok`}
              </Text>
            </View>
          ) : (
            <Card title={akis ? AKIS_ADI[akis] : "Tüm Harcamalar"}>
              {expenses.map((e, idx) => {
                const author = members.find((m) => m.user_id === e.added_by);
                const targetChip = splitBadge(e, members, user?.user_id);
                const expanded = expandedId === e.expense_id;
                // Tarih GUN BASLIGINA cikti: 21 satirin 21'inde tekrar
                // ediyordu. Banka ekstrelerinin cozumu bu -- gun bir kez
                // yazilir, altina o gunun satirlari dizilir.
                const gun = e.expense_date || "";
                const yeniGun = !!gun && gun !== (expenses[idx - 1]?.expense_date || "");
                // Ödeşme çizgisi bu kaydın ÜSTÜNE çizilir mi? Liste yeniden
                // eskiye sıralı; çizgi bir ödeşme grubunun ilk kaydında
                // düşüyor ve "buraya kadarı ödeşildi" diyor.
                const cizgi = e.odesme && e.odesme !== expenses[idx - 1]?.odesme
                  ? e.odesme : null;
                // Çizginin ALTINDA ama ödeşilmemiş kayıt. Nadir ve gerçek:
                // 20 Temmuz tarihli bir fiş bugün girilirse tarihçe eskidir
                // ama borcu canlıdır. Çizgi tarihe çizildiği için bu satır
                // yanlış tarafta kalıyor; işaret onu düzeltiyor.
                const istisna = !e.odesme
                  && expenses.slice(0, idx).some((o) => !!o.odesme);
                return (
                  <View key={e.expense_id}
                        ref={(r) => { if (e.expense_id === acilacak) hedefSatir.current = r; }}>
                    {cizgi && (
                      <View style={styles.odesmeCizgi} testID={`odesme-${cizgi}`}>
                        <Ionicons name="checkmark-circle" size={14} color={colors.accentDark} />
                        <Text style={styles.odesmeTxt}>
                          {kisaTarih(cizgi)} · buraya kadar ödeşildi
                        </Text>
                      </View>
                    )}
                    {yeniGun ? (
                      <Text style={styles.gunBaslik}>{gunBasligi(gun)}</Text>
                    ) : idx > 0 && !cizgi ? <Divider inset={spacing.lg + 46} /> : null}
                    <Pressable
                      onPress={() => setExpandedId(expanded ? null : e.expense_id)}
                      testID={`expense-item-${e.expense_id}`}
                      android_ripple={{ color: colors.divider }}
                    >
                      <View style={styles.expRow}>
                        <Avatar
                          name={author?.name || "?"}
                          avatarId={(author as any)?.avatar_id}
                          userId={author?.user_id}
                          photoVersion={(author as any)?.photo_version}
                        />
                        <View style={{ flex: 1, gap: 3 }}>
                          <View style={styles.titleRow}>
                            {/* Who paid goes in the title; the merchant lives in the
                                coloured badge. They used to both show the merchant. */}
                            <Text style={styles.expTitle} numberOfLines={1}>
                              {author?.name || "Bilinmeyen"}
                            </Text>
                            {e.merchant
                              ? <MerchantBadge name={e.merchant} />
                              : <Text style={styles.expSubtle}>
                                  {e.category || (e.source === "receipt" ? "Fiş" : "Manuel")}
                                </Text>}
                          </View>
                          {/* Bolusum artik dolgu rozet degil duz yazi ve
                              yalnizca ISTISNA vurgulu: "Ev" herkesin
                              bekledigi durum, sessiz kalir. Tarih satirdan
                              cikti, gun basliginda. */}
                          <View style={styles.altSatir}>
                            <Text style={[styles.splitTxt,
                                          targetChip.txt !== "Ev" && { color: colors.accentDark }]}
                                  numberOfLines={1}>
                              {targetChip.txt}
                            </Text>
                            {/* Ödeşme çizgisinin altında duran ama ödeşilmemiş
                                kayıt. Geç girilen fiş kendi gerçek tarihine
                                yazılıyor (KARAR 2) — istisna nadir olduğu için
                                tam da işaretlenmeyi hak eden şey o. */}
                            {istisna && (
                              <Text style={styles.odesilmedi}>ödeşilmedi</Text>
                            )}
                          </View>
                        </View>
                        {/* Büyük olan FİŞİN TAMAMI — "ne aldık" sorusunun
                            cevabı o. Payın farklıysa altında küçük duruyor;
                            60 €'luk ev alışverişinde 20 € senin payındır ve
                            ekranda tek sayı varsa hangisi olduğu bilinemez.

                            PAYIN SIFIRSA hiç yazılmıyor. Yalnızca Salih için
                            aldığın bir şeyde sana pay düşmüyor ve "payın 0,00"
                            bilgi değil gürültü — üstelik "bir şey mi kaçırdım"
                            diye baktırıyor. */}
                        {(e.my_share ?? 0) > 0.005
                          && Math.abs((e.my_share ?? e.total) - e.total) > 0.005 ? (
                          <View style={{ alignItems: "flex-end" }}>
                            <Money value={e.total} />
                            <Text style={styles.icinde}>payın {formatEUR(e.my_share ?? 0)}</Text>
                          </View>
                        ) : (
                          <Money value={e.total} />
                        )}
                      </View>
                    </Pressable>

                    {expanded && (
                      <View style={styles.expDetails}>
                        {(e.items || []).map((it, i) => (
                          <View key={i} style={styles.itemRow}>
                            <CategoryIcon category={it.category} size={30} />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.itemName} numberOfLines={1}>{it.name}</Text>
                              {(it.quantity || 1) !== 1 && (
                                <Text style={styles.itemQty}>{formatQty(it.quantity, it.unit)} × {formatEUR(it.price)}</Text>
                              )}
                            </View>
                            <Text style={styles.itemPrice}>{formatEUR((it.quantity || 1) * it.price)}</Text>
                          </View>
                        ))}
                        {e.notes && <Text style={styles.notes}>💬 {e.notes}</Text>}
                        {e.added_by === user?.user_id && (
                          <View style={styles.ownerActions}>
                            <Pressable
                              style={styles.editBtn}
                              onPress={() => router.push({ pathname: "/expense-edit", params: { expenseId: e.expense_id } })}
                              testID={`edit-expense-${e.expense_id}`}
                            >
                              <Ionicons name="create-outline" size={14} color={colors.ink} />
                              <Text style={styles.editTxt}>Düzenle</Text>
                            </Pressable>
                            <Pressable style={styles.deleteBtn} onPress={() => onDelete(e.expense_id)} testID={`delete-expense-${e.expense_id}`}>
                              <Ionicons name="trash-outline" size={14} color={colors.negative} />
                              <Text style={styles.deleteTxt}>Sil</Text>
                            </Pressable>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </Card>
          )}
          </View>
        </Sheet>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  headBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.darkSurface,
    alignItems: "center", justifyContent: "center",
  },
  page: { backgroundColor: colors.bg, flexGrow: 1 },
  scroll: { padding: spacing.lg, paddingTop: spacing.sm, gap: metrics.cardGap, paddingBottom: spacing.xxxl },
  groupLabel: { ...overline, marginTop: spacing.xs },
  chipRow: { gap: spacing.sm, alignItems: "center", paddingRight: spacing.lg },
  empty: { alignItems: "center", paddingVertical: spacing.xxxl, gap: spacing.md },
  emptyRing: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, alignItems: "center", justifyContent: "center",
  },
  emptyTitle: { ...T.body, color: colors.inkSecondary },
  expRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  expTitle: { ...T.bodySb, color: colors.ink },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  gunBaslik: {
    ...overline, paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg, paddingBottom: spacing.xs,
  },
  splitTxt: { ...T.caption, color: colors.inkTertiary },
  icinde: { ...T.caption, fontSize: 10, color: colors.inkTertiary, marginTop: 1 },
  altSatir: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  /* Ödeşilmiş kayıtlar SOLUKLAŞTIRILMIYOR, yalnızca çizgi çiziliyor.
     Soluklaştırma, çizginin bir kez söylediğini her satırda tekrar eder ve
     bir ayın çoğu satırı ödeşilmiş olduğu için ekranın büyüğü "kapalı"
     görünürdü. Harcamalar'ın sorusu "ne harcadık" — ödeşilmiş bir fiş daha
     az gerçek değil, istatistikte de tam sayılıyor. Bankacılıkta da kalıp
     böyle: BEKLEYEN işlem işaretlenir, gerçekleşmiş olan değil. */
  odesmeCizgi: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.lg, paddingVertical: 7,
  },
  odesmeTxt: { ...T.captionSb, fontSize: 11, color: colors.accentDark },
  odesilmedi: {
    ...T.caption, fontSize: 10, color: colors.onWarning,
    backgroundColor: colors.warningSoft, borderRadius: radius.sm,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  expSubtle: { ...T.caption, color: colors.inkTertiary },
  expDetails: {
    backgroundColor: colors.surfaceAlt, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md,
  },
  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  itemName: { ...T.body, color: colors.ink },
  itemQty: { ...T.caption, color: colors.inkTertiary, marginTop: 1 },
  itemPrice: { ...T.bodySb, color: colors.ink, fontVariant: ["tabular-nums"] },
  notes: { ...T.caption, color: colors.inkSecondary, fontStyle: "italic" },
  ownerActions: { flexDirection: "row", gap: spacing.sm },
  editBtn: {
    flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md,
    paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  editTxt: { ...T.captionSb, color: colors.ink },
  deleteBtn: {
    flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start",
    paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill,
    backgroundColor: colors.negativeSoft,
  },
  deleteTxt: { ...T.captionSb, color: colors.negative },
});
