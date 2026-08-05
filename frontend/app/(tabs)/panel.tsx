/** Anasayfa — ev odaklı. Kişisel bakiye Kasa'ya taşındı; burada evin
 *  toplamı, nereye gittiği, kimin ne ödediği ve günlük akış var. */
import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import Svg, { Circle } from "react-native-svg";

import { apiGet } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, HeaderSplit, TrendBadge, Sheet, Card, Row, Divider, Avatar,
  Money, IconPill, CategoryIcon, categoryLabel, formatEUR,
} from "@/src/ui";
import { colors, spacing, radius, type as T, overline, fontFamily, CATEGORY_ICONS } from "@/src/theme";

type Expense = {
  expense_id: string; added_by: string; target_type: string; target_user_id?: string;
  total: number; merchant?: string; category?: string; source: string; expense_date?: string;
};
type Stats = {
  total: number; per_person: number; daily_average: number; projected_30d: number;
  change_pct: number | null; expense_count: number;
  categories: { key: string; total: number }[];
  merchants: { name: string; total: number }[];
};
type ShopItem = { item_id: string; text: string; added_by: string; done: boolean };

/**
 * Halka grafik — kategori dağılımı. Dikdörtgen olmayan tek görsel öğe.
 *
 * Çap aynı, çizgi ince: kalın halka pasta grafiğe yaklaşıp ağırlaşıyordu.
 * İnce halka aynı bilgiyi taşıyıp ortadaki toplama yer açıyor.
 */
function Donut({ parts, size = 108, stroke = 9 }: {
  parts: { total: number; color: string }[]; size?: number; stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const sum = parts.reduce((s, p) => s + p.total, 0) || 1;
  let offset = 0;
  return (
    <Svg width={size} height={size}>
      {/* Sessiz taban halkası: tek kategori varsa bile daire kapalı okunuyor. */}
      <Circle cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={colors.border} strokeWidth={stroke} />
      {parts.map((p, i) => {
        const len = (p.total / sum) * circ;
        const el = (
          <Circle
            key={i} cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={p.color} strokeWidth={stroke} strokeLinecap="butt"
            strokeDasharray={`${len} ${circ - len}`}
            strokeDashoffset={-offset}
            // -90°: ilk dilim tepeden başlasın
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        );
        offset += len;
        return el;
      })}
    </Svg>
  );
}

export default function Panel() {
  const { user } = useAuth();
  const { household, members, pendingMembers, refresh: refreshHH } = useHousehold();
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [totalsPaid, setTotalsPaid] = useState<Record<string, number>>({});
  const [shopping, setShopping] = useState<ShopItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [st, exp, bal, shop] = await Promise.all([
        apiGet<Stats>("/stats"),
        apiGet<{ expenses: Expense[] }>("/expenses"),
        apiGet<any>("/balances"),
        apiGet<{ items: ShopItem[] }>("/shopping?scope=household"),
        refreshHH(),
      ]);
      setStats(st);
      setExpenses(exp.expenses || []);
      setTotalsPaid(bal.totals_paid || {});
      setShopping((shop.items || []).filter((i) => !i.done));
    } catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [refreshHH]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const member = (id?: string | null) => members.find((m) => m.user_id === id);
  const firstName = (id?: string | null) => member(id)?.name?.split(" ")[0] || "?";

  const cats = (stats?.categories || []).slice(0, 4).map((c) => ({
    ...c, color: (CATEGORY_ICONS[c.key] || CATEGORY_ICONS.diger).color,
  }));

  return (
    <View style={styles.root} testID="panel-screen">
      <ScrollView
        contentContainerStyle={styles.scroll}
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
            <Pressable onPress={() => router.push("/(tabs)/profil")} testID="open-settings-btn">
              <Avatar name={user?.name} size={42} avatarId={user?.avatar_id}
                      userId={user?.user_id} photoVersion={(user as any)?.photo_version} />
              {pendingMembers.length > 0 && (
                <View style={styles.badge} testID="pending-approvals-badge">
                  <Text style={styles.badgeTxt}>{pendingMembers.length}</Text>
                </View>
              )}
            </Pressable>
          }
        >
          <Text style={styles.heroLabel}>BU DÖNEM EV HARCAMASI</Text>
          <Text style={styles.heroValue}>{formatEUR(stats?.total ?? 0)}</Text>
          {stats?.change_pct != null && <TrendBadge pct={stats.change_pct} />}
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
            <View style={{ gap: spacing.lg }}>
              {cats.length > 0 && (
                <Card title="Nereye Gitti" action="Tümü"
                      onAction={() => router.push("/harcamalar")} style={styles.mx}>
                  <View style={styles.donutRow}>
                    <View style={styles.donutWrap}>
                      <Donut parts={cats} />
                      <View style={styles.donutCenter}>
                        <Text style={styles.donutTotal}>{formatEUR(stats?.total ?? 0).replace(",00 €", " €")}</Text>
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
                        leading={<Avatar name={m.name} size={38} avatarId={(m as any).avatar_id}
                                         userId={m.user_id} photoVersion={(m as any).photo_version} />}
                        title={`${m.name}${m.user_id === user?.user_id ? " (sen)" : ""}`}
                        subtitle="ev harcaması"
                        right={<Money value={totalsPaid[m.user_id] || 0} />}
                      />
                      {i < members.length - 1 && <Divider />}
                    </View>
                  ))}
                </Card>
              )}

              <Card title="Alınacaklar" action="Tümü"
                    onAction={() => router.push("/(tabs)/liste")} style={styles.mx}>
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

              <Card title="Son Harcamalar" action="Tümü"
                    onAction={() => router.push("/harcamalar")} style={styles.mx}>
                {expenses.length === 0 ? (
                  <Row title="Henüz harcama yok" subtitle="İlk fişi tara veya elle ekle"
                       leading={<IconPill name="receipt-outline" color={colors.inkSecondary}
                                          tint={colors.surfaceSecondary} size={34} />} />
                ) : (
                  expenses.slice(0, 5).map((e, i) => {
                    const author = member(e.added_by);
                    const target = e.target_type === "household" ? "Ev"
                      : e.target_type === "self" ? "Kendim"
                      : `→ ${firstName(e.target_user_id)}`;
                    return (
                      <View key={e.expense_id}>
                        <Row
                          onPress={() => router.push("/harcamalar")}
                          testID={`expense-row-${e.expense_id}`}
                          leading={<Avatar name={author?.name} size={38} avatarId={(author as any)?.avatar_id}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  scroll: { paddingBottom: 120, backgroundColor: colors.bg, flexGrow: 1 },
  mx: { marginHorizontal: spacing.lg },
  heroLabel: { ...overline, color: colors.onDarkMuted },
  heroValue: { ...T.hero, color: colors.onDark, marginTop: spacing.xs },
  badge: {
    position: "absolute", top: -3, right: -3, minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.negative, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 5, borderWidth: 2, borderColor: colors.dark,
  },
  badgeTxt: { color: colors.onDark, fontSize: 10, lineHeight: 14, fontFamily: fontFamily.bold },
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
