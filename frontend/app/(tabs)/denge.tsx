import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiGet, apiPost } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import { Card, Chip, Avatar, PrimaryButton, formatEUR } from "@/src/ui";
import { colors, spacing, radius, font } from "@/src/theme";

type Transfer = { from: string; to: string; amount: number };
type Period = { period_id: string; started_at: string; closed_at: string | null; status: string };

const periodLabel = (p: Period, idx: number, total: number) => {
  const d = new Date(p.started_at);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const y = d.getFullYear();
  return `${p.status === "active" ? "Aktif · " : ""}Dönem #${total - idx} (${m}.${y})`;
};

export default function Denge() {
  const { user } = useAuth();
  const { members, activePeriod, refresh: refreshHH } = useHousehold();
  const router = useRouter();
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string | undefined>(undefined);
  const [net, setNet] = useState<Record<string, number>>({});
  const [totalsPaid, setTotalsPaid] = useState<Record<string, number>>({});
  const [roommatePaid, setRoommatePaid] = useState<Record<string, number>>({});
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [pers, bal] = await Promise.all([
        apiGet("/periods"),
        apiGet(selectedPeriod ? `/balances?period_id=${selectedPeriod}` : "/balances"),
      ]);
      setPeriods(pers.periods || []);
      setNet(bal.net || {});
      setTotalsPaid(bal.totals_paid || {});
      setRoommatePaid(bal.roommate_paid || {});
      setTransfers(bal.transfers || []);
    } catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [selectedPeriod]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const memberName = (id: string) => members.find((m) => m.user_id === id)?.name || "?";
  const short = (id: string) => memberName(id).split(" ")[0];

  const activePeriodId = activePeriod?.period_id;
  const currentPeriodId = selectedPeriod || activePeriodId;
  const isArchived = currentPeriodId !== activePeriodId;

  const openMemberDetail = (memberId: string) => {
    router.push({ pathname: "/member-detail", params: { memberId, periodId: currentPeriodId || "" } });
  };

  const onCloseAndReset = async () => {
    setClosing(true); setMessage(null);
    try {
      await apiPost("/periods/close", {});
      await refreshHH();
      setSelectedPeriod(undefined);
      await load();
      setMessage("Dönem başarıyla kapatıldı. Yeni dönem başladı 🎉");
      setConfirmClose(false);
    } catch (e: any) { setMessage(e.message || "İşlem başarısız"); }
    finally { setClosing(false); }
  };

  const settled = transfers.length === 0;

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="denge-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Denge</Text>
        <Text style={styles.subtitle}>Kim kime borçlu — basitleştirilmiş</Text>
      </View>

      <View style={styles.chipRowWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {periods.map((p, i) => (
            <Chip
              key={p.period_id}
              label={periodLabel(p, i, periods.length)}
              active={currentPeriodId === p.period_id}
              onPress={() => setSelectedPeriod(p.period_id === activePeriodId ? undefined : p.period_id)}
              icon={p.status === "active" ? "flash" : "archive"}
              testID={`denge-period-${p.period_id}`}
            />
          ))}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
      >
        {isArchived && (
          <View style={styles.archivedBanner} testID="denge-archived-banner">
            <Ionicons name="archive-outline" size={16} color={colors.onBrandSoft} />
            <Text style={styles.archivedTxt}>Kapatılmış dönem</Text>
          </View>
        )}

        <Text style={styles.section}>Ev katkısı (kim ne kadar aldı)</Text>
        <View style={styles.memberList}>
          {members.map((m) => {
            const paid = totalsPaid[m.user_id] || 0;
            const roomP = roommatePaid[m.user_id] || 0;
            return (
              <Pressable
                key={m.user_id}
                onPress={() => openMemberDetail(m.user_id)}
                testID={`member-detail-${m.user_id}`}
              >
                <Card style={styles.memberCard}>
                  <Avatar name={m.name} size={44} avatarId={(m as any).avatar_id} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.mName}>{m.name}{m.user_id === user?.user_id ? " (sen)" : ""}</Text>
                    <View style={styles.mMeta}>
                      <View style={styles.mMetaChip}>
                        <Ionicons name="home-outline" size={12} color={colors.brand} />
                        <Text style={styles.mMetaTxt}>Ev: {formatEUR(paid)}</Text>
                      </View>
                      {roomP > 0.01 && (
                        <View style={[styles.mMetaChip, { backgroundColor: "#DBEAFE" }]}>
                          <Ionicons name="person-outline" size={12} color={colors.sky} />
                          <Text style={[styles.mMetaTxt, { color: colors.sky }]}>Kişisel: {formatEUR(roomP)}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[
                      styles.mNet,
                      { color: (net[m.user_id] || 0) > 0.01 ? colors.positive : (net[m.user_id] || 0) < -0.01 ? colors.negative : colors.onSurfaceTertiary },
                    ]}>
                      {(net[m.user_id] || 0) > 0 ? "+" : ""}{formatEUR(net[m.user_id] || 0)}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceTertiary} />
                  </View>
                </Card>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.section}>Önerilen ödemeler</Text>
        {loading ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.lg }} />
        ) : settled ? (
          <Card style={styles.settledCard} testID="everyone-settled">
            <View style={styles.settledIconWrap}>
              <Ionicons name="checkmark-circle" size={44} color={colors.mint} />
            </View>
            <Text style={styles.settledTitle}>Herkes ödeşmiş durumda!</Text>
            <Text style={styles.settledDesc}>Şu an için hiç kimsenin borcu yok.</Text>
          </Card>
        ) : (
          transfers.map((t, i) => (
            <Card key={i} style={styles.transferCard} testID={`transfer-row-${i}`}>
              <View style={styles.transferRow}>
                <View style={styles.avatarBlock}>
                  <Avatar name={memberName(t.from)} size={44} avatarId={(members.find((m) => m.user_id === t.from) as any)?.avatar_id} />
                  <Text style={styles.avatarName}>{short(t.from)}</Text>
                </View>
                <View style={styles.arrowWrap}>
                  <Ionicons name="arrow-forward" size={22} color={colors.brand} />
                  <View style={styles.amountPill}>
                    <Text style={styles.amountTxt}>{formatEUR(t.amount)}</Text>
                  </View>
                </View>
                <View style={styles.avatarBlock}>
                  <Avatar name={memberName(t.to)} size={44} avatarId={(members.find((m) => m.user_id === t.to) as any)?.avatar_id} />
                  <Text style={styles.avatarName}>{short(t.to)}</Text>
                </View>
              </View>
            </Card>
          ))
        )}

        {message && <Text style={styles.message}>{message}</Text>}
      </ScrollView>

      {!isArchived && (
        <View style={styles.footer}>
          {!confirmClose ? (
            <PrimaryButton
              label="Dönemi Kapat & Denkleştir"
              onPress={() => setConfirmClose(true)}
              icon="checkmark-done"
              testID="close-period-btn"
            />
          ) : (
            <View style={styles.confirmWrap}>
              <Text style={styles.confirmTxt}>
                Herkes gerçek hayatta ödeşti mi? Bu dönemi arşivleyip yeni bir dönem başlatacak.
              </Text>
              <View style={styles.confirmRow}>
                <Pressable style={styles.cancelBtn} onPress={() => setConfirmClose(false)} testID="cancel-close-period">
                  <Text style={styles.cancelTxt}>Vazgeç</Text>
                </Pressable>
                <Pressable style={[styles.confirmBtn, closing && { opacity: 0.6 }]} onPress={onCloseAndReset} disabled={closing} testID="confirm-close-period">
                  {closing ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.confirmBtnTxt}>Evet, kapat</Text>}
                </Pressable>
              </View>
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceAlt },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  title: { fontSize: 26, fontWeight: font.weights.bold, color: colors.onSurface, letterSpacing: -0.3 },
  subtitle: { fontSize: font.sizes.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  chipRowWrap: { height: 56, justifyContent: "center", marginTop: spacing.sm },
  chipRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: "center" },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: 200 },
  archivedBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brandSoft, borderRadius: radius.md, padding: spacing.md },
  archivedTxt: { color: colors.onBrandSoft, fontSize: font.sizes.base, fontWeight: font.weights.semibold },
  section: { fontSize: font.sizes.sm, fontWeight: font.weights.semibold, color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.6, marginTop: spacing.sm },
  memberList: { gap: spacing.sm },
  memberCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  mName: { fontSize: font.sizes.base, fontWeight: font.weights.semibold, color: colors.onSurface, marginBottom: 4 },
  mMeta: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  mMetaChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brandSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  mMetaTxt: { fontSize: 11, fontWeight: font.weights.semibold, color: colors.onBrandSoft },
  mNet: { fontSize: font.sizes.lg, fontWeight: font.weights.bold, marginBottom: 2 },
  settledCard: { alignItems: "center", padding: spacing.xl, gap: spacing.sm },
  settledIconWrap: { width: 80, height: 80, borderRadius: 40, backgroundColor: "#DCFCE7", alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  settledTitle: { fontSize: font.sizes.lg, fontWeight: font.weights.bold, color: colors.onSurface },
  settledDesc: { fontSize: font.sizes.base, color: colors.onSurfaceSecondary, textAlign: "center" },
  transferCard: { padding: spacing.lg },
  transferRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  avatarBlock: { alignItems: "center", gap: 6, width: 72 },
  avatarName: { fontSize: font.sizes.sm, color: colors.onSurface, fontWeight: font.weights.semibold },
  arrowWrap: { flex: 1, alignItems: "center", gap: 6 },
  amountPill: { backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  amountTxt: { color: "#fff", fontWeight: font.weights.bold, fontSize: font.sizes.base },
  message: { color: colors.success, fontWeight: font.weights.semibold, textAlign: "center", marginTop: spacing.md },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    padding: spacing.lg, backgroundColor: colors.surfaceAlt,
    borderTopWidth: 1, borderTopColor: colors.divider,
  },
  confirmWrap: { gap: spacing.md },
  confirmTxt: { fontSize: font.sizes.base, color: colors.onSurfaceSecondary, textAlign: "center", lineHeight: 20 },
  confirmRow: { flexDirection: "row", gap: spacing.md },
  cancelBtn: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, minHeight: 52, alignItems: "center", justifyContent: "center" },
  cancelTxt: { color: colors.onSurface, fontWeight: font.weights.semibold, fontSize: font.sizes.lg },
  confirmBtn: { flex: 1, backgroundColor: colors.brand, borderRadius: radius.pill, minHeight: 52, alignItems: "center", justifyContent: "center" },
  confirmBtnTxt: { color: colors.onBrand, fontWeight: font.weights.semibold, fontSize: font.sizes.lg },
});
