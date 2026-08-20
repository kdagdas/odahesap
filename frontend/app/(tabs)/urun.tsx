/** Ürün sayfası — bir ürünün BÜTÜN geçmişi.
 *
 *  Aramanın varış yeri ve "Tüm Ürünler" satırlarının kapısı. Bugüne kadar
 *  ürünlerin gideceği bir yer yoktu: her ekran tek aya bakıyor ve ürün
 *  satırları dokunulamıyordu. Oysa bir ürün hakkında sorulan üç soru da
 *  zamanın içinde:
 *
 *      ne zaman aldık · nereden aldık · kaça
 *
 *  Üçü de burada, tek ekranda ve tek bakışta.
 */
import { useCallback, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, RefreshControl,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { apiGet } from "@/src/api";
import {
  ScreenHeader, HeaderSplit, Sheet, Card, Row, Divider, MerchantBadge, Money,
  AylikCubuk, formatEUR, formatQty, useScrollPad, useGeriDon, useBasaSar, yenileme,
  ayAdi, buAy,
} from "@/src/ui";
import { colors, spacing, type as T, metrics } from "@/src/theme";

type Ay = { month: string; total: number; qty: number; count: number };
type Market = { key: string; name: string; total: number; qty: number; count: number };
type Detay = {
  key: string; name: string | null; total: number; count: number;
  qty?: number | null; unit?: string | null;
  unit_price?: number | null; price_unit?: string | null;
  first_month?: string | null; last_month?: string | null;
  months: Ay[]; merchants: Market[];
};

export default function Urun() {
  const altPay = useScrollPad({ tabs: true, extra: 0 });
  const scrollRef = useRef<ScrollView>(null);
  useBasaSar(scrollRef);
  const router = useRouter();
  const geriDon = useGeriDon("/(tabs)/istatistik");
  const params = useLocalSearchParams<{ key?: string; ad?: string }>();
  const anahtar = typeof params.key === "string" ? params.key : "";
  /* Ad parametre olarak taşınıyor: sunucu cevabı gelene kadar başlık boş
     kalmasın. Cevap gelince sunucununki geçerli — asıl kaynak orası. */
  const gelenAd = typeof params.ad === "string" ? params.ad : "";
  const [d, setD] = useState<Detay | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiGet<Detay>(`/stats/product?key=${encodeURIComponent(anahtar)}`);
      setD(r);
    } catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [anahtar]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const ad = d?.name || gelenAd || "Ürün";
  const bos = !loading && (!d || d.months.length === 0);
  // Ortalama, ALINMAYAN ayları da sayıyor: "ayda ortalama ne harcıyoruz"
  // sorusunun cevabı bu. Yalnızca alınan aylara bölmek "aldığımızda ne kadar"
  // olurdu ve o başka bir soru.
  const aylikOrt = d && d.months.length ? d.total / d.months.length : 0;

  return (
    <View style={styles.root} testID="urun-screen">
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
          overline="ÜRÜN"
          title={ad}
          right={
            <Pressable onPress={geriDon} hitSlop={12} style={styles.headBtn} testID="urun-back">
              <Ionicons name="close" size={20} color={colors.onDark} />
            </Pressable>
          }
        >
          {/* Üç sayı, üçü de "bütün geçmiş" penceresinde. Birim fiyat ancak
              paket sınıfı tekse geliyor (sunucu karar veriyor); yoksa sütun
              hiç çizilmiyor — Kasa'daki sıfır sütunu gizleme kuralının
              aynısı. */}
          {!bos && (
            <HeaderSplit
              items={[
                { label: "TOPLAM", value: formatEUR(d?.total ?? 0), accent: true },
                ...(d?.qty && d?.unit
                  ? [{ label: "MİKTAR", value: `${formatQty(d.qty)} ${d.unit}` }]
                  : [{ label: "ALIŞ", value: `${d?.count ?? 0} kez` }]),
                ...(d?.unit_price && d?.price_unit
                  ? [{ label: `${d.price_unit.toUpperCase()} FİYATI`, value: formatEUR(d.unit_price) }]
                  : []),
              ]}
            />
          )}
          {!bos && d?.first_month && d?.last_month && (
            <Text style={styles.aralik}>
              {d.first_month === d.last_month
                ? ayAdi(d.last_month)
                : `${ayAdi(d.first_month)} – ${ayAdi(d.last_month)}`}
            </Text>
          )}
        </ScreenHeader>

        <Sheet>
          <View style={styles.govde}>
            {loading ? (
              <ActivityIndicator color={colors.ink} style={{ marginTop: spacing.xxl }} />
            ) : bos ? (
              <View style={styles.bos}>
                <View style={styles.bosHalka}>
                  <Ionicons name="basket-outline" size={28} color={colors.inkTertiary} />
                </View>
                <Text style={styles.bosTxt}>Bu ürünün kaydı bulunamadı.</Text>
              </View>
            ) : (
              <>
                {/* NE ZAMAN ALDIK.
                    Boş aylar da çiziliyor ve bu bilerek: "haziranda hiç
                    almadık" bir bilgi. Yalnızca dolu ayları yan yana dizmek
                    aradaki boşluğu siler ve her ay alınan bir ürünle iki kez
                    alınan ürün aynı görünür.

                    Çubuklar DOKUNULAMAZ: bir aya dokunmanın karşılığı yok
                    (o ayın "sütleri" diye süzülmüş bir liste ekranı yok) ve
                    dokunulabilir görünüp hiçbir yere gitmeyen çubuk, olmayan
                    bir kapıdır. */}
                <Card title="Ne zaman aldık" padded>
                  <AylikCubuk
                    aylar={d!.months.map((m) => ({ month: m.month, total: m.total }))}
                    buAy={buAy()}
                    ortLabel={`Aylık ortalama · ${d!.months.length} ay`}
                  />
                  <View style={{ marginTop: -spacing.md }} />
                </Card>

                {/* NEREDEN ALDIK. Aynı ürünü nereden kaça aldığın, evin
                    kendi verisinden çıkan tek gerçek karşılaştırma. */}
                <Card title="Nereden aldık">
                  {d!.merchants.map((m, i) => (
                    <View key={m.key}>
                      {i > 0 && <Divider />}
                      <Row
                        leading={<MerchantBadge name={m.name} />}
                        title={m.name}
                        subtitle={`${m.count} kez`}
                        right={
                          <View style={styles.sag}>
                            {d!.unit && m.qty ? (
                              <Text style={styles.miktar}>{formatQty(m.qty)} {d!.unit}</Text>
                            ) : null}
                            <Money value={m.total} />
                          </View>
                        }
                        chevron
                        onPress={() => router.push({
                          pathname: "/(tabs)/market",
                          params: { key: m.key, ad: m.name, ay: d!.last_month || buAy(),
                                    geri: "/(tabs)/urun" },
                        } as any)}
                        testID={`urun-market-${m.key}`}
                      />
                    </View>
                  ))}
                </Card>

                <Text style={styles.dipnot}>
                  Aylık ortalama {formatEUR(aylikOrt)} · toplam {d!.count} alış
                </Text>
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
  aralik: { ...T.caption, color: colors.onDarkMuted, marginTop: spacing.md },
  govde: { padding: spacing.lg, gap: metrics.cardGap },
  sag: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  miktar: { ...T.caption, color: colors.inkTertiary },
  dipnot: { ...T.caption, color: colors.inkTertiary, textAlign: "center" },
  bos: { alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.md },
  bosHalka: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, alignItems: "center", justifyContent: "center",
  },
  bosTxt: { ...T.body, color: colors.inkSecondary },
});
