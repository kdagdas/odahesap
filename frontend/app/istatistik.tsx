/** İstatistikler — TAKVİM AYI bazlı, Ev / Kişisel sekmeli.
 *
 *  Kasa'ya değil kendi sayfasına konuldu: Kasa bir *eylem* ekranı ("kim kime
 *  borçlu, dönemi kapat"), istatistik ise *gezinme* ekranı. İkisini aynı yere
 *  koymak, ödeşmeye gelen kişiyi grafiklerin arasından geçirmek olurdu.
 *
 *  Ay bazlı olmasının sebebi: dönem üç hafta da sürebilir yedi hafta da, ama
 *  "bu ay ne kadar harcadık" sorusunun cevabı dönemle değişmemeli. Elektrik
 *  hep ayın 15'inde gelir.
 *
 *  Buradaki her sayı birinin gerçekten sorduğu bir soruya cevap veriyor.
 *  Kişi başına TÜKETİM karşılaştırması bilinçli olarak yok: kimin daha çok
 *  tükettiğini değil kimin daha müsait olduğunu ölçer ve ev arkadaşları
 *  arasında gereksiz sürtüşme üretir. "Kim ne kadar ÖDEDİ" farklı bir şey ve
 *  ödeşmenin doğrudan girdisi.
 */
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiGet } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, Sheet, Card, Row, Divider, Avatar, Money, CategoryIcon,
  categoryLabel, MerchantBadge, formatEUR, formatEURShort,
} from "@/src/ui";
import { colors, spacing, radius, type as T, overline, fontFamily, metrics } from "@/src/theme";

type Monthly = {
  month: string; total: number; expense_count: number;
  prev_total: number; prev_month?: string; change_pct: number | null;
  fixed: number; variable: number; per_person: number; member_count: number;
  categories: { key: string; total: number }[];
  merchants: { name: string; total: number }[];
  by_member: { user_id: string; total: number }[];
  daily_series: { day: string; total: number }[];
  months: string[];
};

