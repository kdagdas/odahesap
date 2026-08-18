/** Anasayfa — ev odaklı. Kişisel bakiye Kasa'ya taşındı; burada evin
 *  toplamı, nereye gittiği, kimin ne ödediği ve günlük akış var. */
import { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { apiGet } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, Sheet, Card, Row, Divider, Avatar,
  Money, IconPill, CategoryIcon, categoryLabel, splitBadge, splitSummary, PulseDot,
  Donut, formatEUR, formatEURShort, useScrollPad, useBasaSar, ayDe, buAy, degisimTxt,
} from "@/src/ui";
import { ConfirmSheet } from "@/app/duzenli";
import {
  colors, spacing, radius, type as T, overline, fontFamily, metrics, CATEGORY_ICONS,
} from "@/src/theme";

type Expense = {
  expense_id: string; added_by: string; target_type: string; target_user_id?: string;
  split_mode?: string; split_with?: Record<string, number> | null;
  total: number; merchant?: string; category?: string; source: string; expense_date?: string;
};
type Due = {
  recurring_id: string; name: string; amount: number; amount_fixed: boolean;
  day_of_month: number; scope: "household" | "self"; due_period: string | null;
  split_mode: "equal" | "exact"; split_with: Record<string, number>;
};
/** `/stats/monthly` — Anasayfa da İstatistik de **aynı ucu** okuyor.
 *
 *  Önceden Anasayfa dönem bazlı `/stats`'ı okuyordu: aynı olay iki ekranda
 *  iki farklı rakam gösteriyordu. Dönem para hesabına indi, görüntülemenin
 *  her yeri takvim ayı oldu. */
type Stats = {
  month: string; total: number; expense_count: number;
  change_pct: number | null; prev_same_day: number; elapsed_days: number;
  my_share: number; my_personal: number;
  categories: { key: string; total: number }[];
  by_member: { user_id: string; total: number }[];
};
type ShopItem = { item_id: string; text: string; added_by: string; done: boolean };

