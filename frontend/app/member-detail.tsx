/** Member detail drill-down: what a given roommate spent for the household in a period. */
import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiGet } from "@/src/api";
import { useHousehold } from "@/src/household";
import { Card, Avatar, CategoryIcon, MerchantBadge, formatEUR, formatDateTR } from "@/src/ui";
import { colors, spacing, radius, font } from "@/src/theme";

type Item = { name: string; price: number; quantity?: number; category: string };
type Expense = {
  expense_id: string; added_by: string; target_type: string; target_user_id?: string;
  total: number; merchant?: string; category?: string; source: string;
  expense_date?: string; created_at: string; items?: Item[]; notes?: string;
};

export default function MemberDetail() {
  const { memberId, periodId } = useLocalSearchParams<{ memberId: string; periodId?: string }>();
  const router = useRouter();
  const { members } = useHousehold();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [householdTotal, setHouseholdTotal] = useState(0);
  const [roommateTotal, setRoommateTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      if (periodId) q.set("period_id", periodId as string);
      const res = await apiGet<any>(`/members/${memberId}/expenses?${q.toString()}`);
      setExpenses(res.expenses || []);
      setHouseholdTotal(res.household_total || 0);
      setRoommateTotal(res.roommate_total || 0);
    } catch (e) { console.log(e); }
    finally { setLoading(false); }
  }, [memberId, periodId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const member = members.find((m) => m.user_id === memberId);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="member-detail-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="member-detail-back" hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Avatar name={member?.name || "?"} size={36} avatarId={(member as any)?.avatar_id} />
          <View>
            <Text style={styles.title}>{member?.name}</Text>
            <Text style={styles.subtitle}>Ev katkısı ve harcamaları</Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.statsRow}>
          <Card style={styles.statCard}>
            <View style={styles.statIconWrap}>
              <Ionicons name="home-outline" size={18} color={colors.brand} />
            </View>
            <Text style={styles.statLabel}>Ev için</Text>
            <Text style={styles.statValue}>{formatEUR(householdTotal)}</Text>
          </Card>
          <Card style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: "#DBEAFE" }]}>
              <Ionicons name="person-outline" size={18} color={colors.sky} />
            </View>
            <Text style={styles.statLabel}>Kişisel</Text>
            <Text style={styles.statValue}>{formatEUR(roommateTotal)}</Text>
          </Card>
        </View>

        <Text style={styles.section}>Harcama detayı</Text>

        {loading ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
        ) : expenses.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="file-tray-outline" size={40} color={colors.onSurfaceTertiary} />
            <Text style={styles.emptyTxt}>Bu dönemde bir harcaması yok.</Text>
          </View>
        ) : (
          expenses.map((e) => {
            const targetChip = e.target_type === "household" ? { txt: "Ev", color: colors.brand, bg: colors.brandSoft }
              : e.target_type === "roommate" ? { txt: `→ ${members.find((m) => m.user_id === e.target_user_id)?.name?.split(" ")[0] || "?"}`, color: colors.sky, bg: "#DBEAFE" }
              : { txt: "Kendisi", color: colors.amber, bg: "#FEF3C7" };
            return (
              <Card key={e.expense_id} style={styles.expCard} testID={`md-exp-${e.expense_id}`}>
                <View style={styles.expTop}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={styles.titleRow}>
                      <Text style={styles.expTitle} numberOfLines={1}>
                        {e.merchant || e.category || (e.source === "receipt" ? "Fiş" : "Manuel")}
                      </Text>
                      {e.merchant && <MerchantBadge name={e.merchant} />}
                    </View>
                    <View style={styles.metaRow}>
                      <View style={[styles.pill, { backgroundColor: targetChip.bg }]}>
                        <Text style={[styles.pillTxt, { color: targetChip.color }]}>{targetChip.txt}</Text>
                      </View>
                      {e.expense_date && (
                        <Text style={styles.expSubtle}>· {formatDateTR(e.expense_date)}</Text>
                      )}
                    </View>
                  </View>
                  <Text style={styles.expAmount}>{formatEUR(e.total)}</Text>
                </View>
                {(e.items || []).length > 0 && (
                  <View style={styles.itemList}>
                    {(e.items || []).map((it, i) => (
                      <View key={i} style={styles.itemRow}>
                        <CategoryIcon category={it.category} size={16} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.itemName} numberOfLines={1}>{it.name}</Text>
                          {(it.quantity || 1) !== 1 && (
                            <Text style={styles.itemQty}>{it.quantity} × {formatEUR(it.price)}</Text>
                          )}
                        </View>
                        <Text style={styles.itemTotal}>{formatEUR((it.quantity || 1) * it.price)}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {e.notes && <Text style={styles.notes}>💬 {e.notes}</Text>}
              </Card>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceAlt },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { fontSize: font.sizes.lg, fontWeight: font.weights.bold, color: colors.onSurface },
  subtitle: { fontSize: font.sizes.sm, color: colors.onSurfaceTertiary },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  statsRow: { flexDirection: "row", gap: spacing.md },
  statCard: { flex: 1, padding: spacing.md, gap: spacing.xs },
  statIconWrap: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center", marginBottom: spacing.xs },
  statLabel: { fontSize: font.sizes.sm, color: colors.onSurfaceSecondary, fontWeight: font.weights.semibold, textTransform: "uppercase", letterSpacing: 0.4 },
  statValue: { fontSize: font.sizes.xl, fontWeight: font.weights.bold, color: colors.onSurface },
  section: { fontSize: font.sizes.sm, fontWeight: font.weights.semibold, color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.6, marginTop: spacing.sm },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTxt: { fontSize: font.sizes.base, color: colors.onSurfaceSecondary },
  expCard: { gap: spacing.md, padding: spacing.md },
  expTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  expTitle: { fontSize: font.sizes.base, fontWeight: font.weights.semibold, color: colors.onSurface },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm },
  pillTxt: { fontSize: 11, fontWeight: font.weights.bold, letterSpacing: 0.3 },
  expSubtle: { fontSize: font.sizes.sm, color: colors.onSurfaceTertiary },
  expAmount: { fontSize: font.sizes.lg, fontWeight: font.weights.bold, color: colors.onSurface },
  itemList: { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.md, gap: spacing.sm },
  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  itemName: { fontSize: font.sizes.base, color: colors.onSurface },
  itemQty: { fontSize: font.sizes.sm, color: colors.onSurfaceTertiary, marginTop: 1 },
  itemTotal: { fontSize: font.sizes.base, color: colors.onSurface, fontWeight: font.weights.semibold },
  notes: { fontSize: font.sizes.sm, color: colors.onSurfaceSecondary, fontStyle: "italic", marginTop: spacing.xs },
});