const AYLAR = ["", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
               "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const ayAdi = (m: string) => {
  const [y, mm] = m.split("-");
  return `${AYLAR[parseInt(mm, 10)] || ""} ${y}`;
};
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const shiftMonth = (m: string, by: number) => {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(y, mm - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function Istatistik() {
  const router = useRouter();
  const { user } = useAuth();
  const { members } = useHousehold();
  const [scope, setScope] = useState<"household" | "self">("household");
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<Monthly | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await apiGet<Monthly>(`/stats/monthly?month=${month}&scope=${scope}`));
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [month, scope]);
  useEffect(() => { load(); }, [load]);

  const member = (id: string) => members.find((m) => m.user_id === id);
  const maxDaily = Math.max(1, ...(data?.daily_series || []).map((d) => d.total));
  const maxCat = Math.max(1, ...(data?.categories || []).map((c) => c.total));
  // İleri gitmek bugünün ayını aşmamalı: boş bir geleceğe dolaşmanın anlamı yok.
  const canForward = month < thisMonth();

  return (
    <View style={styles.root} testID="istatistik-screen">
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          overline="İSTATİSTİK"
          title={ayAdi(month)}
          right={
            <Pressable onPress={() => router.back()} hitSlop={12} testID="stat-back" style={styles.headBtn}>
              <Ionicons name="close" size={20} color={colors.onDark} />
            </Pressable>
          }
        >
          <View style={styles.monthNav}>
            <Pressable onPress={() => setMonth((m) => shiftMonth(m, -1))}
                       style={styles.navBtn} testID="stat-prev" hitSlop={8}>
              <Ionicons name="chevron-back" size={18} color={colors.onDark} />
            </Pressable>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={styles.heroLabel}>
                {scope === "household" ? "EV HARCAMASI" : "KİŞİSEL HARCAMAN"}
              </Text>
              <Text style={styles.heroValue}>{formatEUR(data?.total ?? 0)}</Text>
            </View>
            <Pressable onPress={() => canForward && setMonth((m) => shiftMonth(m, 1))}
                       style={[styles.navBtn, !canForward && { opacity: 0.25 }]}
                       disabled={!canForward} testID="stat-next" hitSlop={8}>
              <Ionicons name="chevron-forward" size={18} color={colors.onDark} />
            </Pressable>
          </View>

          {data?.change_pct != null && (
            <View style={styles.trend}>
              <Ionicons
                name={data.change_pct >= 0 ? "trending-up" : "trending-down"}
                size={13} color={colors.accentOnDark}
              />
              <Text style={styles.trendTxt}>
                %{Math.abs(data.change_pct)} {data.change_pct >= 0 ? "artış" : "azalış"}
                {data.prev_month ? ` · ${ayAdi(data.prev_month)} ${formatEURShort(data.prev_total)}` : ""}
              </Text>
            </View>
          )}
        </ScreenHeader>

        <Sheet>
          <View style={{ gap: metrics.cardGap }}>
            <View style={styles.tabs}>
              {(["household", "self"] as const).map((s) => (
                <Pressable key={s} style={[styles.tab, scope === s && styles.tabOn]}
                           onPress={() => setScope(s)} testID={`stat-tab-${s}`}>
                  <Text style={[styles.tabTxt, scope === s && styles.tabTxtOn]}>
                    {s === "household" ? "Ev" : "Kişisel"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {loading ? (
              <ActivityIndicator color={colors.dark} style={{ marginTop: spacing.xxl }} />
            ) : !data || data.expense_count === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="calendar-outline" size={38} color={colors.inkTertiary} />
                <Text style={styles.emptyTitle}>{ayAdi(month)} ayında kayıt yok</Text>
                <Text style={styles.emptyDesc}>
                  {scope === "household"
                    ? "Bu ay hiç ev harcaması girilmemiş."
                    : "Bu ay kendine ait bir harcama girmemişsin."}
                </Text>
              </View>
            ) : (
              <>
                {/* Sabit / değişken ayrımı Tur 5'in getirdiği kesit ve
                    insanların asıl sorduğu ayrım: "kira dışında ne harcadık?" */}
                <Card title="Sabit ve Değişken" style={styles.mx} padded>
                  <View style={styles.splitBar}>
                    <View style={[styles.barFixed, { flex: Math.max(data.fixed, 0.001) }]} />
                    <View style={[styles.barVariable, { flex: Math.max(data.variable, 0.001) }]} />
                  </View>
                  <View style={styles.legendRow}>
                    <View style={styles.legendItem}>
                      <View style={[styles.dot, { backgroundColor: colors.dark }]} />
                      <Text style={styles.legendLabel}>Sabit gider</Text>
                      <Text style={styles.legendValue}>{formatEUR(data.fixed)}</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.dot, { backgroundColor: colors.accent }]} />
                      <Text style={styles.legendLabel}>Değişken</Text>
                      <Text style={styles.legendValue}>{formatEUR(data.variable)}</Text>
                    </View>
                  </View>
                  {scope === "household" && (
                    <Text style={styles.foot}>
                      {data.member_count} kişi · kişi başı {formatEUR(data.per_person)}
                    </Text>
                  )}
                </Card>

                <Card title="Günlük Akış" style={styles.mx} padded>
                  <View style={styles.bars}>
                    {data.daily_series.map((d) => (
                      <View key={d.day} style={styles.barCol}>
                        <View style={[
                          styles.bar,
                          {
                            height: Math.max(2, (d.total / maxDaily) * 76),
                            backgroundColor: d.total > 0 ? colors.dark : colors.border,
                          },
                        ]} />
                      </View>
                    ))}
                  </View>
                  <View style={styles.barsAxis}>
                    <Text style={styles.axisTxt}>1</Text>
                    <Text style={styles.axisTxt}>{data.daily_series.length}</Text>
                  </View>
                </Card>

                {data.categories.length > 0 && (
                  <Card title="Nereye Gitti" style={styles.mx}>
                    {data.categories.slice(0, 7).map((cat, i) => (
                      <View key={cat.key}>
                        {i > 0 && <Divider inset={spacing.lg} />}
                        <View style={styles.catRow}>
                          <CategoryIcon category={cat.key} />
                          <View style={{ flex: 1, gap: 5 }}>
                            <View style={styles.catHead}>
                              <Text style={styles.catName}>{categoryLabel(cat.key)}</Text>
                              <Money value={cat.total} />
                            </View>
                            <View style={styles.track}>
                              <View style={[styles.fill, { width: `${(cat.total / maxCat) * 100}%` }]} />
                            </View>
                          </View>
                        </View>
                      </View>
                    ))}
                  </Card>
                )}

                {scope === "household" && data.by_member.length > 0 && (
                  <Card title="Kim Ne Kadar Ödedi" style={styles.mx}>
                    {data.by_member.map((bm, i) => {
                      const m = member(bm.user_id);
                      return (
                        <View key={bm.user_id}>
                          {i > 0 && <Divider />}
                          <Row
                            leading={<Avatar name={m?.name} avatarId={(m as any)?.avatar_id}
                                             userId={m?.user_id} photoVersion={(m as any)?.photo_version} />}
                            title={m?.user_id === user?.user_id ? `${m?.name} (sen)` : (m?.name || "—")}
                            right={<Money value={bm.total} />}
                          />
                        </View>
                      );
                    })}
                    {/* Ödemek tüketmek değildir: bu liste kimin daha çok
                        harcadığını değil, kimin kasadan çıktığını gösterir. */}
                    <Text style={styles.foot}>
                      Ödenen tutarlar — kimin ne tükettiği değil, ödeşmenin girdisi.
                    </Text>
                  </Card>
                )}

                {data.merchants.length > 0 && (
                  <Card title="Marketler" style={styles.mx} padded>
                    <View style={styles.merchWrap}>
                      {data.merchants.map((mm) => (
                        <View key={mm.name} style={styles.merchRow}>
                          <MerchantBadge name={mm.name} />
                          <Text style={styles.merchTotal}>{formatEUR(mm.total)}</Text>
                        </View>
                      ))}
                    </View>
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
  page: { backgroundColor: colors.bg, flexGrow: 1, paddingBottom: spacing.xxl },
  headBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.darkSurface,
    alignItems: "center", justifyContent: "center",
  },
  monthNav: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm },
  navBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.darkSurface,
    alignItems: "center", justifyContent: "center",
  },
  heroLabel: { ...T.caption, color: colors.onDarkMuted, letterSpacing: 0.6 },
  heroValue: {
    fontSize: 34, lineHeight: 42, fontFamily: fontFamily.bold,
    color: colors.onDark, letterSpacing: -1,
  },
  trend: {
    flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "center",
    backgroundColor: colors.darkSurface, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 5, marginTop: spacing.sm,
  },
  trendTxt: { ...T.captionSb, color: colors.accentOnDark },
  mx: { marginHorizontal: spacing.lg },
  tabs: {
    flexDirection: "row", gap: spacing.xs, marginHorizontal: spacing.lg,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, padding: 3,
  },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.pill },
  tabOn: { backgroundColor: colors.dark },
  tabTxt: { ...T.captionSb, color: colors.inkSecondary },
  tabTxtOn: { color: colors.onDark },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xl },
  emptyTitle: { ...T.emph, color: colors.ink },
  emptyDesc: { ...T.caption, color: colors.inkTertiary, textAlign: "center", lineHeight: 19 },
  splitBar: { flexDirection: "row", height: 12, borderRadius: 6, overflow: "hidden", gap: 2 },
  barFixed: { backgroundColor: colors.dark, borderRadius: 6 },
  barVariable: { backgroundColor: colors.accent, borderRadius: 6 },
  legendRow: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.md },
  legendItem: { flex: 1, gap: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { ...T.caption, color: colors.inkTertiary },
  legendValue: { ...T.bodySb, color: colors.ink },
  foot: { ...T.caption, color: colors.inkTertiary, marginTop: spacing.md,
          paddingHorizontal: spacing.lg, paddingBottom: spacing.md, lineHeight: 17 },
  bars: { flexDirection: "row", alignItems: "flex-end", height: 80, gap: 1 },
  barCol: { flex: 1, justifyContent: "flex-end" },
  bar: { width: "100%", borderRadius: 2 },
  barsAxis: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.xs },
  axisTxt: { ...T.caption, fontSize: 11, color: colors.inkTertiary },
  catRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  catHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  catName: { ...T.emph, color: colors.ink },
  track: { height: 5, borderRadius: 3, backgroundColor: colors.surfaceSecondary, overflow: "hidden" },
  fill: { height: 5, borderRadius: 3, backgroundColor: colors.accent },
  merchWrap: { gap: spacing.sm },
  merchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  merchTotal: { ...T.bodySb, color: colors.ink },
});
