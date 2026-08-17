/** Anasayfa — ev odaklı. Kişisel bakiye Kasa'ya taşındı; burada evin
 *  toplamı, nereye gittiği, kimin ne ödediği ve günlük akış var. */
import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { apiGet } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, HeaderSplit, TrendBadge, Sheet, Card, Row, Divider, Avatar,
  Money, IconPill, CategoryIcon, categoryLabel, splitBadge, splitSummary, PulseDot,
  Donut, formatEUR, formatEURShort, useScrollPad,
} from "@/src/ui";
import { ConfirmSheet } from "@/app/duzenli";
import { colors, spacing, type as T, overline, fontFamily, metrics, CATEGORY_ICONS } from "@/src/theme";

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
type Stats = {
  total: number; per_person: number; daily_average: number; projected_30d: number;
  change_pct: number | null; expense_count: number;
  categories: { key: string; total: number }[];
  merchants: { name: string; total: number }[];
};
type ShopItem = { item_id: string; text: string; added_by: string; done: boolean };

export default function Panel() {
  // Sekme cubugunun ve telefonun gezinme cubugunun kapladigi yer.
  // Elle yazilan 120/130 sabitleri cubuk yuksekligiyle birlikte
  // degismiyordu; olcu artik tek yerden geliyor.
  const altPay = useScrollPad({ tabs: true });
  const { user } = useAuth();
  const { household, members, refresh: refreshHH } = useHousehold();
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
      const [st, exp, bal, shop, ntf, rec] = await Promise.all([
        apiGet<Stats>("/stats"),
        apiGet<{ expenses: Expense[] }>("/expenses"),
        apiGet<any>("/balances"),
        apiGet<{ items: ShopItem[] }>("/shopping?scope=household"),
        apiGet<{ unread: number }>("/notifications"),
        apiGet<{ due: Due[] }>("/recurring"),
        refreshHH(),
      ]);
      setStats(st);
      setExpenses(exp.expenses || []);
      setTotalsPaid(bal.totals_paid || {});
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
        contentContainerStyle={[styles.scroll, altPay]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}
                          tintColor={colors.dark} progressBackgroundColor={colors.surface} />
        }
      >
        <ScreenHeader
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
          <Text style={styles.heroLabel}>BU DÖNEM EV HARCAMASI</Text>
          <Text style={styles.heroValue}>{formatEUR(stats?.total ?? 0)}</Text>
          <TrendBadge
            pct={stats?.change_pct}
            onPress={() => router.push("/istatistik")}
            testID="open-stats-btn"
          />
          <HeaderSplit
            items={[
              { label: "Kişi başı", value: formatEUR(stats?.per_person ?? 0) },
              { label: "Ay sonu tahmini", value: formatEUR(stats?.projected_30d ?? 0) },
            ]}
          />
        </ScreenHeader>

        <Sheet>
          {loading ? (
            <ActivityIndicator color={colors.dark} style={{ marginTop: spacing.xxl }} />
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

              {cats.length > 0 && (
                <Card title="Nereye Gitti" action="Tümü"
                      onAction={() => router.push("/istatistik")} style={styles.mx}>
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
