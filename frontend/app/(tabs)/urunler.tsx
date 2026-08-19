/** Tüm ürünler — bir ayın ürün bazlı dökümü.
 *
 *  İstatistik'teki "En Çok Aldıklarımız" kartı ilk sekizi gösteriyor; bu
 *  sayfa tamamını. Ayrı durmasının sebebi maliyet: her açılışta yüzlerce
 *  satır taşımanın anlamı yok, ama buraya giren de kesilmiş bir liste
 *  istemiyor.
 *
 *  ### Neden bu sayfa rakiplerde yok
 *
 *  Gruplama fiş kalemlerindeki **genel ürün ada** dayanıyor (Tur 8):
 *  `MILSANI`, `MILBONA` ve `JA! MILCH` tek satırda "Süt" olarak toplanıyor.
 *  Bölüşme uygulamaları fişin içini hiç okumuyor; bütçe uygulamaları veriyi
 *  bankadan aldığı için "REWE 42,80"den öteye geçemiyor.
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
  ScreenHeader, HeaderSplit, HeaderPills, HeaderPill, Sheet, Card, Divider, Money,
  formatEUR, formatQty, ayAdi, buAy, sonAylar, useScrollPad, useGeriDon, useBasaSar,
  yenileme,
} from "@/src/ui";
import { colors, spacing, type as T, metrics, fontFamily } from "@/src/theme";

type Urun = {
  key: string; name: string; total: number; count: number;
  market_count: number; qty: number | null; unit: string | null;
};

/** "14 lt · 3 markette" — miktar yalnızca birim tekse.
 *  2 kg un ile 3 paket unu toplamak anlamsız bir sayı üretir; sunucu karışık
 *  birimde `qty`'yi zaten `null` gönderiyor. */
const altSatir = (u: Urun) => {
  const p: string[] = [];
  if (u.qty != null && u.unit) p.push(formatQty(u.qty, u.unit));
  else p.push(`${u.count} kez`);
  p.push(u.market_count === 1 ? "tek markette" : `${u.market_count} markette`);
  return p.join(" · ");
};

export default function Urunler() {
  const altPay = useScrollPad({ tabs: true, extra: 0 });
  const scrollRef = useRef<ScrollView>(null);
  useBasaSar(scrollRef);
  const geriDon = useGeriDon("/(tabs)/istatistik");
  const { household } = useHousehold();
  const params = useLocalSearchParams<{ ay?: string }>();

  const [ay, setAy] = useState<string>(
    typeof params.ay === "string" && params.ay.length === 7 ? params.ay : buAy());
  const [urunler, setUrunler] = useState<Urun[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ products: Urun[] }>(`/stats/products?month=${ay}`);
      setUrunler(r.products || []);
    } catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [ay]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toplam = urunler.reduce((s, u) => s + u.total, 0);

  return (
    <View style={styles.root} testID="urunler-screen">
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
          overline="ÜRÜNLER"
          title={ayAdi(ay)}
          right={
            <Pressable onPress={geriDon} hitSlop={12} testID="urunler-back" style={styles.headBtn}>
              <Ionicons name="close" size={20} color={colors.onDark} />
            </Pressable>
          }
        >
          {/* Toplam, fişlerin toplamı DEĞİL kalemlerin toplamı: kalemi
              olmayan harcamalar (elle giriş, düzenli ödeme) burada yok.
              Etiket bunu söylüyor, yoksa Anasayfa'daki ev toplamıyla
              tutmadığı için "hangisi doğru" sorusu doğardı. */}
          <HeaderSplit
            items={[
              { label: "Fişlerden okunan", value: formatEUR(toplam), accent: true },
              { label: "Ürün", value: `${urunler.length} çeşit` },
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
              testID="urunler-ay"
            />
          </HeaderPills>
        </ScreenHeader>

        <Sheet>
          <View style={styles.scroll}>
            {loading ? (
              <ActivityIndicator color={colors.ink} style={{ marginTop: spacing.xl }} />
            ) : urunler.length === 0 ? (
              <View style={styles.empty}>
                <View style={styles.emptyRing}>
                  <Ionicons name="basket-outline" size={30} color={colors.inkTertiary} />
                </View>
                <Text style={styles.emptyTitle}>{ayAdi(ay)} ayında okunmuş fiş yok</Text>
                <Text style={styles.emptyDesc}>
                  Bu liste fiş kalemlerinden çıkıyor; elle girilen harcamalar burada görünmez.
                </Text>
              </View>
            ) : (
              <Card title="Tüm Ürünler">
                {urunler.map((u, i) => (
                  <View key={u.key}>
                    {i > 0 && <Divider inset={spacing.lg} />}
                    <View style={styles.row}>
                      {/* Sıra numarası: 40 satırlık listede "kaçıncı sırada"
                          gözle sayılmıyor ve asıl merak edilen o. */}
                      <Text style={styles.sira}>{i + 1}</Text>
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
  scroll: {
    padding: spacing.lg, paddingTop: spacing.sm,
    gap: metrics.cardGap, paddingBottom: spacing.xxxl,
  },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 48,
  },
  sira: {
    ...T.caption, fontSize: 11, color: colors.inkTertiary,
    width: 18, textAlign: "right", fontVariant: ["tabular-nums"],
  },
  ad: { ...T.bodySb, color: colors.ink },
  alt: { ...T.caption, fontSize: 11, color: colors.inkTertiary, marginTop: 1 },
  empty: { alignItems: "center", paddingVertical: spacing.xxxl, gap: spacing.md },
  emptyRing: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, alignItems: "center", justifyContent: "center",
  },
  emptyTitle: { ...T.emph, color: colors.ink },
  emptyDesc: {
    ...T.caption, color: colors.inkTertiary, textAlign: "center",
    paddingHorizontal: spacing.xl,
  },
});
