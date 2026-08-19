/** Kategori sayfası — halkanın bir diliminin içi.
 *
 *  ### Neden üç kart, neden bu sırayla
 *
 *  "Süt ürünlerine 68 € gitmiş" diyen insan sırayla üç şey sorar:
 *  *artıyor mu* → *ne aldık* → *nereden aldık*. Üçü aynı merakın parçası,
 *  o yüzden üçü de bu sayfada ve bu sırada.
 *
 *  ### Başlıktaki tutar halkadaki dilimle BİREBİR aynı
 *
 *  Sunucu fişin yalnızca o kategorideki kısmını sayıyor: markette hem süt
 *  hem deterjan varsa fişin tamamını saymak kategori toplamını şişirir ve
 *  dilimle çelişirdi. `analiz-test.py` bunu kilitliyor.
 */
import { useCallback, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, RefreshControl,
} from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { apiGet } from "@/src/api";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, HeaderPills, HeaderPill, Sheet, Card, Divider, Money,
  CategoryIcon, categoryLabel, MerchantBadge, AylikCubuk,
  formatEUR, formatQty, ayAdi, buAy, sonAylar, degisimTxt,
  useScrollPad, useGeriDon, useBasaSar, yenileme,
} from "@/src/ui";
import { colors, spacing, type as T, metrics, fontFamily } from "@/src/theme";

type Urun = {
  key: string; name: string; total: number; count: number;
  market_count: number; qty: number | null; unit: string | null;
};
type Kategori = {
  key: string; month: string; total: number; expense_count: number;
  series: { month: string; total: number }[];
  products: Urun[];
  merchants: { name: string; total: number }[];
};

const altSatir = (u: Urun) => {
  const p: string[] = [];
  if (u.qty != null && u.unit) p.push(formatQty(u.qty, u.unit));
  else p.push(`${u.count} kez`);
  return p.join(" · ");
};

export default function KategoriDetay() {
  const altPay = useScrollPad({ tabs: true, extra: 0 });
  const scrollRef = useRef<ScrollView>(null);
  useBasaSar(scrollRef);
  const geriDon = useGeriDon("/(tabs)/istatistik");
  const { household } = useHousehold();
  const params = useLocalSearchParams<{ key?: string; ay?: string }>();
  const anahtar = typeof params.key === "string" ? params.key : "diger";

  const [ay, setAy] = useState<string>(
    typeof params.ay === "string" && params.ay.length === 7 ? params.ay : buAy());
  const [veri, setVeri] = useState<Kategori | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setVeri(await apiGet<Kategori>(`/stats/category?key=${anahtar}&month=${ay}`));
    } catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [anahtar, ay]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  /* Değişim seriden hesaplanıyor, ayrı bir alan istenmiyor: seri zaten
     geçen ayı taşıyor ve iki kaynak olsa ayrışabilirlerdi. */
  const seri = veri?.series || [];
  const gecen = seri.length >= 2 ? seri[seri.length - 2].total : null;
  const degisim = gecen && gecen > 0.005 && veri
    ? Math.round(((veri.total - gecen) / gecen) * 100)
    : null;

  return (
    <View style={styles.root} testID="kategori-screen">
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
          overline="KATEGORİ"
          title={categoryLabel(anahtar)}
          right={
            <Pressable onPress={geriDon} hitSlop={12} testID="kategori-back" style={styles.headBtn}>
              <Ionicons name="close" size={20} color={colors.onDark} />
            </Pressable>
          }
        >
          <View style={styles.heroRow}>
            <CategoryIcon category={anahtar} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={styles.heroValue}>{formatEUR(veri?.total ?? 0)}</Text>
              <Text style={styles.heroSub}>
                {veri?.expense_count ?? 0} harcama
              </Text>
            </View>
          </View>
          {/* Değişim satırı yalnızca karşılaştırılacak geçmiş varsa —
              uygulamanın kuralı: dolgu metni yok, uydurma yok. */}
          {degisim != null && (
            <View style={styles.trendRow}>
              <Ionicons name={degisim >= 0 ? "trending-up" : "trending-down"}
                        size={13} color={colors.accentOnDark} />
              <Text style={styles.trendTxt}>{degisimTxt(degisim)}</Text>
              <Text style={styles.trendPrev} numberOfLines={1}>
                · geçen ay {formatEUR(gecen!)}
              </Text>
            </View>
          )}
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
              testID="kategori-ay"
            />
          </HeaderPills>
        </ScreenHeader>

        <Sheet>
          <View style={{ gap: metrics.cardGap }}>
            {loading ? (
              <ActivityIndicator color={colors.ink} style={{ marginTop: spacing.xxl }} />
            ) : !veri || veri.expense_count === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="pie-chart-outline" size={38} color={colors.inkTertiary} />
                <Text style={styles.emptyTitle}>
                  {ayAdi(ay)} ayında bu kategoride kayıt yok
                </Text>
              </View>
            ) : (
              <>
                {/* 1. ARTIYOR MU */}
                {seri.length >= 2 && (
                  <Card title={`Son ${seri.length} Ay`} style={styles.mx} padded>
                    <AylikCubuk aylar={seri} buAy={veri.month} onSec={setAy} />
                  </Card>
                )}

                {/* 2. NE ALINDI — kalem bazlı, genel ada göre gruplu.
                    Kalemi olmayan harcamalar (elle giriş, düzenli ödeme)
                    burada görünmez; kart yalnızca fiş varsa çiziliyor. */}
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

                {/* 3. NEREDEN — market kimliği uygulamada zaten renkle
                    taşınıyor; burada düz yazıya dönmek yeni bir dil olurdu. */}
                {veri.merchants.length > 0 && (
                  <Card title="Nereden" style={styles.mx}>
                    {veri.merchants.map((m, i) => (
                      <View key={m.name}>
                        {i > 0 && <Divider inset={spacing.lg} />}
                        <View style={styles.satir}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <MerchantBadge name={m.name} />
                          </View>
                          <Money value={m.total} />
                        </View>
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
  heroRow: {
    flexDirection: "row", alignItems: "center",
    gap: spacing.md, marginTop: spacing.sm,
  },
  heroValue: {
    fontSize: 27, lineHeight: 34, color: colors.onDark,
    fontFamily: fontFamily.semibold, letterSpacing: -0.9,
  },
  heroSub: { ...T.caption, color: colors.onDarkMuted, marginTop: 1 },
  trendRow: {
    flexDirection: "row", alignItems: "center", gap: 5, marginTop: spacing.sm,
  },
  trendTxt: { ...T.captionSb, color: colors.accentOnDark },
  trendPrev: { ...T.caption, color: colors.onDarkMuted, flexShrink: 1 },
  satir: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 46,
  },
  ad: { ...T.bodySb, color: colors.ink },
  alt: { ...T.caption, fontSize: 11, color: colors.inkTertiary, marginTop: 1 },
  empty: {
    alignItems: "center", gap: spacing.sm,
    paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xl,
  },
  emptyTitle: { ...T.emph, color: colors.ink, textAlign: "center" },
});
