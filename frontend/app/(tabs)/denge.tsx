/** Kasa — kişisel hesap. Ev toplamları Anasayfa'ya taşındı; burada senin
 *  net durumun, seni ilgilendiren transferler ve dönem yönetimi var. */
import { useCallback, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable,
  RefreshControl, TextInput, KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { apiGet, apiPost, apiDelete } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, HeaderSplit, Sheet, Card, Row, Divider, Avatar, Money,
  IconPill, Chip, PrimaryButton, formatEUR,
} from "@/src/ui";
import { colors, spacing, radius, type as T } from "@/src/theme";

type Transfer = { from: string; to: string; amount: number };
type Period = { period_id: string; started_at: string; closed_at: string | null; status: string };
type Settlement = {
  settlement_id: string; from_user_id: string; to_user_id: string;
  amount: number; recorded_by: string; created_at: string;
};

const periodLabel = (p: Period, i: number, total: number) => {
  const d = new Date(p.started_at);
  return `${p.status === "active" ? "Aktif · " : ""}Dönem #${total - i}` +
    ` (${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()})`;
};

const relativeDay = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? "bugün" : days === 1 ? "dün" : `${days} gün önce`;
};

export default function Denge() {
  const { user } = useAuth();
  const { members, activePeriod, isAdmin, refresh: refreshHH } = useHousehold();
  const router = useRouter();

  const [periods, setPeriods] = useState<Period[]>([]);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [net, setNet] = useState<Record<string, number>>({});
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"none" | "close" | "reopen">("none");
  const [payFor, setPayFor] = useState<Transfer | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const q = selected ? `?period_id=${selected}` : "";
      const [pers, bal, stl] = await Promise.all([
        apiGet<{ periods: Period[] }>("/periods"),
        apiGet<any>(`/balances${q}`),
        apiGet<{ settlements: Settlement[] }>(`/settlements${q}`),
      ]);
      setPeriods(pers.periods || []);
      setNet(bal.net || {});
      setTransfers(bal.transfers || []);
      setSettlements(stl.settlements || []);
    } catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [selected]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const me = user?.user_id || "";
  const member = (id: string) => members.find((m) => m.user_id === id);
  const nameOf = (id: string) => member(id)?.name || "Bilinmeyen";
  const first = (id: string) => nameOf(id).split(" ")[0];

  const activeId = activePeriod?.period_id;
  const currentId = selected || activeId;
  const archived = currentId !== activeId;

  const myNet = Math.abs(net[me] || 0) < 0.005 ? 0 : (net[me] || 0);
  const incoming = useMemo(() => transfers.filter((t) => t.to === me), [transfers, me]);
  const outgoing = useMemo(() => transfers.filter((t) => t.from === me), [transfers, me]);
  const others = useMemo(() => transfers.filter((t) => t.to !== me && t.from !== me), [transfers, me]);
  const owedToMe = incoming.reduce((s, t) => s + t.amount, 0);
  const iOwe = outgoing.reduce((s, t) => s + t.amount, 0);

  const openPay = (t: Transfer) => {
    setPayFor(t);
    setPayAmount(t.amount.toFixed(2).replace(".", ","));
    setError(null); setMessage(null);
  };

  const confirmPay = async () => {
    if (!payFor) return;
    const amount = parseFloat(payAmount.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) { setError("Geçerli bir tutar girin"); return; }
    if (amount > payFor.amount + 0.005) { setError("Tutar borçtan büyük olamaz"); return; }
    setBusy(true); setError(null);
    try {
      await apiPost("/settlements", {
        from_user_id: payFor.from, to_user_id: payFor.to, amount,
      });
      setPayFor(null);
      await load();
      setMessage("Ödeme kaydedildi");
    } catch (e: any) { setError(e?.message || "Kaydedilemedi"); }
    finally { setBusy(false); }
  };

  const undoSettlement = async (id: string) => {
    setBusy(true); setError(null);
    try { await apiDelete(`/settlements/${id}`); await load(); setMessage("Ödeme kaydı kaldırıldı"); }
    catch (e: any) { setError(e?.message || "Kaldırılamadı"); }
    finally { setBusy(false); }
  };

  const closePeriod = async () => {
    setBusy(true); setError(null); setMessage(null);
    try {
      await apiPost("/periods/close", {});
      await refreshHH(); setSelected(undefined); await load();
      setMode("none"); setMessage("Dönem kapatıldı, yeni dönem başladı");
    } catch (e: any) { setError(e?.message || "İşlem başarısız"); }
    finally { setBusy(false); }
  };

  const reopenPeriod = async () => {
    setBusy(true); setError(null); setMessage(null);
    try {
      await apiPost("/periods/reopen", {});
      await refreshHH(); setSelected(undefined); await load();
      setMode("none"); setMessage("Dönem yeniden açıldı");
    } catch (e: any) { setError(e?.message || "Geri alınamadı"); }
    finally { setBusy(false); }
  };

  const canReopen = isAdmin && periods.some((p) => p.status === "closed")
    && transfers.length === 0 && settlements.length === 0;

  return (
    <View style={styles.root} testID="denge-screen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}
                            tintColor={colors.dark} progressBackgroundColor={colors.surface} />
          }
        >
          <ScreenHeader overline="KASA" title="Senin hesabın">
            <Text style={styles.heroLabel}>NET DURUMUN</Text>
            <Text style={[styles.heroValue,
                          { color: myNet >= 0 ? colors.accentOnDark : colors.negativeOnDark }]}>
              {formatEUR(myNet, true)}
            </Text>
            <Text style={styles.heroHint}>
              {myNet > 0.01 ? "Ev sana borçlu" : myNet < -0.01 ? "Eve borcun var" : "Ödeşmiş durumdasın"}
            </Text>
            <HeaderSplit items={[
              { label: "Sana borçlu", value: formatEUR(owedToMe), accent: owedToMe > 0.01 },
              { label: "Senin borcun", value: formatEUR(iOwe) },
            ]} />
          </ScreenHeader>

          <Sheet>
            {periods.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                          contentContainerStyle={styles.chips}>
                {periods.map((p, i) => (
                  <Chip key={p.period_id} label={periodLabel(p, i, periods.length)}
                        active={currentId === p.period_id}
                        icon={p.status === "active" ? "flash" : "archive"}
                        onPress={() => setSelected(p.period_id === activeId ? undefined : p.period_id)}
                        testID={`denge-period-${p.period_id}`} />
                ))}
              </ScrollView>
            )}

            {loading ? (
              <ActivityIndicator color={colors.dark} style={{ marginTop: spacing.xxl }} />
            ) : (
              <View style={{ gap: spacing.lg }}>
                {archived && (
                  <View style={[styles.banner, styles.mx]} testID="denge-archived-banner">
                    <Ionicons name="archive-outline" size={16} color={colors.inkSecondary} />
                    <Text style={styles.bannerTxt}>Kapatılmış dönem — yalnızca görüntüleniyor</Text>
                  </View>
                )}

                {transfers.length === 0 && (
                  <Card style={styles.mx}>
                    <Row
                      leading={<IconPill name="checkmark-circle" color={colors.accent}
                                         tint={colors.accentSoft} size={40} />}
                      title="Herkes ödeşmiş"
                      subtitle="Şu an kimsenin borcu yok"
                      minHeight={72}
                    />
                  </Card>
                )}

                {incoming.length > 0 && (
                  <Card title="Kimden alacaksın" style={styles.mx}>
                    {incoming.map((t, i) => (
                      <View key={`${t.from}-${i}`}>
                        <Row
                          minHeight={72}
                          leading={<Avatar name={nameOf(t.from)} size={38}
                                           avatarId={(member(t.from) as any)?.avatar_id}
                                           userId={t.from}
                                           photoVersion={(member(t.from) as any)?.photo_version} />}
                          title={first(t.from)}
                          subtitle={`sana ${formatEUR(t.amount)} ödeyecek`}
                          right={!archived ? (
                            <Pressable style={styles.actionSoft} onPress={() => openPay(t)}
                                       testID={`mark-paid-${t.from}`}>
                              <Text style={styles.actionSoftTxt}>Ödendi</Text>
                            </Pressable>
                          ) : <Money value={t.amount} />}
                        />
                        {i < incoming.length - 1 && <Divider />}
                      </View>
                    ))}
                  </Card>
                )}

                {outgoing.length > 0 && (
                  <Card title="Senin ödeyeceğin" style={styles.mx}>
                    {outgoing.map((t, i) => (
                      <View key={`${t.to}-${i}`}>
                        <Row
                          minHeight={72}
                          leading={<Avatar name={nameOf(t.to)} size={38}
                                           avatarId={(member(t.to) as any)?.avatar_id}
                                           userId={t.to}
                                           photoVersion={(member(t.to) as any)?.photo_version} />}
                          title={first(t.to)}
                          subtitle={`${formatEUR(t.amount)} borcun var`}
                          right={!archived ? (
                            <Pressable style={styles.actionDark} onPress={() => openPay(t)}
                                       testID={`mark-paid-to-${t.to}`}>
                              <Text style={styles.actionDarkTxt}>Ödedim</Text>
                            </Pressable>
                          ) : <Money value={t.amount} />}
                        />
                        {i < outgoing.length - 1 && <Divider />}
                      </View>
                    ))}
                  </Card>
                )}

                {others.length > 0 && (
                  <Card title="Diğer ödeşmeler" style={styles.mx}>
                    {others.map((t, i) => (
                      <View key={`o-${i}`}>
                        <Row
                          leading={<Avatar name={nameOf(t.from)} size={34}
                                           avatarId={(member(t.from) as any)?.avatar_id}
                                           userId={t.from}
                                           photoVersion={(member(t.from) as any)?.photo_version} />}
                          title={`${first(t.from)} → ${first(t.to)}`}
                          subtitle="seni ilgilendirmiyor"
                          right={<Money value={t.amount} color={colors.inkSecondary} />}
                        />
                        {i < others.length - 1 && <Divider inset={54} />}
                      </View>
                    ))}
                  </Card>
                )}

                {settlements.length > 0 && (
                  <Card title="Kaydedilen ödemeler" style={styles.mx}>
                    {settlements.map((s, i) => {
                      const mine = s.from_user_id === me || s.to_user_id === me;
                      return (
                        <View key={s.settlement_id}>
                          <Row
                            leading={<IconPill name="checkmark" color={colors.accent}
                                               tint={colors.accentSoft} size={32} />}
                            title={`${s.from_user_id === me ? "Sen" : first(s.from_user_id)} → ${
                              s.to_user_id === me ? "Sen" : first(s.to_user_id)}`}
                            subtitle={relativeDay(s.created_at)}
                            right={
                              <View style={styles.stlRight}>
                                <Money value={s.amount} color={colors.inkSecondary} />
                                {mine && !archived && (
                                  <Pressable onPress={() => undoSettlement(s.settlement_id)}
                                             hitSlop={10} testID={`undo-${s.settlement_id}`}>
                                    <Text style={styles.undo}>Geri al</Text>
                                  </Pressable>
                                )}
                              </View>
                            }
                          />
                          {i < settlements.length - 1 && <Divider inset={52} />}
                        </View>
                      );
                    })}
                  </Card>
                )}

                {message && <Text style={[styles.msg, styles.mx]}>{message}</Text>}
                {error && <Text style={[styles.err, styles.mx]} testID="denge-error">{error}</Text>}

                {!archived && (
                  <View style={[styles.mx, { gap: spacing.sm }]}>
                    {!isAdmin ? (
                      <View style={styles.banner}>
                        <Ionicons name="information-circle" size={16} color={colors.inkSecondary} />
                        <Text style={styles.bannerTxt}>Dönemi yalnızca ev yöneticisi kapatabilir.</Text>
                      </View>
                    ) : mode === "close" ? (
                      <View style={styles.confirm}>
                        <Text style={styles.confirmTxt}>
                          Herkes gerçek hayatta ödeşti mi? Bu dönem arşivlenip yeni bir dönem başlayacak.
                        </Text>
                        <View style={styles.confirmRow}>
                          <Pressable style={styles.ghost} onPress={() => setMode("none")}
                                     testID="cancel-close-period">
                            <Text style={styles.ghostTxt}>Vazgeç</Text>
                          </Pressable>
                          <Pressable style={styles.solid} onPress={closePeriod} disabled={busy}
                                     testID="confirm-close-period">
                            {busy ? <ActivityIndicator color={colors.onBrand} />
                                  : <Text style={styles.solidTxt}>Evet, kapat</Text>}
                          </Pressable>
                        </View>
                      </View>
                    ) : mode === "reopen" ? (
                      <View style={styles.confirm}>
                        <Text style={styles.confirmTxt}>
                          Son kapatılan dönem yeniden açılacak ve harcamaları geri gelecek.
                        </Text>
                        <View style={styles.confirmRow}>
                          <Pressable style={styles.ghost} onPress={() => setMode("none")} testID="cancel-reopen">
                            <Text style={styles.ghostTxt}>Vazgeç</Text>
                          </Pressable>
                          <Pressable style={styles.solid} onPress={reopenPeriod} disabled={busy}
                                     testID="confirm-reopen">
                            {busy ? <ActivityIndicator color={colors.onBrand} />
                                  : <Text style={styles.solidTxt}>Evet, geri al</Text>}
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <>
                        <PrimaryButton label="Dönemi Kapat & Denkleştir" icon="checkmark-done"
                                       onPress={() => setMode("close")} testID="close-period-btn" />
                        {canReopen && (
                          <Pressable style={styles.undoBtn} onPress={() => setMode("reopen")}
                                     testID="reopen-period-btn">
                            <Ionicons name="arrow-undo" size={15} color={colors.inkSecondary} />
                            <Text style={styles.undoBtnTxt}>Son kapatmayı geri al</Text>
                          </Pressable>
                        )}
                      </>
                    )}
                    {activePeriod && (
                      <Text style={styles.footNote}>
                        Aktif dönem · {new Date(activePeriod.started_at).toLocaleDateString("tr-TR")}'ten beri
                      </Text>
                    )}
                  </View>
                )}
              </View>
            )}
          </Sheet>
        </ScrollView>

        {payFor && (
          <View style={styles.payWrap}>
            <View style={styles.paySheet}>
              <Text style={styles.payTitle}>
                {payFor.from === me
                  ? `${first(payFor.to)} kişisine ödeme`
                  : `${first(payFor.from)} kişisinden tahsilat`}
              </Text>
              <Text style={styles.payHint}>
                Tutarı değiştirebilirsin — kısmi ödeme de kaydedilir.
              </Text>
              <View style={styles.payRow}>
                <TextInput
                  style={styles.payInput}
                  value={payAmount}
                  onChangeText={(t) => setPayAmount(t.replace(/[^\d.,]/g, ""))}
                  keyboardType="decimal-pad"
                  autoFocus
                  testID="settlement-amount"
                />
                <Text style={styles.payCur}>€</Text>
              </View>
              {error && <Text style={styles.err}>{error}</Text>}
              <View style={styles.confirmRow}>
                <Pressable style={styles.ghost} onPress={() => { setPayFor(null); setError(null); }}
                           testID="cancel-settlement">
                  <Text style={styles.ghostTxt}>Vazgeç</Text>
                </Pressable>
                <Pressable style={styles.solid} onPress={confirmPay} disabled={busy}
                           testID="confirm-settlement">
                  {busy ? <ActivityIndicator color={colors.onBrand} />
                        : <Text style={styles.solidTxt}>Kaydet</Text>}
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  scroll: { paddingBottom: 130, backgroundColor: colors.bg, flexGrow: 1 },
  mx: { marginHorizontal: spacing.lg },
  heroLabel: { fontSize: 11, lineHeight: 14, fontFamily: "IBMPlexSans-SemiBold",
               letterSpacing: 1.1, color: colors.onDarkMuted },
  heroValue: { ...T.hero, marginTop: spacing.xs },
  heroHint: { ...T.body, color: colors.onDarkMuted, marginTop: 2 },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  banner: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md,
  },
  bannerTxt: { ...T.caption, color: colors.inkSecondary, flex: 1 },
  actionSoft: { backgroundColor: colors.accentSoft, paddingHorizontal: spacing.lg,
                paddingVertical: 8, borderRadius: radius.pill },
  actionSoftTxt: { ...T.captionSb, color: colors.accentDark },
  actionDark: { backgroundColor: colors.brand, paddingHorizontal: spacing.lg,
                paddingVertical: 8, borderRadius: radius.pill },
  actionDarkTxt: { ...T.captionSb, color: colors.onBrand },
  stlRight: { alignItems: "flex-end", gap: 2 },
  undo: { ...T.caption, color: colors.negative },
  msg: { ...T.bodySb, color: colors.accentDark, textAlign: "center" },
  err: { ...T.bodySb, color: colors.negative, textAlign: "center" },
  confirm: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
             borderColor: colors.border, padding: spacing.lg, gap: spacing.md },
  confirmTxt: { ...T.body, color: colors.inkSecondary, textAlign: "center" },
  confirmRow: { flexDirection: "row", gap: spacing.md },
  ghost: { flex: 1, minHeight: 50, alignItems: "center", justifyContent: "center",
           borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary },
  ghostTxt: { ...T.bodySb, color: colors.inkSecondary },
  solid: { flex: 1, minHeight: 50, alignItems: "center", justifyContent: "center",
           borderRadius: radius.pill, backgroundColor: colors.brand },
  solidTxt: { ...T.bodySb, color: colors.onBrand },
  undoBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center",
             gap: 6, paddingVertical: spacing.md },
  undoBtnTxt: { ...T.captionSb, color: colors.inkSecondary },
  footNote: { ...T.caption, color: colors.inkTertiary, textAlign: "center", marginTop: spacing.xs },
  payWrap: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(12,22,38,0.45)",
             justifyContent: "flex-end" },
  paySheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl, padding: spacing.xl, gap: spacing.md },
  payTitle: { ...T.title, color: colors.ink },
  payHint: { ...T.caption, color: colors.inkTertiary },
  payRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  payInput: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 56,
    fontSize: 26, lineHeight: 32, fontFamily: "IBMPlexSans-Bold", color: colors.ink,
  },
  payCur: { ...T.screen, color: colors.inkSecondary },
});
