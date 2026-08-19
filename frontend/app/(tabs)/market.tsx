/** Market sayfası — bir marketin içi.
 *
 *  Kategori sayfasının kardeşi ve aynı sırayı izliyor: *artıyor mu* →
 *  *ne aldık* → *hangi fişler*. Fark, üçüncü katın kategori değil FİŞ
 *  olması: markete girildiğinde asıl merak "o 42 € neydi" oluyor.
 *
 *  ### Ortalama fiş neden var
 *
 *  Aynı markete 40 € bırakmak ile dört kez 10 € bırakmak toplamda aynı,
 *  alışkanlıkta değil. Toplam tek başına bunu söylemiyor.
 *
 *  ### Neden normalize anahtarla açılıyor
 *
 *  "BIZIM FLEISCHER GMBH" ile "BIZIM FLEISCHER" aynı market. Ham adla
 *  açılsaydı ikisi ayrı sayfa olurdu; `normalize_merchant` ikisini de aynı
 *  anahtara indiriyor ve İstatistik o anahtarı taşıyor.
 */
import { useCallback, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, RefreshControl,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { apiGet } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, HeaderSplit, HeaderPills, HeaderPill, Sheet, Card, Divider, Money,
  Avatar, CategoryIcon, AylikCubuk,
  formatEUR, formatQty, formatDateTR, ayAdi, buAy, sonAylar,
  useScrollPad, useGeriDon, useBasaSar, yenileme,
} from "@/src/ui";
import { colors, spacing, type as T, metrics, fontFamily } from "@/src/theme";

type Urun = {
  key: string; name: string; total: number; count: number;
  market_count: number; qty: number | null; unit: string | null;
};
type Market = {
  name: string; month: string; total: number; expense_count: number;
  avg_expense: number;
  series: { month: string; total: number }[];
  categories: { key: string; total: number }[];
  products: Urun[];
  expenses: {
    expense_id: string; total: number; expense_date: string;
    added_by: string; item_count: number;
    items: { name: string; price: number; quantity?: number; category: string }[];
  }[];
};

const altSatir = (u: Urun) =>
  (u.qty != null && u.unit ? formatQty(u.qty, u.unit) : `${u.count} kez`);

