/** Kasa — kişisel hesap. Ev toplamları Anasayfa'ya taşındı; burada senin
 *  net durumun, kimin kime borçlu olduğu tek blok halinde, dönem istatistikleri
 *  ve dönem yönetimi var. */
import { useCallback, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable,
  RefreshControl, TextInput, KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import { apiGet, apiPost, apiDelete } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, HeaderSplit, Sheet, Card, Row, Divider, Avatar, Money,
  IconPill, Chip, PrimaryButton, MerchantBadge, formatEUR,
} from "@/src/ui";
import { colors, spacing, radius, type as T, overline, fontFamily } from "@/src/theme";

type Transfer = { from: string; to: string; amount: number };
type Period = { period_id: string; started_at: string; closed_at: string | null; status: string };
type Settlement = {
  settlement_id: string; from_user_id: string; to_user_id: string;
  amount: number; recorded_by: string; created_at: string;
};
type Stats = {
  total: number; per_person: number; daily_average: number; expense_count: number;
  item_count: number; avg_expense: number; member_count: number;
  by_member: { user_id: string; total: number }[];
  daily_series: { day: string; total: number }[];
  merchants: { name: string; total: number }[];
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

/**
 * 14 günlük çubuk grafik. Kütüphane yok: her çubuk yüksekliği en büyük güne
 * oranlanmış bir View. Harcaması olmayan gün bir kırıntı yükseklikte kalıyor,
 * böylece taban çizgisi kesintisiz okunuyor.
 */
function Bars({ data }: { data: { day: string; total: number }[] }) {
  const max = Math.max(...data.map((d) => d.total), 1);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <View style={styles.bars}>
      {data.map((d) => {
        const h = Math.max(3, Math.round((d.total / max) * 64));
        const isToday = d.day === today;
        return (
          <View key={d.day} style={styles.barCol}>
            <View style={[
              styles.bar,
              { height: h, backgroundColor: isToday ? colors.dark : d.total > 0 ? colors.accent : colors.border },
            ]} />
          </View>
        );
      })}
    </View>
  );
}

