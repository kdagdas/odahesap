/** Kasa — kişisel hesap. Ev toplamları Anasayfa'ya taşındı; burada senin
 *  net durumun, kimin kime borçlu olduğu tek blok halinde, dönem istatistikleri
 *  ve dönem yönetimi var. */
import { useCallback, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable,
  RefreshControl, TextInput, KeyboardAvoidingView, Platform, Alert, Share, Linking,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import { apiGet, apiPost, apiDelete } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, HeaderSplit, Sheet, Card, Row, Divider, Avatar, Money,
  IconPill, Chip, PrimaryButton, BottomSheet, formatEUR, useKeyboardHeight,
} from "@/src/ui";
import {
  getPaymentFor, paypalLink, formatIban, type PaymentInfo,
} from "@/src/payment";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius, type as T, overline, fontFamily, metrics } from "@/src/theme";

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


export default function Denge() {
  const { user } = useAuth();
  const { members, activePeriod, isAdmin, refresh: refreshHH } = useHousehold();
  // Anasayfadaki değişim rozetinden gelindiğinde doğrudan istatistiklere in.
  const kbHeight = useKeyboardHeight();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  const [periods, setPeriods] = useState<Period[]>([]);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [net, setNet] = useState<Record<string, number>>({});
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
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

  const [payWays, setPayWays] = useState(false);
  const [karsiBilgi, setKarsiBilgi] = useState<PaymentInfo | null>(null);

  const odeYollari = async () => {
    if (!payFor) return;
    setKarsiBilgi(await getPaymentFor(payFor.to));
    setPayWays(true);
  };

  const tutar = () => parseFloat(payAmount.replace(",", ".")) || 0;

  const acPaypal = async () => {
    if (!karsiBilgi?.paypal) return;
    await Linking.openURL(paypalLink(karsiBilgi.paypal, tutar()));
    setPayWays(false);
    sorKaydet();
  };

  const kopyalaIban = async () => {
    if (!karsiBilgi?.iban) return;
    await Clipboard.setStringAsync(karsiBilgi.iban);
    setPayWays(false);
    setMessage("IBAN kopyalandı");
    sorKaydet();
  };

  /**
   * Odeme yolundan donunce sorulur. Bunsuz insanlar odeyip isaretlemeyi
   * unutuyor ve borc ekranda asili kaliyor -- uygulamanin en cok guven
   * kaybettigi yer orasi olurdu.
   */
  const sorKaydet = () => {
    setTimeout(() => {
      Alert.alert(
        "Ödemeyi kaydedelim mi?",
        `${formatEUR(tutar())} ödediysen kaydedelim; ödemediysen borç olduğu gibi kalır.`,
        [
          { text: "Henüz ödemedim", style: "cancel" },
          { text: "Ödedim, kaydet", onPress: () => confirmPay() },
        ],
      );
    }, 600);
  };

  const isteBilgi = async () => {
    if (!payFor) return;
    const ad = nameOf(payFor.to).split(" ")[0];
    try {
      await Share.share({
        message: `Merhaba ${ad}, KaSa'da ${formatEUR(tutar())} borcum var. `
          + "Ödeme bilgini paylaşır mısın? (Profil → Ödeme Bilgilerim → Paylaş)",
      });
    } catch { /* iptal */ }
    setPayWays(false);
  };

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
      setPayWays(false);
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
          ref={scrollRef}
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
              <View style={{ gap: metrics.cardGap }}>
                {archived && (
                  <View style={[styles.banner, styles.mx]} testID="denge-archived-banner">
                    <Ionicons name="archive-outline" size={16} color={colors.inkSecondary} />
                    <Text style={styles.bannerTxt}>Kapatılmış dönem — yalnızca görüntüleniyor</Text>
                  </View>
                )}

                {/* Tek blok: dönemin bütün borçları, kim kime ne kadar.
                    Beni ilgilendirenler "köprü" düzeninde — tutar ortada ve
                    büyük, taraflar iki uçta. Denkleştirme 3 kişilik evde en
                    fazla 2 transfer üretiyor, yani burada yükseklik harcamak
                    ucuz; Kasa'yı açma sebebi zaten bu blok. Beni
                    ilgilendirmeyen borç aynı kutunun altında tek satıra iniyor
                    ki ev büyürse blok şişmesin. */}
                <Card title="Kim Kime Borçlu" style={styles.mx}>
                  {/* Bir istatistik degil, odesmenin girdisi: "ben ne odedim,
                      payim neydi" sorusu borcun kendisiyle ayni yerde durmali.
                      Istatistik karti bu ekrandan kalkti; sayfasi ayri. */}
                  {stats && stats.expense_count > 0 && (
                    <View style={styles.paidLine}>
                      <Text style={styles.paidLabel}>Senin ödediğin</Text>
                      <Text style={styles.paidValue}>{formatEUR(myPaid)}</Text>
                      <Text style={styles.paidLabel}>· payın</Text>
                      <Text style={styles.paidValue}>{formatEUR(stats.per_person)}</Text>
                    </View>
                  )}
                  {ordered.length === 0 ? (
                    <Row
                      leading={<IconPill name="checkmark-circle" color={colors.accent}
                                         tint={colors.accentSoft} />}
                      title="Herkes ödeşmiş"
                      subtitle="Bu dönemde kimsenin borcu kalmadı"
                      minHeight={metrics.rowHeightLg}
                    />
                  ) : (
                    ordered.map((t, i) => {
                      const mine = t.from === me || t.to === me;
                      const iPay = t.from === me;
                      return (
                        <View key={`${t.from}-${t.to}-${i}`}>
                          {i > 0 && <Divider inset={mine ? 0 : spacing.lg} />}
                          {mine ? (
                            <View style={styles.bridge} testID={`debt-${t.from}-${t.to}`}>
                              <View style={styles.bridgeRow}>
                                <View style={styles.side}>
                                  <Avatar name={nameOf(t.from)}
                                          avatarId={(member(t.from) as any)?.avatar_id}
                                          userId={t.from}
                                          photoVersion={(member(t.from) as any)?.photo_version} />
                                  <Text style={styles.sideName} numberOfLines={1}>{first(t.from)}</Text>
                                </View>
                                <View style={styles.middle}>
                                  <Money value={t.amount} style={styles.bridgeAmount} />
                                  <View style={styles.wire}>
                                    <View style={styles.wireLine} />
                                    <Ionicons name="arrow-forward" size={13} color={colors.inkTertiary} />
                                    <View style={styles.wireLine} />
                                  </View>
                                </View>
                                <View style={styles.side}>
                                  <Avatar name={nameOf(t.to)}
                                          avatarId={(member(t.to) as any)?.avatar_id}
                                          userId={t.to}
                                          photoVersion={(member(t.to) as any)?.photo_version} />
                                  <Text style={styles.sideName} numberOfLines={1}>{first(t.to)}</Text>
                                </View>
                              </View>
                              {!archived && (
                                <Pressable
                                  style={[styles.bridgeBtn, iPay ? styles.btnDark : styles.btnSoft]}
                                  onPress={() => openPay(t)}
                                  testID={iPay ? `mark-paid-to-${t.to}` : `mark-paid-${t.from}`}
                                >
                                  <Text style={iPay ? styles.btnDarkTxt : styles.btnSoftTxt}>
                                    {iPay ? "Ödedim" : "Ödendi"}
                                  </Text>
                                </Pressable>
                              )}
                            </View>
                          ) : (
                            <View style={styles.otherRow}>
                              <Text style={styles.otherTxt} numberOfLines={1}>
                                {first(t.from)} <Text style={styles.arrow}>→</Text> {first(t.to)}
                              </Text>
                              <Money value={t.amount} color={colors.inkTertiary}
                                     style={styles.otherAmount} />
                            </View>
                          )}
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
          <BottomSheet visible onClose={() => { setPayFor(null); setError(null); setPayWays(false); }}>
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
                testID="settlement-amount"
              />
              <Text style={styles.payCur}>€</Text>
            </View>
            {error && <Text style={styles.err}>{error}</Text>}

            {/* "Ode" ve "Odedim" AYNI tutar sayfasindan cikiyor: kismi odeme
                tek yerde giriliyor. Ode kayit olusturmuyor -- banka yolunu
                aciyor; asil transferi kullanici kendi bankasinda tamamliyor.
                Donuste "kaydedelim mi?" diye soruluyor, yoksa insanlar odeyip
                isaretlemeyi unutuyor. */}
            {payFor.from === me && (
              <View style={styles.confirmRow}>
                <Pressable style={styles.solid} onPress={odeYollari} testID="pay-open">
                  <Text style={styles.solidTxt}>Öde</Text>
                </Pressable>
                <Pressable style={styles.ghost} onPress={confirmPay} disabled={busy}
                           testID="confirm-settlement">
                  {busy ? <ActivityIndicator color={colors.dark} />
                        : <Text style={styles.ghostTxt}>Ödedim</Text>}
                </Pressable>
              </View>
            )}
            {payFor.from !== me && (
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
            )}
            {payFor.from === me && (
              <Text style={styles.payFoot}>
                "Öde" kayıt oluşturmaz — banka ya da PayPal'ı açar.
              </Text>
            )}
          </BottomSheet>
        )}

        {/* Odeme yollari. Karsi tarafin bilgisi CIHAZDA: sunucuda tutulmuyor,
            bir kez paylasildiginda kaydediliyor. Yoksa istenebiliyor. */}
        {payWays && payFor && (
          <BottomSheet visible onClose={() => setPayWays(false)}>
            <Text style={[overline, styles.waysTitle]}>
              {nameOf(payFor.to).split(" ")[0].toLocaleUpperCase("tr")} · {formatEUR(parseFloat(payAmount.replace(",", ".")) || 0)}
            </Text>
            {karsiBilgi?.paypal ? (
              <Pressable style={styles.wayRow} onPress={() => acPaypal()} testID="way-paypal">
                <View style={styles.wayIcon}>
                  <Ionicons name="logo-paypal" size={18} color={colors.onInfo} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.wayTitle}>PayPal ile öde</Text>
                  <Text style={styles.wayDesc}>Tutar dolu gelir, tek dokunuş</Text>
                </View>
                <Ionicons name="open-outline" size={18} color={colors.inkTertiary} />
              </Pressable>
            ) : null}
            {karsiBilgi?.iban ? (
              <>
                {karsiBilgi?.paypal ? <Divider inset={spacing.lg} /> : null}
                <Pressable style={styles.wayRow} onPress={() => kopyalaIban()} testID="way-iban">
                  <View style={styles.wayIcon}>
                    <Ionicons name="copy-outline" size={18} color={colors.inkSecondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.wayTitle}>IBAN'ı kopyala</Text>
                    <Text style={styles.wayIban}>{formatIban(karsiBilgi.iban)}</Text>
                    {karsiBilgi.holder ? (
                      <Text style={styles.wayDesc}>{karsiBilgi.holder}</Text>
                    ) : null}
                  </View>
                </Pressable>
              </>
            ) : null}
            {!karsiBilgi?.iban && !karsiBilgi?.paypal && (
              <View style={styles.wayEmpty}>
                <Text style={styles.wayEmptyTxt}>
                  {nameOf(payFor.to).split(" ")[0]} ödeme bilgisini henüz paylaşmamış.
                </Text>
                <Pressable style={styles.solid} onPress={() => isteBilgi()} testID="way-ask">
                  <Text style={styles.solidTxt}>İste</Text>
                </Pressable>
              </View>
            )}
          </BottomSheet>
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
  bridge: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  bridgeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  side: { width: 62, alignItems: "center" },
  sideName: { ...T.caption, color: colors.inkSecondary, marginTop: 5 },
  middle: { flex: 1, alignItems: "center" },
  bridgeAmount: { fontSize: 21, lineHeight: 27, fontFamily: fontFamily.semibold, letterSpacing: -0.5 },
  wire: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "stretch", marginTop: 6 },
  wireLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
  bridgeBtn: {
    alignSelf: "center", marginTop: spacing.md, minHeight: 38, justifyContent: "center",
    paddingHorizontal: spacing.xl, borderRadius: radius.pill,
  },
  btnDark: { backgroundColor: colors.brand },
  btnDarkTxt: { ...T.bodySb, color: colors.onBrand },
  btnSoft: { backgroundColor: colors.accentSoft },
  btnSoftTxt: { ...T.bodySb, color: colors.accentDark },
  // Başkalarının arasındaki borç: aynı kutuda ama sessiz ve tek satır.
  otherRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, minHeight: 44,
  },
  otherTxt: { ...T.body, color: colors.inkSecondary, flex: 1 },
  otherAmount: { ...T.bodySb },
  arrow: { color: colors.inkTertiary },

  stlRight: { alignItems: "flex-end", gap: 2 },
  undo: { ...T.caption, color: colors.negative },

  paidLine: {
    flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap",
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs,
  },
  paidLabel: { ...T.caption, color: colors.inkTertiary },
  paidValue: { ...T.captionSb, color: colors.ink },
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
  payFoot: {
    ...T.caption, color: colors.inkTertiary, textAlign: "center",
    paddingHorizontal: spacing.lg, marginTop: spacing.sm, lineHeight: 17,
  },
  waysTitle: { paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  wayRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 64,
  },
  wayIcon: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  wayTitle: { ...T.emph, color: colors.ink },
  wayDesc: { ...T.caption, color: colors.inkTertiary, marginTop: 1 },
  wayIban: { ...T.caption, color: colors.inkSecondary, marginTop: 1, letterSpacing: 0.3 },
  wayEmpty: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.sm },
  wayEmptyTxt: { ...T.body, color: colors.inkSecondary, lineHeight: 20 },
  payCur: { ...T.screen, color: colors.inkSecondary },
});
