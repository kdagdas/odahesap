import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiGet, apiDelete } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import { Card, Chip, Avatar, CategoryIcon, MerchantBadge, formatEUR, formatDateTR } from "@/src/ui";
import { colors, spacing, radius, font } from "@/src/theme";

type Item = { name: string; price: number; quantity?: number; category: string };
type Expense = {
  expense_id: string; added_by: string; target_type: string; target_user_id?: string;
  total: number; merchant?: string; category?: string; source: string;
  created_at: string; expense_date?: string;
  items?: Item[]; notes?: string;
};
type Period = { period_id: string; started_at: string; closed_at: string | null; status: string };

const periodLabel = (p: Period, idx: number, total: number) => {
  const d = new Date(p.started_at);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const y = d.getFullYear();
  return `${p.status === "active" ? "Aktif · " : ""}Dönem #${total - idx} (${m}.${y})`;
};

// Was a tab; the shopping list earns that slot because it is used daily while
// this history is opened occasionally. Reached from "Tümü" on the home screen.
export default function Harcamalar() {
  const { user } = useAuth();
  const router = useRouter();
  const { members, activePeriod } = useHousehold();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string | undefined>(undefined);
  const [memberFilter, setMemberFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const pers = await apiGet("/periods");
      setPeriods(pers.periods || []);
      const pid = selectedPeriod || activePeriod?.period_id;
      const q = new URLSearchParams();
      if (pid) q.set("period_id", pid);
      if (memberFilter) q.set("member_id", memberFilter);
      const exp = await apiGet(`/expenses?${q.toString()}`);
      setExpenses(exp.expenses || []);
    } catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [selectedPeriod, memberFilter, activePeriod]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onDelete = async (id: string) => {
    try { await apiDelete(`/expenses/${id}`); load(); } catch (e) { console.log(e); }
  };

  const activePeriodId = activePeriod?.period_id;
  const currentPeriodId = selectedPeriod || activePeriodId;

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="harcamalar-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="harcamalar-back">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Harcamalar</Text>
          <Text style={styles.subtitle}>Süzgeçler ile geçmişe göz at</Text>
        </View>
      </View>

      <View style={styles.chipRowWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Chip label="Herkes" active={!memberFilter} onPress={() => setMemberFilter(undefined)} icon="people" testID="filter-all-members" />
          {members.map((m) => (
            <Chip
              key={m.user_id}
              label={m.name.split(" ")[0]}
              active={memberFilter === m.user_id}
              onPress={() => setMemberFilter(memberFilter === m.user_id ? undefined : m.user_id)}
              testID={`filter-member-${m.user_id}`}
            />
          ))}
        </ScrollView>
      </View>

      <View style={styles.chipRowWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {periods.map((p, i) => (
            <Chip
              key={p.period_id}
              label={periodLabel(p, i, periods.length)}
              active={(selectedPeriod || activePeriodId) === p.period_id}
              onPress={() => setSelectedPeriod(p.period_id === activePeriodId ? undefined : p.period_id)}
              icon={p.status === "active" ? "flash" : "archive"}
              testID={`filter-period-${p.period_id}`}
            />
          ))}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
      >
        {currentPeriodId !== activePeriodId && (
          <View style={styles.archivedBanner} testID="archived-banner">
            <Ionicons name="archive-outline" size={16} color={colors.onBrandSoft} />
            <Text style={styles.archivedTxt}>Kapatılmış dönem görüntüleniyor</Text>
          </View>
        )}
        {loading ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
        ) : expenses.length === 0 ? (
          <View style={styles.empty} testID="expenses-empty">
            <Ionicons name="file-tray-outline" size={44} color={colors.onSurfaceTertiary} />
            <Text style={styles.emptyTitle}>Bu dönemde harcama yok</Text>
          </View>
        ) : (
          expenses.map((e) => {
            const author = members.find((m) => m.user_id === e.added_by);
            const targetChip = e.target_type === "household" ? { txt: "Ev", color: colors.brand, bg: colors.brandSoft }
              : e.target_type === "self" ? { txt: "Kendim", color: colors.amber, bg: "#FEF3C7" }
              : { txt: `→ ${members.find((m) => m.user_id === e.target_user_id)?.name?.split(" ")[0] || "?"}`, color: colors.sky, bg: "#DBEAFE" };
            const expanded = expandedId === e.expense_id;
            return (
              <Pressable
                key={e.expense_id}
                onPress={() => setExpandedId(expanded ? null : e.expense_id)}
                testID={`expense-item-${e.expense_id}`}
              >
                <Card style={styles.expCard}>
                  <View style={styles.expTop}>
                    <Avatar name={author?.name || "?"} size={40} avatarId={(author as any)?.avatar_id} userId={author?.user_id} photoVersion={(author as any)?.photo_version} />
                    <View style={{ flex: 1, gap: 4 }}>
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
                      <View style={styles.metaRow}>
                        <View style={[styles.targetPill, { backgroundColor: targetChip.bg }]}>
                          <Text style={[styles.targetPillTxt, { color: targetChip.color }]}>{targetChip.txt}</Text>
                        </View>
                        {e.expense_date && (
                          <>
                            <Text style={styles.expDot}>·</Text>
                            <Text style={styles.expSubtle}>{formatDateTR(e.expense_date)}</Text>
                          </>
                        )}
                      </View>
                    </View>
                    <Text style={styles.expAmount}>{formatEUR(e.total)}</Text>
                  </View>
                  {expanded && (
                    <View style={styles.expDetails}>
                      {(e.items || []).map((it, i) => (
                        <View key={i} style={styles.itemRow}>
                          <CategoryIcon category={it.category} size={16} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.itemName} numberOfLines={1}>{it.name}</Text>
                            {(it.quantity || 1) !== 1 && (
                              <Text style={styles.itemQty}>{it.quantity} adet × {formatEUR(it.price)}</Text>
                            )}
                          </View>
                          <Text style={styles.itemPrice}>{formatEUR((it.quantity || 1) * it.price)}</Text>
                        </View>
                      ))}
                      {e.notes && <Text style={styles.notes}>💬 {e.notes}</Text>}
                      {e.added_by === user?.user_id && (
                        <Pressable style={styles.deleteBtn} onPress={() => onDelete(e.expense_id)} testID={`delete-expense-${e.expense_id}`}>
                          <Ionicons name="trash-outline" size={14} color={colors.error} />
                          <Text style={styles.deleteTxt}>Sil</Text>
                        </Pressable>
                      )}
                    </View>
                  )}
                </Card>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceAlt },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  title: { fontSize: 26, fontWeight: font.weights.bold, color: colors.onSurface, letterSpacing: -0.3 },
  subtitle: { fontSize: font.sizes.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  chipRowWrap: { height: 56, justifyContent: "center", marginTop: spacing.sm },
  chipRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: "center" },
  scroll: { padding: spacing.lg, gap: spacing.sm, paddingBottom: 120 },
  archivedBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brandSoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  archivedTxt: { color: colors.onBrandSoft, fontSize: font.sizes.base, fontWeight: font.weights.semibold },
  empty: { alignItems: "center", paddingVertical: spacing.xxxl, gap: spacing.sm },
  emptyTitle: { fontSize: font.sizes.lg, color: colors.onSurfaceSecondary, fontWeight: font.weights.semibold },
  expCard: { padding: spacing.md, gap: spacing.md },
  expTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  expTitle: { fontSize: font.sizes.base, fontWeight: font.weights.semibold, color: colors.onSurface },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  targetPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm },
  targetPillTxt: { fontSize: 11, fontWeight: font.weights.bold, letterSpacing: 0.3 },
  expSubtle: { fontSize: font.sizes.sm, color: colors.onSurfaceTertiary },
  expDot: { color: colors.onSurfaceTertiary },
  expAmount: { fontSize: font.sizes.lg, fontWeight: font.weights.bold, color: colors.onSurface },
  expDetails: { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.md, gap: spacing.sm },
  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  itemName: { fontSize: font.sizes.base, color: colors.onSurface },
  itemQty: { fontSize: font.sizes.sm, color: colors.onSurfaceTertiary, marginTop: 1 },
  itemPrice: { fontSize: font.sizes.base, color: colors.onSurface, fontWeight: font.weights.semibold },
  notes: { fontSize: font.sizes.sm, color: colors.onSurfaceSecondary, fontStyle: "italic" },
  deleteBtn: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: "#FEE2E2" },
  deleteTxt: { color: colors.error, fontWeight: font.weights.semibold, fontSize: font.sizes.sm },
});
