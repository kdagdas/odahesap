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
import Svg, { Circle, Path, Line as SvgLine, Text as SvgText } from "react-native-svg";
import { apiGet } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, Sheet, Card, Row, Divider, Avatar, Money, CategoryIcon,
  categoryLabel, MerchantBadge, Donut, formatEUR, formatEURShort,
} from "@/src/ui";
import {
  colors, spacing, radius, type as T, overline, fontFamily, metrics, CATEGORY_ICONS,
} from "@/src/theme";

type Monthly = {
  month: string; total: number; expense_count: number;
  prev_total: number; prev_month?: string; change_pct: number | null;
  fixed: number; variable: number; per_person: number; member_count: number;
  my_share: number; my_personal: number;
  categories: { key: string; total: number; prev_total: number; change_pct: number | null }[];
  merchants: { name: string; total: number }[];
  by_member: { user_id: string; total: number }[];
  cumulative: { day: string; total: number }[];
  prev_cumulative: { day: string; total: number }[];
  months: string[];
};

/**
 * Biriken harcama eğrisi — bu ay dolu, geçen ay kesikli gölge.
 *
 * Günlük çubukların yerine geçti: çubuklar az harcamada seyrek ve çirkin
 * duruyordu, biriken eğri tek harcamada bile düzgün. Daha iyi bir soruya da
 * cevap veriyor — "geçen ayın bu gününde neredeydik?"
 */
