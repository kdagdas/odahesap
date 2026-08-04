import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, RefreshControl, TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiGet, apiPost, apiDelete } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import { Card, Chip, Avatar, PrimaryButton, formatEUR } from "@/src/ui";
import { colors, spacing, radius, font } from "@/src/theme";

type Transfer = { from: string; to: string; amount: number };
type Settlement = {
  settlement_id: string; from_user_id: string; to_user_id: string;
  amount: number; recorded_by: string;
};
type Period = { period_id: string; started_at: string; closed_at: string | null; status: string };

const periodLabel = (p: Period, idx: number, total: number) => {
  const d = new Date(p.started_at);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const y = d.getFullYear();
  return `${p.status === "active" ? "Aktif · " : ""}Dönem #${total - idx} (${m}.${y})`;
};

export default function Denge() {
  const { user } = useAuth();
  const { members, activePeriod, isAdmin, refresh: refreshHH } = useHousehold();
  const router = useRouter();
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string | undefined>(undefined);
  const [net, setNet] = useState<Record<string, number>>({});
  const [totalsPaid, setTotalsPaid] = useState<Record<string, number>>({});
  const [roommatePaid, setRoommatePaid] = useState<Record<string, number>>({});
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [payFor, setPayFor] = useState<Transfer | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [paying, setPaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setSettlements(bal.settlements || []);
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
    setClosing(true); setMessage(null); setError(null);
    try {
      await apiPost("/periods/close", {});
      await refreshHH();
      setSelectedPeriod(undefined);
      await load();
      setMessage("Dönem başarıyla kapatıldı. Yeni dönem başladı 🎉");
      setConfirmClose(false);
    } catch (e: any) { setError(e.message || "İşlem başarısız"); }
    finally { setClosing(false); }
  };

  // Only the two people involved may record a payment, so a transfer between
  // two other housemates has no button — they settle it themselves.
  const canRecord = (t: Transfer) =>
    !isArchived && (t.from === user?.user_id || t.to === user?.user_id);

  const openPay = (t: Transfer) => {
    setPayFor(t);
    setPayAmount(String(t.amount).replace(".", ","));
    setError(null); setMessage(null);
  };

  const recordPayment = async () => {
    if (!payFor) return;
    const amount = parseFloat(payAmount.replace(",", ".")) || 0;
    if (amount <= 0) { setError("Geçerli bir tutar girin"); return; }
    setPaying(true); setError(null);
    try {
      await apiPost("/settlements", {
        from_user_id: payFor.from, to_user_id: payFor.to, amount,
      });
      setPayFor(null);
      await load();
      setMessage("Ödeme kaydedildi");
    } catch (e: any) { setError(e?.message || "Kaydedilemedi"); }
    finally { setPaying(false); }
  };

  const undoSettlement = async (id: string) => {
    setError(null);
    try { await apiDelete(`/settlements/${id}`); await load(); }
    catch (e: any) { setError(e?.message || "Geri alınamadı"); }
  };

  const onReopen = async () => {
    setReopening(true); setMessage(null); setError(null);
    try {
      await apiPost("/periods/reopen", {});
      await refreshHH();
      setSelectedPeriod(undefined);
      await load();
      setMessage("Dönem yeniden açıldı, harcamalar geri geldi.");
      setConfirmReopen(false);
    } catch (e: any) { setError(e.message || "Geri alınamadı"); }
    finally { setReopening(false); }
  };

  // Only worth offering right after a close: the server refuses once the fresh
  // period has expenses in it, so don't dangle a button that will just error.
  const closedPeriods = periods.filter((p) => p.status === "closed");
  const canReopen = isAdmin && closedPeriods.length > 0 && transfers.length === 0
    && Object.values(totalsPaid).every((v) => Math.abs(v) < 0.01);

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
                  <Avatar name={m.name} size={44} avatarId={(m as any).avatar_id} userId={m.user_id} photoVersion={(m as any).photo_version} />
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
                  <Avatar name={memberName(t.from)} size={44} avatarId={(members.find((m) => m.user_id === t.from) as any)?.avatar_id} userId={t.from} photoVersion={(members.find((m) => m.user_id === t.from) as any)?.photo_version} />
                  <Text style={styles.avatarName}>{short(t.from)}</Text>
                </View>
                <View style={styles.arrowWrap}>
                  <Ionicons name="arrow-forward" size={22} color={colors.brand} />
                  <View style={styles.amountPill}>
                    <Text style={styles.amountTxt}>{formatEUR(t.amount)}</Text>
                  </View>
                </View>
                <View style={styles.avatarBlock}>
                  <Avatar name={memberName(t.to)} size={44} avatarId={(members.find((m) => m.user_id === t.to) as any)?.avatar_id} userId={t.to} photoVersion={(members.find((m) => m.user_id === t.to) as any)?.photo_version} />
                  <Text style={styles.avatarName}>{short(t.to)}</Text>
                </View>
              </View>

              {canRecord(t) && payFor !== t && (
                <Pressable style={styles.payBtn} onPress={() => openPay(t)} testID={`mark-paid-${i}`}>
                  <Ionicons name="checkmark-circle-outline" size={17} color={colors.brand} />
                  <Text style={styles.payTxt}>
                    {t.from === user?.user_id ? "Ödedim" : "Ödemeyi aldım"}
                  </Text>
                </Pressable>
              )}

              {payFor === t && (
                <View style={styles.payForm}>
                  <Text style={styles.payHint}>
                    Ne kadar ödendi? Tamamı değilse tutarı değiştir — kalan borç durur.
                  </Text>
                  <View style={styles.payRow}>
                    <Text style={styles.payCurrency}>€</Text>
                    <TextInput
                      style={styles.payInput}
                      value={payAmount}
                      onChangeText={(v) => setPayAmount(v.replace(/[^\d.,]/g, ""))}
                      keyboardType="decimal-pad"
                      autoFocus
                      testID="pay-amount"
                    />
                  </View>
                  <View style={styles.confirmRow}>
                    <Pressable style={styles.cancelBtn} onPress={() => setPayFor(null)} testID="cancel-pay">
                      <Text style={styles.cancelTxt}>Vazgeç</Text>
                    </Pressable>
                    <Pressable style={[styles.confirmBtn, paying && { opacity: 0.6 }]}
                               onPress={recordPayment} disabled={paying} testID="confirm-pay">
                      {paying ? <ActivityIndicator color={colors.onBrand} />
                              : <Text style={styles.confirmBtnTxt}>Kaydet</Text>}
                    </Pressable>
                  </View>
                </View>
              )}
            </Card>
          ))
        )}

        {settlements.length > 0 && (
          <>
            <Text style={styles.section}>Kaydedilen ödemeler</Text>
            {settlements.map((s) => {
              const mine = s.from_user_id === user?.user_id || s.to_user_id === user?.user_id;
              return (
                <Card key={s.settlement_id} style={styles.settleCard} testID={`settlement-${s.settlement_id}`}>
                  <Ionicons name="checkmark-circle" size={20} color={colors.mint} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.settleTxt}>
                      {short(s.from_user_id)} → {short(s.to_user_id)} · {formatEUR(s.amount)}
                    </Text>
                    <Text style={styles.settleMeta}>{short(s.recorded_by)} işaretledi</Text>
                  </View>
                  {mine && !isArchived && (
                    <Pressable onPress={() => undoSettlement(s.settlement_id)} hitSlop={10}
                               testID={`undo-settlement-${s.settlement_id}`}>
                      <Text style={styles.undoLink}>Geri al</Text>
                    </Pressable>
                  )}
                </Card>
              );
            })}
          </>
        )}

        {message && <Text style={styles.message}>{message}</Text>}
        {error && <Text style={styles.errorMsg} testID="denge-error">{error}</Text>}
      </ScrollView>

      {!isArchived && !isAdmin && (
        <View style={styles.footer}>
          <View style={styles.memberNote}>
            <Ionicons name="information-circle" size={16} color={colors.onBrandSoft} />
            <Text style={styles.memberNoteTxt}>
              Dönemi yalnızca ev yöneticisi kapatabilir.
            </Text>
          </View>
        </View>
      )}

      {!isArchived && isAdmin && (
        <View style={styles.footer}>
          {!confirmClose && !confirmReopen ? (
            <>
              <PrimaryButton
                label="Dönemi Kapat & Denkleştir"
                onPress={() => setConfirmClose(true)}
                icon="checkmark-done"
                testID="close-period-btn"
              />
              {canReopen && (
                <Pressable
                  style={styles.undoBtn}
                  onPress={() => { setConfirmReopen(true); setError(null); }}
                  testID="reopen-period-btn"
                >
                  <Ionicons name="arrow-undo" size={15} color={colors.onSurfaceSecondary} />
                  <Text style={styles.undoTxt}>Son kapatmayı geri al</Text>
                </Pressable>
              )}
            </>
          ) : confirmReopen ? (
            <View style={styles.confirmWrap}>
              <Text style={styles.confirmTxt}>
                Son kapatılan dönem yeniden açılacak ve harcamaları geri gelecek.
                Yeni döneme harcama girildiyse bu işlem yapılamaz.
              </Text>
              <View style={styles.confirmRow}>
                <Pressable style={styles.cancelBtn} onPress={() => setConfirmReopen(false)} testID="cancel-reopen">
                  <Text style={styles.cancelTxt}>Vazgeç</Text>
                </Pressable>
                <Pressable style={[styles.confirmBtn, reopening && { opacity: 0.6 }]} onPress={onReopen} disabled={reopening} testID="confirm-reopen">
                  {reopening ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.confirmBtnTxt}>Evet, geri al</Text>}
                </Pressable>
              </View>
            </View>
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
  payBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.brand,
  },
  payTxt: { color: colors.brand, fontWeight: font.weights.semibold, fontSize: font.sizes.base },
  payForm: { marginTop: spacing.md, gap: spacing.sm },
  payHint: { fontSize: font.sizes.sm, color: colors.onSurfaceSecondary, lineHeight: 17 },
  payRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  payCurrency: { fontSize: 22, color: colors.brand, fontWeight: font.weights.bold },
  payInput: { flex: 1, fontSize: 24, fontWeight: font.weights.bold, color: colors.onSurface, padding: 0 },
  settleCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  settleTxt: { fontSize: font.sizes.base, fontWeight: font.weights.semibold, color: colors.onSurface },
  settleMeta: { fontSize: font.sizes.sm, color: colors.onSurfaceTertiary, marginTop: 1 },
  undoLink: { color: colors.onSurfaceTertiary, fontSize: font.sizes.sm, fontWeight: font.weights.semibold },
  message: { color: colors.success, fontWeight: font.weights.semibold, textAlign: "center", marginTop: spacing.md },
  errorMsg: { color: colors.error, fontWeight: font.weights.semibold, textAlign: "center", marginTop: spacing.md, lineHeight: 20 },
  memberNote: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brandSoft, padding: spacing.md, borderRadius: radius.md },
  memberNoteTxt: { flex: 1, fontSize: font.sizes.sm, color: colors.onBrandSoft },
  undoBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: spacing.md, marginTop: spacing.sm },
  undoTxt: { color: colors.onSurfaceSecondary, fontSize: font.sizes.sm, fontWeight: font.weights.semibold },
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
