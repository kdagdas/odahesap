import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { apiGet } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import { Card, Avatar, MerchantBadge, formatEUR, formatDateTR } from "@/src/ui";
import { colors, spacing, radius, font } from "@/src/theme";

type Expense = {
  expense_id: string; added_by: string; target_type: string; target_user_id?: string;
  total: number; merchant?: string; category?: string; source: string;
  created_at: string; expense_date?: string; notes?: string;
};

export default function Panel() {
  const { user } = useAuth();
  const { household, members, pendingMembers } = useHousehold();
  const router = useRouter();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [net, setNet] = useState<Record<string, number>>({});
  const [totalsPaid, setTotalsPaid] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [exp, bal] = await Promise.all([apiGet("/expenses"), apiGet("/balances")]);
      setExpenses(exp.expenses || []);
      setNet(bal.net || {});
      setTotalsPaid(bal.totals_paid || {});
    } catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const memberById = (id: string) => members.find((m) => m.user_id === id);
  const rawNet = net[user?.user_id || ""] || 0;
  // Snap sub-cent rounding noise to zero so the card never reads "-0,00 €".
  const myNet = Math.abs(rawNet) < 0.005 ? 0 : rawNet;

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="panel-screen">
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hi}>Merhaba, {user?.name?.split(" ")[0]}</Text>
            <Text style={styles.homeName}>{household?.name}</Text>
          </View>
          <Pressable onPress={() => router.push("/settings")} testID="open-settings-btn">
            <Avatar name={user?.name || "?"} size={44} avatarId={user?.avatar_id} />
            {pendingMembers.length > 0 && (
              <View style={styles.settingsBadge} testID="pending-approvals-badge">
                <Text style={styles.settingsBadgeTxt}>{pendingMembers.length}</Text>
              </View>
            )}
          </Pressable>
        </View>

        <View style={styles.balanceCard} testID="balance-card">
          <LinearGradient
            colors={myNet >= 0 ? ["#0EA5A5", "#0B8180"] : ["#F97066", "#DC2626"]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Text style={styles.balanceLabel}>Bu dönem net durumun</Text>
          <Text style={styles.balanceAmount}>
            {myNet > 0 ? "+" : ""}{formatEUR(myNet)}
          </Text>
          <Text style={styles.balanceHint}>
            {myNet > 0.01 ? "Ev sana borçlu" : myNet < -0.01 ? "Eve borcun var" : "Ödeşmiş durumdasın"}
          </Text>
          <View style={styles.balanceActions}>
            <Pressable style={styles.balanceBtn} onPress={() => router.push("/manual")} testID="add-manual-cta">
              <Ionicons name="add-circle" size={18} color="#fff" />
              <Text style={styles.balanceBtnTxt}>Manuel Ekle</Text>
            </Pressable>
            <Pressable style={styles.balanceBtn} onPress={() => router.push("/(tabs)/tara")} testID="scan-cta">
              <Ionicons name="scan" size={18} color="#fff" />
              <Text style={styles.balanceBtnTxt}>Fiş Tara</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ev arkadaşları</Text>
          {members.map((m) => (
            <Card key={m.user_id} style={styles.memberRow} testID={`member-row-${m.user_id}`}>
              <Avatar name={m.name} size={40} avatarId={(m as any).avatar_id} />
              <View style={{ flex: 1 }}>
                <Text style={styles.memberName}>{m.name}{m.user_id === user?.user_id ? " (sen)" : ""}</Text>
                <Text style={styles.memberEmail}>{m.email}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.memberPaid}>{formatEUR(totalsPaid[m.user_id] || 0)}</Text>
                <Text style={styles.memberSubtle}>ev için ödedi</Text>
              </View>
            </Card>
          ))}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Son harcamalar</Text>
            <Pressable onPress={() => router.push("/(tabs)/harcamalar")} testID="see-all-expenses">
              <Text style={styles.link}>Tümü</Text>
            </Pressable>
          </View>
          {loading ? (
            <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.lg }} />
          ) : expenses.length === 0 ? (
            <Card style={styles.emptyCard} testID="empty-expenses">
              <View style={styles.emptyIcon}>
                <Ionicons name="receipt-outline" size={32} color={colors.brand} />
              </View>
              <Text style={styles.emptyTitle}>Henüz bir harcama yok</Text>
              <Text style={styles.emptyDesc}>İlk fişi tara veya manuel ekle.</Text>
            </Card>
          ) : (
            expenses.slice(0, 8).map((e) => {
              const author = memberById(e.added_by);
              const targetLabel =
                e.target_type === "household" ? "Ev"
                : e.target_type === "self" ? "Kendim"
                : `→ ${memberById(e.target_user_id || "")?.name?.split(" ")[0] || "Oda"}`;
              return (
                <Card key={e.expense_id} style={styles.expCard} testID={`expense-row-${e.expense_id}`}>
                  <View style={styles.expTop}>
                    <Avatar name={author?.name || "?"} size={36} avatarId={(author as any)?.avatar_id} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.expTitle} numberOfLines={1}>
                        {e.merchant || e.category || (e.source === "receipt" ? "Fiş" : "Manuel")}
                      </Text>
                      <View style={styles.expMeta}>
                        <Text style={styles.expSubtle}>{author?.name?.split(" ")[0]} · {targetLabel}</Text>
                        {e.expense_date && (
                          <>
                            <Text style={styles.expDot}>·</Text>
                            <Text style={styles.expSubtle}>{formatDateTR(e.expense_date)}</Text>
                          </>
                        )}
                      </View>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 4 }}>
                      <Text style={styles.expAmount}>{formatEUR(e.total)}</Text>
                      {e.merchant && <MerchantBadge name={e.merchant} />}
                    </View>
                  </View>
                </Card>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceAlt },
  scroll: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 120 },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.sm },
  hi: { fontSize: font.sizes.sm, color: colors.onSurfaceSecondary },
  homeName: { fontSize: 26, fontWeight: font.weights.bold, color: colors.onSurface, letterSpacing: -0.3 },
  settingsBadge: { position: "absolute", top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.coral, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  settingsBadgeTxt: { color: "#fff", fontSize: 11, fontWeight: font.weights.bold },
  balanceCard: {
    borderRadius: radius.lg, padding: spacing.xl, overflow: "hidden", gap: spacing.xs,
    shadowColor: "#0F2A2E", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 6,
  },
  balanceLabel: { color: "rgba(255,255,255,0.85)", fontSize: font.sizes.sm, fontWeight: font.weights.semibold, textTransform: "uppercase", letterSpacing: 0.7 },
  balanceAmount: { color: "#fff", fontSize: 44, fontWeight: font.weights.bold, letterSpacing: -1, marginTop: spacing.xs },
  balanceHint: { color: "rgba(255,255,255,0.9)", fontSize: font.sizes.base, marginTop: spacing.xs },
  balanceActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  balanceBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill },
  balanceBtnTxt: { color: "#fff", fontWeight: font.weights.semibold, fontSize: font.sizes.base },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: font.sizes.lg, fontWeight: font.weights.semibold, color: colors.onSurface, marginBottom: spacing.xs },
  link: { color: colors.brand, fontWeight: font.weights.semibold },
  memberRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  memberName: { fontSize: font.sizes.base, fontWeight: font.weights.semibold, color: colors.onSurface },
  memberEmail: { fontSize: font.sizes.sm, color: colors.onSurfaceTertiary },
  memberPaid: { fontSize: font.sizes.base, fontWeight: font.weights.semibold, color: colors.onSurface },
  memberSubtle: { fontSize: font.sizes.sm, color: colors.onSurfaceTertiary },
  expCard: { padding: spacing.md },
  expTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  expTitle: { fontSize: font.sizes.base, fontWeight: font.weights.semibold, color: colors.onSurface },
  expMeta: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  expSubtle: { fontSize: font.sizes.sm, color: colors.onSurfaceTertiary },
  expDot: { color: colors.onSurfaceTertiary },
  expAmount: { fontSize: font.sizes.lg, fontWeight: font.weights.bold, color: colors.onSurface },
  emptyCard: { alignItems: "center", padding: spacing.xl, gap: spacing.sm },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  emptyTitle: { fontSize: font.sizes.lg, fontWeight: font.weights.semibold, color: colors.onSurface },
  emptyDesc: { fontSize: font.sizes.base, color: colors.onSurfaceSecondary, textAlign: "center" },
});