function Curve({ now, prev, height = 132 }: {
  now: { day: string; total: number }[];
  prev: { day: string; total: number }[];
  height?: number;
}) {
  const W = 300, H = height, padL = 40, padB = 18, padT = 8;
  const max = Math.max(1, now.at(-1)?.total ?? 0, prev.at(-1)?.total ?? 0);
  const plotW = W - padL - 8;
  const plotH = H - padB - padT;
  const path = (rows: { total: number }[], upto?: number) => {
    const list = upto != null ? rows.slice(0, upto) : rows;
    if (!list.length) return "";
    return list.map((r, i) => {
      const x = padL + (i / Math.max(rows.length - 1, 1)) * plotW;
      const y = padT + plotH - (r.total / max) * plotH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");
  };
  // Bu ay henüz bitmediyse eğri bugünde duruyor: ayın sonuna kadar düz bir
  // çizgi çekmek "harcama durdu" demek olurdu, oysa gün gelmedi.
  const today = new Date().toISOString().slice(0, 10);
  const upto = now.findIndex((r) => r.day > today);
  const shown = upto === -1 ? now.length : Math.max(upto, 1);
  const last = now[shown - 1];
  const lastX = padL + ((shown - 1) / Math.max(now.length - 1, 1)) * plotW;
  const lastY = padT + plotH - ((last?.total ?? 0) / max) * plotH;

  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      {[0, 0.5, 1].map((f) => (
        <SvgLine key={f} x1={padL} y1={padT + plotH * f} x2={W - 8} y2={padT + plotH * f}
                 stroke={colors.divider} strokeWidth={1} />
      ))}
      {[1, 0.5, 0].map((f) => (
        <SvgText key={f} x={padL - 6} y={padT + plotH * (1 - f) + 4} textAnchor="end"
                 fontSize={9} fill={colors.inkTertiary}>
          {formatEURShort(max * f)}
        </SvgText>
      ))}
      {prev.length > 1 && (
        <Path d={path(prev)} fill="none" stroke={colors.inkTertiary}
              strokeWidth={1.6} strokeDasharray="4 4" />
      )}
      <Path d={path(now, shown)} fill="none" stroke={colors.dark}
            strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      {last && <Circle cx={lastX} cy={lastY} r={4} fill={colors.dark} />}
      <SvgText x={padL} y={H - 4} fontSize={9} fill={colors.inkTertiary}>1</SvgText>
      <SvgText x={W - 8} y={H - 4} textAnchor="end" fontSize={9} fill={colors.inkTertiary}>
        {now.length}
      </SvgText>
    </Svg>
  );
}

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
  const cats = (data?.categories || []).map((c) => ({
    total: c.total, color: (CATEGORY_ICONS[c.key] || CATEGORY_ICONS.diger).color,
  }));
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
                {/* Halka ve kategori dokumu TEK kartta. Listedeki renk noktasi
                    halkanin dilimiyle eslesiyor, yani liste ayni zamanda
                    aciklama gorevi goruyor -- ayri bir legend satirina gerek
                    kalmiyor. Ay-ay degisim de ayni satirda: "neye gitti" ve
                    "neresi degisti" ayni soru. */}
                {data.categories.length > 0 && (
                  <Card title="Nereye Gitti" style={styles.mx}>
                    <View style={styles.donutWrap}>
                      <Donut parts={cats} size={148} stroke={13}>
                        <View style={{ alignItems: "center" }}>
                          <Text style={styles.donutTotal}>{formatEURShort(data.total)}</Text>
                          <Text style={styles.donutSub}>{data.expense_count} harcama</Text>
                        </View>
                      </Donut>
                    </View>
                    {data.categories.map((cat, i) => (
                      <View key={cat.key}>
                        <Divider inset={i === 0 ? 0 : spacing.lg} />
                        <View style={styles.catRow}>
                          <View style={[styles.catDot, {
                            backgroundColor: (CATEGORY_ICONS[cat.key] || CATEGORY_ICONS.diger).color,
                          }]} />
                          <Text style={styles.catName} numberOfLines={1}>
                            {categoryLabel(cat.key)}
                          </Text>
                          {cat.change_pct === null ? (
                            <View style={[styles.deltaTag, { backgroundColor: colors.infoSoft }]}>
                              <Text style={[styles.deltaTxt, { color: colors.onInfo }]}>yeni</Text>
                            </View>
                          ) : Math.abs(cat.change_pct) >= 5 ? (
                            <View style={[styles.deltaTag, {
                              backgroundColor: cat.change_pct > 0 ? colors.negativeSoft : colors.accentSoft,
                            }]}>
                              <Text style={[styles.deltaTxt, {
                                color: cat.change_pct > 0 ? colors.negative : colors.accentDark,
                              }]}>
                                {cat.change_pct > 0 ? "↑" : "↓"} %{Math.abs(cat.change_pct)}
                              </Text>
                            </View>
                          ) : null}
                          <Money value={cat.total} style={styles.catValue} />
                        </View>
                      </View>
                    ))}
                  </Card>
                )}

                <Card title="Ay Boyunca" style={styles.mx} padded>
                  <Curve now={data.cumulative} prev={data.prev_cumulative} />
                  <View style={styles.curveLegend}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendLine, { backgroundColor: colors.dark }]} />
                      <Text style={styles.legendLabel}>bu ay {formatEURShort(data.total)}</Text>
                    </View>
                    {data.prev_total > 0 && (
                      <View style={styles.legendItem}>
                        <View style={[styles.legendLine, styles.legendDashed]} />
                        <Text style={styles.legendLabel}>
                          geçen ay {formatEURShort(data.prev_total)}
                        </Text>
                      </View>
                    )}
                  </View>
                </Card>

                {/* Senin toplam cikisin: ev payin + kisiselin. Oran degil
                    toplam -- "kisiselin evin yuzde 35'i" garip bir sayi,
                    "bu ay toplam su kadar harcadin" gercek bir soruya cevap. */}
                {scope === "household" && (
                  <Card title="Senin Çıkışın" style={styles.mx} padded>
                    <View style={styles.outRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.legendLabel}>Ev payın</Text>
                        <Text style={styles.outValue}>{formatEUR(data.my_share)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.legendLabel}>Kişisel</Text>
                        <Text style={styles.outValue}>{formatEUR(data.my_personal)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.legendLabel}>Toplam</Text>
                        <Text style={[styles.outValue, { color: colors.accentDark }]}>
                          {formatEUR(data.my_share + data.my_personal)}
                        </Text>
                      </View>
                    </View>
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
  donutWrap: { alignItems: "center", paddingVertical: spacing.lg },
  donutTotal: { ...T.emph, fontSize: 20, color: colors.ink },
  donutSub: { ...T.caption, color: colors.inkTertiary },
  catDot: { width: 9, height: 9, borderRadius: 5 },
  catValue: { minWidth: 74, textAlign: "right" },
  deltaTag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.sm },
  deltaTxt: { fontSize: 11, lineHeight: 15, fontFamily: fontFamily.medium },
  curveLegend: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.sm },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendLine: { width: 14, height: 2, borderRadius: 1 },
  legendDashed: { backgroundColor: colors.inkTertiary, opacity: 0.7 },
  legendLabel: { ...T.caption, color: colors.inkTertiary },
  outRow: { flexDirection: "row", gap: spacing.md },
  outValue: { ...T.bodySb, fontSize: 16, color: colors.ink, marginTop: 2 },
  foot: { ...T.caption, color: colors.inkTertiary, marginTop: spacing.md,
          paddingHorizontal: spacing.lg, paddingBottom: spacing.md, lineHeight: 17 },
  catRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 50,
  },
  catName: { ...T.body, color: colors.ink, flex: 1 },
  merchWrap: { gap: spacing.sm },
  merchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  merchTotal: { ...T.bodySb, color: colors.ink },
});