export default function Denge() {
  const { user } = useAuth();
  const { members, activePeriod, isAdmin, refresh: refreshHH } = useHousehold();

  const [periods, setPeriods] = useState<Period[]>([]);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [net, setNet] = useState<Record<string, number>>({});
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [showStats, setShowStats] = useState(false);
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
      const [pers, bal, stl, st] = await Promise.all([
        apiGet<{ periods: Period[] }>("/periods"),
        apiGet<any>(`/balances${q}`),
        apiGet<{ settlements: Settlement[] }>(`/settlements${q}`),
        apiGet<Stats>(`/stats${q}`),
      ]);
      setPeriods(pers.periods || []);
      setNet(bal.net || {});
      setTransfers(bal.transfers || []);
      setSettlements(stl.settlements || []);
      setStats(st);
    } catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [selected]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const me = user?.user_id || "";
  const member = (id: string) => members.find((m) => m.user_id === id);
  const nameOf = (id: string) => member(id)?.name || "Bilinmeyen";
  const first = (id: string) => (id === me ? "Sen" : nameOf(id).split(" ")[0]);

  const activeId = activePeriod?.period_id;
  const currentId = selected || activeId;
  const archived = currentId !== activeId;

  const myNet = Math.abs(net[me] || 0) < 0.005 ? 0 : (net[me] || 0);
  const owedToMe = useMemo(
    () => transfers.filter((t) => t.to === me).reduce((s, t) => s + t.amount, 0),
    [transfers, me],
  );
  const iOwe = useMemo(
    () => transfers.filter((t) => t.from === me).reduce((s, t) => s + t.amount, 0),
    [transfers, me],
  );

  // Beni ilgilendirenler üstte. Dört ayrı karta bölmek yerine tek liste:
  // "kim kime borçlu" tek bakışta okunacak bir tablo, dört ayrı başlık değil.
  const ordered = useMemo(() => {
    const rank = (t: Transfer) => (t.from === me ? 0 : t.to === me ? 1 : 2);
    return [...transfers].sort((a, b) => rank(a) - rank(b) || b.amount - a.amount);
  }, [transfers, me]);

  const myPaid = stats?.by_member.find((b) => b.user_id === me)?.total ?? 0;

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
          <ScreenHeader overline="KASA" title="Senin Hesabın">
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

                {/* Tek blok: dönemin bütün borçları, kim kime ne kadar. */}
                <Card title="Kim Kime Borçlu" style={styles.mx}>
                  {ordered.length === 0 ? (
                    <Row
                      leading={<IconPill name="checkmark-circle" color={colors.accent}
                                         tint={colors.accentSoft} size={40} />}
                      title="Herkes ödeşmiş"
                      subtitle="Bu dönemde kimsenin borcu kalmadı"
                      minHeight={72}
                    />
                  ) : (
                    ordered.map((t, i) => {
                      const mine = t.from === me || t.to === me;
                      const iPay = t.from === me;
                      return (
                        <View key={`${t.from}-${t.to}-${i}`}>
                          {i > 0 && <Divider inset={spacing.lg} />}
                          <View style={[styles.debtRow, mine && styles.debtRowMine]}>
                            {/* İki avatar üst üste: yönü tek bakışta anlatıyor. */}
                            <View style={styles.pair}>
                              <Avatar name={nameOf(t.from)} size={34}
                                      avatarId={(member(t.from) as any)?.avatar_id}
                                      userId={t.from}
                                      photoVersion={(member(t.from) as any)?.photo_version} />
                              <View style={styles.pairSecond}>
                                <Avatar name={nameOf(t.to)} size={34}
                                        avatarId={(member(t.to) as any)?.avatar_id}
                                        userId={t.to}
                                        photoVersion={(member(t.to) as any)?.photo_version} />
                              </View>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.debtTitle, !mine && styles.debtTitleMuted]}>
                                {first(t.from)} <Text style={styles.arrow}>→</Text> {first(t.to)}
                              </Text>
                              <Text style={styles.debtSub}>
                                {iPay ? "sen ödeyeceksin"
                                      : t.to === me ? "sana ödenecek"
                                      : "seni ilgilendirmiyor"}
                              </Text>
                            </View>
                            <View style={styles.debtRight}>
                              <Money value={t.amount}
                                     color={mine ? colors.ink : colors.inkTertiary} />
                              {mine && !archived && (
                                <Pressable
                                  style={iPay ? styles.actionDark : styles.actionSoft}
                                  onPress={() => openPay(t)}
                                  testID={iPay ? `mark-paid-to-${t.to}` : `mark-paid-${t.from}`}
                                >
                                  <Text style={iPay ? styles.actionDarkTxt : styles.actionSoftTxt}>
                                    {iPay ? "Ödedim" : "Ödendi"}
                                  </Text>
                                </Pressable>
                              )}
                            </View>
                          </View>
                        </View>
                      );
                    })
                  )}
                </Card>

                {settlements.length > 0 && (
                  <Card title="Kaydedilen Ödemeler" style={styles.mx}>
                    {settlements.map((s, i) => {
                      const mine = s.from_user_id === me || s.to_user_id === me;
                      return (
                        <View key={s.settlement_id}>
                          {i > 0 && <Divider inset={52} />}
                          <Row
                            leading={<IconPill name="checkmark" color={colors.accent}
                                               tint={colors.accentSoft} size={32} />}
                            title={`${first(s.from_user_id)} → ${first(s.to_user_id)}`}
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
                        </View>
                      );
                    })}
                  </Card>
                )}

                {/* İstatistikler kapalı geliyor: Kasa'ya gelen önce borcuna
                    bakar, rakamları merak eden açar. */}
                {stats && stats.expense_count > 0 && (
                  <Card
                    title="İstatistikler"
                    action={showStats ? "Gizle" : "Göster"}
                    onAction={() => setShowStats((v) => !v)}
                    style={styles.mx}
                    testID="stats-card"
                  >
                    {showStats && (
                      <View style={styles.statsBody}>
                        <Text style={styles.statLabel}>SON 14 GÜN</Text>
                        <Bars data={stats.daily_series} />
                        <View style={styles.barsAxis}>
                          <Text style={styles.axisTxt}>14 gün önce</Text>
                          <Text style={styles.axisTxt}>bugün</Text>
                        </View>

                        <View style={styles.tiles}>
                          <View style={styles.tile}>
                            <Text style={styles.tileLabel}>SENİN ÖDEDİĞİN</Text>
                            <Text style={styles.tileValue}>{formatEUR(myPaid)}</Text>
                            <Text style={styles.tileHint}>
                              payın {formatEUR(stats.per_person)}
                            </Text>
                          </View>
                          <View style={styles.tile}>
                            <Text style={styles.tileLabel}>ORTALAMA FİŞ</Text>
                            <Text style={styles.tileValue}>{formatEUR(stats.avg_expense)}</Text>
                            <Text style={styles.tileHint}>
                              {stats.expense_count} harcama · {stats.item_count} kalem
                            </Text>
                          </View>
                        </View>

                        {stats.merchants.length > 0 && (
                          <>
                            <Text style={styles.statLabel}>EN ÇOK HARCANAN YER</Text>
                            {stats.merchants.slice(0, 4).map((m) => (
                              <View key={m.name} style={styles.merchRow}>
                                <View style={styles.merchHead}>
                                  <MerchantBadge name={m.name} />
                                  <Money value={m.total} style={styles.merchVal} />
                                </View>
                                <View style={styles.track}>
                                  <View style={[styles.trackFill, {
                                    width: `${Math.max(4, (m.total / (stats.merchants[0].total || 1)) * 100)}%`,
                                  }]} />
                                </View>
                              </View>
                            ))}
                          </>
                        )}

                        <Text style={styles.statsFoot}>
                          Günlük ortalama {formatEUR(stats.daily_average)} · {stats.member_count} kişi
                        </Text>
                      </View>
                    )}
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
                  ? `${nameOf(payFor.to).split(" ")[0]} kişisine ödeme`
                  : `${nameOf(payFor.from).split(" ")[0]} kişisinden tahsilat`}
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
  heroLabel: { ...overline, color: colors.onDarkMuted },
  heroValue: { ...T.hero, marginTop: spacing.xs },
  heroHint: { ...T.body, color: colors.onDarkMuted, marginTop: 2 },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  banner: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md,
  },
  bannerTxt: { ...T.caption, color: colors.inkSecondary, flex: 1 },

  // --- kim kime borçlu ---
  debtRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 72,
  },
  // Beni ilgilendiren satır soldan ince bir yeşil şeritle işaretli; başkalarının
  // arasındaki borç aynı listede ama sessiz duruyor.
  debtRowMine: { borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: spacing.lg - 3 },
  pair: { flexDirection: "row", width: 54, alignItems: "center" },
  pairSecond: { marginLeft: -14, borderRadius: 20, borderWidth: 2, borderColor: colors.surface },
  debtTitle: { ...T.bodySb, color: colors.ink },
  debtTitleMuted: { color: colors.inkSecondary },
  arrow: { color: colors.inkTertiary },
  debtSub: { ...T.caption, color: colors.inkTertiary, marginTop: 1 },
  debtRight: { alignItems: "flex-end", gap: 6 },
  actionSoft: {
    backgroundColor: colors.accentSoft, paddingHorizontal: spacing.md,
    paddingVertical: 6, borderRadius: radius.pill,
  },
  actionSoftTxt: { ...T.captionSb, color: colors.accentDark },
  actionDark: {
    backgroundColor: colors.brand, paddingHorizontal: spacing.md,
    paddingVertical: 6, borderRadius: radius.pill,
  },
  actionDarkTxt: { ...T.captionSb, color: colors.onBrand },

  stlRight: { alignItems: "flex-end", gap: 2 },
  undo: { ...T.caption, color: colors.negative },

  // --- istatistikler ---
  statsBody: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
  statLabel: { ...overline, marginTop: spacing.xs },
  bars: { flexDirection: "row", alignItems: "flex-end", height: 64, gap: 4 },
  barCol: { flex: 1, justifyContent: "flex-end" },
  bar: { width: "100%", borderRadius: 3 },
  barsAxis: { flexDirection: "row", justifyContent: "space-between", marginTop: -spacing.sm },
  axisTxt: { ...T.caption, fontSize: 10, color: colors.inkTertiary },
  tiles: { flexDirection: "row", gap: spacing.md },
  tile: {
    flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
    padding: spacing.md, gap: 2,
  },
  tileLabel: { ...overline, fontSize: 10, letterSpacing: 0.8 },
  tileValue: { ...T.emph, color: colors.ink, fontVariant: ["tabular-nums"] },
  tileHint: { ...T.caption, fontSize: 11, color: colors.inkTertiary },
  merchRow: { gap: 6 },
  merchHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  merchVal: { ...T.captionSb, color: colors.ink },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceSecondary, overflow: "hidden" },
  trackFill: { height: 6, borderRadius: 3, backgroundColor: colors.dark },
  statsFoot: { ...T.caption, color: colors.inkTertiary, textAlign: "center", marginTop: spacing.xs },

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
    fontSize: 26, lineHeight: 32, fontFamily: fontFamily.semibold, color: colors.ink,
  },
  payCur: { ...T.screen, color: colors.inkSecondary },
});