export default function Panel() {
  // Sekme cubugunun ve telefonun gezinme cubugunun kapladigi yer.
  // Elle yazilan 120/130 sabitleri cubuk yuksekligiyle birlikte
  // degismiyordu; olcu artik tek yerden geliyor.
  const altPay = useScrollPad({ tabs: true });
  const scrollRef = useRef<ScrollView>(null);
  useBasaSar(scrollRef);
  const { user } = useAuth();
  const { household, members, activePeriod, refresh: refreshHH } = useHousehold();
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [totalsPaid, setTotalsPaid] = useState<Record<string, number>>({});
  const [shopping, setShopping] = useState<ShopItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [due, setDue] = useState<Due[]>([]);
  const [confirming, setConfirming] = useState<Due | null>(null);
  // PulseDot her değiştiğinde yeniden atıyor; ekran odaklandıkça artıyor,
  // yani uygulamayı her açışta hatırlatma tekrarlanıyor ama sürekli
  // yanıp sönen bir animasyon çalışmıyor.
  const [focusTick, setFocusTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [st, exp, shop, ntf, rec] = await Promise.all([
        apiGet<Stats>("/stats/monthly"),
        apiGet<{ expenses: Expense[] }>("/expenses"),
        apiGet<{ items: ShopItem[] }>("/shopping?scope=household"),
        apiGet<{ unread: number }>("/notifications"),
        apiGet<{ due: Due[] }>("/recurring"),
        refreshHH(),
      ]);
      setStats(st);
      setExpenses(exp.expenses || []);
      // "Kim ne kadar ödedi" de aya geçti; `/balances` çağrısı gereksizleşti.
      setTotalsPaid(Object.fromEntries(
        (st.by_member || []).map((m) => [m.user_id, m.total])));
      setShopping((shop.items || []).filter((i) => !i.done));
      setUnread(ntf.unread || 0);
      setDue(rec.due || []);
    } catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [refreshHH]);

  useFocusEffect(useCallback(() => { load(); setFocusTick((t) => t + 1); }, [load]));

  const member = (id?: string | null) => members.find((m) => m.user_id === id);
  const firstName = (id?: string | null) => member(id)?.name?.split(" ")[0] || "?";

  const cats = (stats?.categories || []).slice(0, 4).map((c) => ({
    ...c, color: (CATEGORY_ICONS[c.key] || CATEGORY_ICONS.diger).color,
  }));

  return (
    <View style={styles.root} testID="panel-screen">
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.scroll, altPay]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}
                          tintColor={colors.ink} progressBackgroundColor={colors.surface} />
        }
      >
        <ScreenHeader
          size="l"
          overline="EV"
          title={household?.name || "—"}
          right={
            /* Avatar buradan kaldırıldı: alt menüdeki Profil sekmesi zaten aynı
               yere gidiyordu, iki kapı "ayarları nereden açmıştım" sorusunu
               doğuruyordu. Zil ise kimsenin yapmadığı bir işi yapıyor —
               kaçırılan bildirimlere bakmak. */
            <Pressable onPress={() => router.push("/aktivite")} testID="open-activity-btn"
                       style={styles.bellBtn} hitSlop={8}>
              <Ionicons name="notifications-outline" size={20} color={colors.onDark} />
              {unread > 0 && (
                <View style={styles.badge} testID="activity-badge">
                  <Text style={styles.badgeTxt}>{unread > 9 ? "9+" : unread}</Text>
                </View>
              )}
            </Pressable>
          }
        >
          <Text style={styles.heroLabel}>{ayDe(stats?.month || buAy())} EV HARCAMASI</Text>
          <Text style={styles.heroValue}>{formatEUR(stats?.total ?? 0)}</Text>
          {/* Trend bir HAP değil bir SATIR: ana rakamın hemen altında, aynı
              sola dayalı, yani öznesini komşuluktan alıyor. Ortada duran ve
              öznesiz bir rozet "neyin %12'si" sorusunu bırakıyordu.

              Karşılaştırılan tutar YAZILI. Görünen sayı doğrulanabilir
              olmalı; "%12" tek başına hiçbir şey söylemiyor.

              Hesap AYNI GÜNE göre: önceden bu ayın şu ana kadarki toplamı
              geçen ayın TAM toplamıyla karşılaştırılıyordu ve ayın 5'inde
              bakan herkes "%80 azalış" görüyordu.

              Karşılaştırılacak geçmiş yoksa satır HİÇ çizilmiyor -- dolgu
              metni yok, uydurma yok; yeni evde başlık bir tık kısa kalıyor.

              Tıklanabilir, çünkü bu satırı okuyanın aklından geçen soru
              "neden?" ve cevabı eğride. Merak ile kapı aynı yerde. */}
          {stats?.change_pct != null && (
            <Pressable style={styles.trendRow} hitSlop={8} testID="open-stats-trend"
                       onPress={() => router.push("/istatistik")}>
              <Ionicons
                name={stats.change_pct >= 0 ? "trending-up" : "trending-down"}
                size={13} color={colors.accentOnDark}
              />
              <Text style={styles.trendPct}>{degisimTxt(stats.change_pct)}</Text>
              <Text style={styles.trendPrev} numberOfLines={1}>
                · geçen ay bugün {formatEURShort(stats.prev_same_day)}
              </Text>
            </Pressable>
          )}
        </ScreenHeader>

        <Sheet>
          {loading ? (
            <ActivityIndicator color={colors.ink} style={{ marginTop: spacing.xxl }} />
          ) : (
            <View style={{ gap: metrics.cardGap }}>
              {/* Vadesi gelen düzenli ödemeler. Onaylanmadan hiçbir kayıt
                  oluşmuyor; kart yalnızca bekleyen varsa çıkıyor.

                  En üstte, koyu başlığın hemen altında: bu bir iş ve
                  yapılınca kart kayboluyor. Normal günlerde ekran eskisi
                  gibi, çünkü bekleyen yoksa hiç çizilmiyor. */}
              {due.length > 0 && (
                <Card
                  title={`Vadesi Gelenler · ${due.length}`}
                  lead={<PulseDot trigger={focusTick} testID="due-dot" />}
                  action={due.length > 3 ? `Tümü · +${due.length - 3}` : undefined}
                  onAction={() => router.push("/duzenli")}
                  style={styles.mx}
                  testID="due-card"
                >
                  {due.slice(0, 3).map((d, i) => (
                    <View key={d.recurring_id}>
                      {i > 0 && <Divider />}
                      <Pressable style={styles.dueRow} onPress={() => setConfirming(d)}
                                 testID={`due-row-${d.recurring_id}`}>
                        <View style={styles.dayBox}>
                          <Text style={styles.dayTxt}>{d.day_of_month}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.dueTitle}>{d.name}</Text>
                          <Text style={styles.dueSub} numberOfLines={1}>
                            {d.scope === "self"
                              ? "Sadece ben"
                              : splitSummary({ mode: d.split_mode, with: d.split_with },
                                             members, user?.user_id)}
                            {d.amount_fixed ? "" : " · değişken"}
                          </Text>
                        </View>
                        <Money value={d.amount} />
                        <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceTertiary} />
                      </Pressable>
                    </View>
                  ))}
                </Card>
              )}

              {/* Kart artık ayın tamamını anlatıyor: ev nereye harcadı → sana
                  ne düştü → devamı için kapı. Tek özne akışı, kartın
                  ortasında konu değişmiyor.

                  Kapı KOYU DÜĞME değil alt satır: uygulamanın kuralı
                  "sayfada tek koyu düğme" ve Anasayfa'nın birincil eylemi
                  ortadaki fiş tarama. Ama başlıktaki sönük hapa göre çok
                  daha büyük bir hedef -- İstatistik'in keşfedilmeme sebebi
                  oraya giden tek kapının bir fısıltı olmasıydı. */}
              {cats.length > 0 && (
                <Card title="Nereye Gitti" style={styles.mx}>
                  <View style={styles.donutRow}>
                    <View style={styles.donutWrap}>
                      <Donut parts={cats} />
                      <View style={styles.donutCenter}>
                        <Text style={styles.donutTotal}>{formatEURShort(stats?.total ?? 0)}</Text>
                        <Text style={styles.donutSub}>{stats?.expense_count} harcama</Text>
                      </View>
                    </View>
                    <View style={{ flex: 1, gap: spacing.sm }}>
                      {cats.map((c) => (
                        <View key={c.key} style={styles.legend}>
                          <CategoryIcon category={c.key} size={26} />
                          <Text style={styles.legendTxt} numberOfLines={1}>{categoryLabel(c.key)}</Text>
                          <Money value={c.total} style={styles.legendVal} />
                        </View>
                      ))}
                    </View>
                  </View>

                  <Divider inset={0} />
                  {/* "Sana düşen" = ev harcamalarından payına düşen, kim
                      ödemiş olursa olsun. "Ödediğin" değil -- o Kasa'da ve
                      ikisinin farkı bakiyen. "Pay" kelimesi bunu
                      öğretmiyordu.

                      Kişisel SIFIRSA sütun çizilmiyor: kendine hiç harcama
                      girmeyen biri için kalıcı duvar kâğıdı olurdu.
                      (Kasa'daki sıfır sütunu gizleme kuralının aynısı.) */}
                  <View style={styles.mineRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.mineLabel}>SANA DÜŞEN</Text>
                      <Text style={styles.mineValue}>{formatEUR(stats?.my_share ?? 0)}</Text>
                    </View>
                    {(stats?.my_personal ?? 0) > 0.005 && (
                      <>
                        <View style={styles.mineSep} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.mineLabel}>KİŞİSEL</Text>
                          <Text style={styles.mineValue}>{formatEUR(stats!.my_personal)}</Text>
                        </View>
                      </>
                    )}
                  </View>

                  <Divider inset={0} />
                  <Pressable style={styles.doorRow} testID="open-stats-btn"
                             onPress={() => router.push("/istatistik")}>
                    <Ionicons name="stats-chart" size={15} color={colors.accentDark} />
                    <Text style={styles.doorTxt}>Tüm istatistikler</Text>
                    <Ionicons name="chevron-forward" size={15} color={colors.onSurfaceTertiary} />
                  </Pressable>
                </Card>
              )}

              {members.length > 0 && (
                <Card title="Kim Ne Kadar Ödedi" style={styles.mx}>
                  {members.map((m, i) => (
                    <View key={m.user_id}>
                      <Row
                        leading={<Avatar name={m.name} avatarId={(m as any).avatar_id}
                                         userId={m.user_id} photoVersion={(m as any).photo_version} />}
                        title={`${m.name}${m.user_id === user?.user_id ? " (sen)" : ""}`}
                        right={<Money value={totalsPaid[m.user_id] || 0} />}
                      />
                      {i < members.length - 1 && <Divider />}
                    </View>
                  ))}
                </Card>
              )}

              <Card title="Alınacaklar"
                    action={shopping.length > 3 ? `Tümü · +${shopping.length - 3}` : "Tümü"}
                    onAction={() => router.push("/(tabs)/liste?scope=household")}
                    style={styles.mx}>
                {shopping.length === 0 ? (
                  <Row title="Liste temiz" subtitle="Eve lazım olanı yazın, markete giden görsün"
                       leading={<IconPill name="checkmark" color={colors.accent}
                                          tint={colors.accentSoft} size={34} />} />
                ) : (
                  shopping.slice(0, 3).map((it, i) => (
                    <View key={it.item_id}>
                      <Row
                        minHeight={46}
                        leading={<View style={styles.check} />}
                        title={<Text style={styles.itemTxt}>{it.text}</Text>}
                        right={<Text style={styles.itemWho}>
                          {it.added_by === user?.user_id ? "sen" : firstName(it.added_by)}
                        </Text>}
                      />
                      {i < Math.min(shopping.length, 3) - 1 && <Divider inset={58} />}
                    </View>
                  ))
                )}
              </Card>

              <Card title="Son Harcamalar"
                    action={expenses.length > 5 ? `Tümü · +${expenses.length - 5}` : "Tümü"}
                    onAction={() => router.push("/harcamalar")} style={styles.mx}>
                {expenses.length === 0 ? (
                  <Row title="Henüz harcama yok" subtitle="İlk fişi tara veya elle ekle"
                       leading={<IconPill name="receipt-outline" color={colors.inkSecondary}
                                          tint={colors.surfaceSecondary} size={34} />} />
                ) : (
                  expenses.slice(0, 5).map((e, i) => {
                    const author = member(e.added_by);
                    const target = splitBadge(e, members, user?.user_id).txt;
                    return (
                      <View key={e.expense_id}>
                        <Row
                          onPress={() => router.push("/harcamalar")}
                          testID={`expense-row-${e.expense_id}`}
                          leading={<Avatar name={author?.name} avatarId={(author as any)?.avatar_id}
                                           userId={author?.user_id} photoVersion={(author as any)?.photo_version} />}
                          title={author?.name || "Bilinmeyen"}
                          subtitle={`${e.merchant || (e.source === "receipt" ? "Fiş" : "Manuel")} · ${target}`}
                          right={<Money value={e.total} />}
                        />
                        {i < Math.min(expenses.length, 5) - 1 && <Divider />}
                      </View>
                    );
                  })
                )}
              </Card>
            </View>
          )}
        </Sheet>
      </ScrollView>

      {confirming && (
        <ConfirmSheet
          tpl={confirming as any}
          members={members}
          meId={user?.user_id}
          onClose={() => setConfirming(null)}
          onDone={() => { setConfirming(null); load(); }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  scroll: { backgroundColor: colors.bg, flexGrow: 1 },
  mx: { marginHorizontal: spacing.lg },
  heroLabel: { ...overline, color: colors.onDarkMuted },
  heroHint: { ...T.caption, color: colors.onDarkMuted, marginTop: 2 },
  trendRow: {
    flexDirection: "row", alignItems: "center", gap: 5,
    alignSelf: "flex-start", marginTop: 3,
  },
  trendPct: { ...T.captionSb, color: colors.accentOnDark },
  trendPrev: { ...T.caption, color: colors.onDarkMuted, flexShrink: 1 },
  mineRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  mineLabel: { ...overline, fontSize: 10, color: colors.inkTertiary },
  mineValue: { ...T.bodySb, fontSize: 16, color: colors.ink, marginTop: 1 },
  mineSep: { width: 1, height: 30, backgroundColor: colors.divider, marginHorizontal: spacing.lg },
  doorRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 44,
  },
  doorTxt: { ...T.bodySb, color: colors.accentDark, flex: 1 },
  statsPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: colors.darkSurface, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 6,
  },
  statsPillTxt: { ...T.captionSb, color: colors.onDark },
  heroValue: { ...T.hero, color: colors.onDark, marginTop: spacing.xs },
  bellBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: colors.darkSurface,
    alignItems: "center", justifyContent: "center",
  },
  badge: {
    position: "absolute", top: -3, right: -3, minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.negative, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 5, borderWidth: 2, borderColor: colors.dark,
  },
  badgeTxt: { color: colors.onDark, fontSize: 10, lineHeight: 14, fontFamily: fontFamily.bold },
  dueRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 60,
  },
  dayBox: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  dayTxt: { ...T.bodySb, color: colors.ink },
  dueTitle: { ...T.emph, color: colors.ink },
  dueSub: { ...T.caption, color: colors.onSurfaceTertiary, marginTop: 1 },
  donutRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg,
              paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  donutWrap: { width: 108, height: 108, alignItems: "center", justifyContent: "center" },
  donutCenter: { position: "absolute", alignItems: "center" },
  donutTotal: { ...T.bodySb, color: colors.ink },
  donutSub: { fontSize: 10, lineHeight: 13, fontFamily: fontFamily.regular, color: colors.inkTertiary },
  legend: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  legendTxt: { ...T.caption, color: colors.inkSecondary, flex: 1 },
  legendVal: { ...T.caption, fontFamily: fontFamily.semibold, color: colors.ink },
  check: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.borderStrong },
  itemTxt: { ...T.body, color: colors.ink },
  itemWho: { ...T.caption, color: colors.inkTertiary },
});