export default function MarketDetay() {
  const altPay = useScrollPad({ tabs: true, extra: 0 });
  const scrollRef = useRef<ScrollView>(null);
  useBasaSar(scrollRef);
  const router = useRouter();
  const geriDon = useGeriDon("/(tabs)/istatistik");
  const { user } = useAuth();
  const { household, members } = useHousehold();
  const params = useLocalSearchParams<{
    key?: string; ad?: string; ay?: string; scope?: string;
  }>();
  const anahtar = typeof params.key === "string" ? params.key : "";
  const gorunenAd = typeof params.ad === "string" && params.ad ? params.ad : anahtar;
  const kapsam = params.scope === "self" ? "self" : "household";

  const [ay, setAy] = useState<string>(
    typeof params.ay === "string" && params.ay.length === 7 ? params.ay : buAy());
  const [veri, setVeri] = useState<Market | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** Açık fiş — aynı anda tek tane. İki fiş birden açık olsa liste
   *  kaybolur ve "hangi kalem hangi fişin" sorusu doğar. */
  const [acikFis, setAcikFis] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setVeri(await apiGet<Market>(
        `/stats/merchant?name=${encodeURIComponent(anahtar)}&month=${ay}&scope=${kapsam}`));
    } catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [anahtar, ay, kapsam]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const kim = (id: string) =>
    members.find((m) => m.user_id === id)?.name?.split(" ")[0] || "?";
  const seri = veri?.series || [];

  return (
    <View style={styles.root} testID="market-screen">
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.page, altPay]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl {...yenileme(refreshing, () => { setRefreshing(true); load(); })} />
        }
      >
        <ScreenHeader
          size="l"
          overline={kapsam === "self" ? "KİŞİSEL · MARKET" : "MARKET"}
          title={gorunenAd.toLocaleUpperCase("tr")}
          right={
            <Pressable onPress={geriDon} hitSlop={12} testID="market-back" style={styles.headBtn}>
              <Ionicons name="close" size={20} color={colors.onDark} />
            </Pressable>
          }
        >
          {/* Ortalama fiş üçüncü sütun: toplam ile fiş sayısı ikisi birlikte
              zaten onu ima ediyor ama insan bölme yapmak zorunda kalmasın. */}
          <HeaderSplit
            items={[
              { label: "Toplam", value: formatEUR(veri?.total ?? 0), accent: true },
              { label: "Fiş", value: String(veri?.expense_count ?? 0) },
              { label: "Ortalama", value: formatEUR(veri?.avg_expense ?? 0) },
            ]}
          />
          <HeaderPills>
            <HeaderPill
              value={ay}
              options={sonAylar(household?.created_at, household?.first_expense_month)
                .map((m) => ({
                  value: m, label: ayAdi(m).split(" ")[0],
                  hint: ayAdi(m), icon: "calendar-outline",
                  iconAccent: m === buAy(),
                }))}
              onSelect={setAy}
              testID="market-ay"
            />
          </HeaderPills>
        </ScreenHeader>

        <Sheet>
          <View style={{ gap: metrics.cardGap }}>
            {loading ? (
              <ActivityIndicator color={colors.ink} style={{ marginTop: spacing.xxl }} />
            ) : !veri || veri.expense_count === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="storefront-outline" size={38} color={colors.inkTertiary} />
                <Text style={styles.emptyTitle}>
                  {ayAdi(ay)} ayında bu markette kayıt yok
                </Text>
              </View>
            ) : (
              <>
                {seri.length >= 2 && (
                  <Card title={`Son ${seri.length} Ay`} style={styles.mx} padded>
                    <AylikCubuk aylar={seri} buAy={veri.month} onSec={setAy} />
                  </Card>
                )}

                {veri.products.length > 0 && (
                  <Card title="Ne Alındı" style={styles.mx}>
                    {veri.products.map((u, i) => (
                      <View key={u.key}>
                        {i > 0 && <Divider inset={spacing.lg} />}
                        <View style={styles.satir}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.ad} numberOfLines={1}>{u.name}</Text>
                            <Text style={styles.alt} numberOfLines={1}>{altSatir(u)}</Text>
                          </View>
                          <Money value={u.total} />
                        </View>
                      </View>
                    ))}
                  </Card>
                )}

                {/* FİŞLER — markete girildiğinde asıl merak "o 42 € neydi".
                    Satıra dokunmak harcamayı açıyor; yeni bir liste çizmek
                    yerine var olan ekranı kullanıyoruz. */}
                {veri.expenses.length > 0 && (
                  <Card title="Fişler" style={styles.mx}>
                    {veri.expenses.map((e, i) => (
                      <View key={e.expense_id}>
                        {i > 0 && <Divider inset={spacing.lg} />}
                        <Pressable
                          style={styles.satir}
                          onPress={() => setAcikFis(acikFis === e.expense_id ? null : e.expense_id)}
                          testID={`market-fis-${e.expense_id}`}
                        >
                          <Avatar name={kim(e.added_by)} size={28}
                                  userId={e.added_by}
                                  avatarId={(members.find((m) => m.user_id === e.added_by) as any)?.avatar_id}
                                  photoVersion={(members.find((m) => m.user_id === e.added_by) as any)?.photo_version} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.ad} numberOfLines={1}>
                              {formatDateTR(e.expense_date)}
                            </Text>
                            <Text style={styles.alt} numberOfLines={1}>
                              {kim(e.added_by)}
                              {e.item_count > 0 ? ` · ${e.item_count} kalem` : ""}
                            </Text>
                          </View>
                          <Money value={e.total} />
                          <Ionicons name={acikFis === e.expense_id ? "chevron-down" : "chevron-forward"}
                                    size={14} color={colors.onSurfaceTertiary} />
                        </Pressable>
                        {/* Fiş YERİNDE açılıyor, düzenleme ekranına gitmiyor.
                            Önce `expense-edit`'e gidiyordu ve bir fişe BAKMAK
                            isteyen kişiyi düzenleme formunun içine
                            düşürüyordu — üstelik başkasının fişinde
                            yapılamayacak bir işi teklif ediyordu.

                            Kademeli açılım: market → fiş → kalemler, hepsi
                            aynı sayfada. Düzenleme yalnızca SAHİBİNE ve ayrı
                            bir satır olarak. */}
                        {acikFis === e.expense_id && (
                          <View style={styles.kalemler}>
                            {(e.items || []).map((it, ii) => (
                              <View key={ii} style={styles.kalemRow}>
                                <CategoryIcon category={it.category} size={26} />
                                <Text style={styles.kalemAd} numberOfLines={1}>{it.name}</Text>
                                <Text style={styles.kalemFiyat}>
                                  {formatEUR((it.quantity || 1) * it.price)}
                                </Text>
                              </View>
                            ))}
                            {e.added_by === user?.user_id && (
                              <Pressable style={styles.duzenle}
                                         onPress={() => router.push({
                                           pathname: "/expense-edit",
                                           params: { expenseId: e.expense_id },
                                         })}
                                         testID={`market-duzenle-${e.expense_id}`}>
                                <Ionicons name="create-outline" size={14} color={colors.accentDark} />
                                <Text style={styles.duzenleTxt}>Düzenle</Text>
                              </Pressable>
                            )}
                          </View>
                        )}
                      </View>
                    ))}
                  </Card>
                )}
              </>
            )}
          </View>
        </Sheet>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  page: { backgroundColor: colors.bg, flexGrow: 1 },
  headBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.darkSurface,
    alignItems: "center", justifyContent: "center",
  },
  mx: { marginHorizontal: spacing.lg },
  satir: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 46,
  },
  ad: { ...T.bodySb, color: colors.ink, flex: 1 },
  alt: { ...T.caption, fontSize: 11, color: colors.inkTertiary, marginTop: 1 },
  empty: {
    alignItems: "center", gap: spacing.sm,
    paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xl,
  },
  emptyTitle: { ...T.emph, color: colors.ink, textAlign: "center" },
  kalemler: {
    backgroundColor: colors.surfaceAlt, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md,
  },
  kalemRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  kalemAd: { ...T.body, color: colors.ink, flex: 1 },
  kalemFiyat: { ...T.bodySb, color: colors.ink, fontVariant: ["tabular-nums"] },
  duzenle: {
    flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start",
  },
  duzenleTxt: { ...T.captionSb, color: colors.accentDark },
});
