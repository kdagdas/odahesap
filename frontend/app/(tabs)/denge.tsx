/** Kasa — kişisel hesap. Ev toplamları Anasayfa'ya taşındı; burada senin
 *  net durumun, kimin kime borçlu olduğu tek blok halinde, dönem istatistikleri
 *  ve dönem yönetimi var. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable,
  RefreshControl, TextInput, KeyboardAvoidingView, Platform, Share, Linking,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { apiGet, apiPost, apiDelete } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, HeaderSplit, Sheet, Card, Row, Divider, Avatar, Money,
  IconPill, PrimaryButton, BottomSheet, PulseDot, HeaderPills, HeaderPill,
  useCountUp, formatEUR, currencySign,
  useScrollPad,
} from "@/src/ui";
import {
  getPaymentFor, getMyPayment, hasSharedPayment, markPaymentShared,
  shareText, paypalLink, formatIban, type PaymentInfo,
} from "@/src/payment";
import { colors, spacing, radius, type as T, overline, fontFamily, metrics } from "@/src/theme";

type Transfer = { from: string; to: string; amount: number };
type Period = {
  period_id: string; started_at: string; closed_at: string | null; status: string;
  first_expense?: string | null; last_expense?: string | null;
  expense_count?: number; expense_total?: number;
};
type Settlement = {
  settlement_id: string; from_user_id: string; to_user_id: string;
  amount: number; recorded_by: string; created_at: string;
};
type Stats = {
  total: number; per_person: number; daily_average: number; expense_count: number;
  item_count: number; avg_expense: number; member_count: number;
  my_share: number; my_paid: number;
  by_member: { user_id: string; total: number }[];
  daily_series: { day: string; total: number }[];
  merchants: { name: string; total: number }[];
};

/**
 * Dönem etiketi — HARCAMA aralığı, dönem kaydının damgası değil.
 *
 * `started_at` bir muhasebe damgası: ev kurulup ilk dönem aynı gün kapandıysa
 * "3 Ağu – 3 Ağu" çıkıyor ve iki dönem ayırt edilemiyor. İnsanın hatırladığı
 * şey alışveriş yapılan günler. Aynı ay içindeyse ay bir kez yazılıyor
 * (banka ekstrelerindeki gibi), harcama yoksa tek tarih.
 */
const AY_KISA = ["Oca", "Şub", "Mar", "Nis", "May", "Haz",
                 "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const AY_UZUN = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
                 "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

const periodLabel = (p: Period) => {
  const ilk = p.first_expense, son = p.last_expense;
  if (!ilk) {
    const d = new Date(p.started_at);
    return `${d.getDate()} ${AY_UZUN[d.getMonth()]}`;
  }
  const [, ay1, g1] = ilk.split("-").map(Number);
  const bitis = p.status === "active" ? null : son;
  if (!bitis || bitis === ilk) return `${g1} ${AY_UZUN[ay1 - 1]}`;
  const [, ay2, g2] = bitis.split("-").map(Number);
  // Ayni ay: "3 - 16 Agustos". Farkli ay: "28 Tem - 2 Agustos".
  return ay1 === ay2
    ? `${g1} – ${g2} ${AY_UZUN[ay2 - 1]}`
    : `${g1} ${AY_KISA[ay1 - 1]} – ${g2} ${AY_UZUN[ay2 - 1]}`;
};

const periodHint = (p: Period) => {
  const durum = p.status === "active" ? "Sürüyor" : "Kapandı";
  if (!p.expense_count) return `${durum} · harcama yok`;
  return `${durum} · ${p.expense_count} harcama · ${formatEUR(p.expense_total)}`;
};

const relativeDay = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? "bugün" : days === 1 ? "dün" : `${days} gün önce`;
};


export default function Denge() {
  const router = useRouter();
  const { user } = useAuth();
  const { members, activePeriod, isAdmin, refresh: refreshHH } = useHousehold();
  const scrollRef = useRef<ScrollView>(null);
  // Sekme cubugunun ve telefonun gezinme cubugunun kapladigi yer.
  // Elle yazilan 120/130 sabitleri cubuk yuksekligiyle birlikte
  // degismiyordu; olcu artik tek yerden geliyor.
  const altPay = useScrollPad({ tabs: true });

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
  const [error, setError] = useState<string | null>(null);

  /**
   * Gecici bildirim satiri -- kendiliginden kayboluyor.
   *
   * Onceden `setMessage` bir daha temizlenmiyordu: "Odeme kaydi kaldirildi"
   * ekranda asili kaliyor ve bir sonraki acilista hala orada duruyordu, yani
   * olmus bitmis bir isi guncel bir durum gibi gosteriyordu.
   */
  const [message, setMessage] = useState<string | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const duyur = useCallback((txt: string | null) => {
    setMessage(txt);
    if (msgTimer.current) clearTimeout(msgTimer.current);
    if (txt) msgTimer.current = setTimeout(() => setMessage(null), 4500);
  }, []);
  useEffect(() => () => { if (msgTimer.current) clearTimeout(msgTimer.current); }, []);

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

  /**
   * Alacakli tarafin "bilgimi gonder" durumu.
   *
   * Odeme bilgisini paylasabilecek TEK kisi alacaklidir, ama bugune kadar o
   * yol yalnizca Profil'in icindeydi: borclu "Iste" diyor, WhatsApp'tan mesaj
   * gidiyor, alacaklinin mesaji okuyup Profil -> Odeme Bilgilerim -> Paylas
   * yolunu bulmasi gerekiyordu. Dort adim, iki kisi, iki uygulama -- ustelik
   * alacakli o ekrani hic kesfetmemis olabilir. Oysa "Salih sana 42 EUR
   * borclu" yazan ekrana zaten bakiyor; hamleyi yapacagi an tam orasi.
   */
  // Ikisi TEK okumada geliyor: ayri ayri cozulselerdi ilk kare yanlis dugmeyi
  // gosterip hemen otekine atlardi.
  const [bilgim, setBilgim] = useState<{ info: PaymentInfo; paylasildi: boolean } | null>(null);
  const bilgimVar = !!(bilgim?.info.iban || bilgim?.info.paypal);

  useFocusEffect(useCallback(() => {
    load();
    // Odaklanmada yeniden okunuyor: kullanici formu doldurup DONDUGUNDE
    // dugmenin "ekle"den "gonder"e gecmesi lazim.
    Promise.all([getMyPayment(), hasSharedPayment()])
      .then(([info, paylasildi]) => setBilgim({ info, paylasildi }));
  }, [load]));

  const paylasBilgim = async () => {
    if (!bilgim) return;
    if (!bilgimVar) { router.push("/odeme-bilgilerim"); return; }
    try {
      await Share.share({ message: shareText(user?.name || "Ev arkadaşın", me, bilgim.info) });
      // Iptal edilse bile isaretleniyor: bu bir kanit degil, yalnizca dugmenin
      // buyuk mu kucuk mu duracagi. Yanlis olmasi hicbir seye mal olmuyor.
      await markPaymentShared();
      setBilgim((b) => (b ? { ...b, paylasildi: true } : b));
    } catch { /* iptal */ }
  };

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

  // `by_member` yalnizca EV harcamalarini sayiyor; bu satir ise bakiyeyi
  // acikliyor, yani Salih icin odedigin de dahil olmali.
  const myPaid = stats?.my_paid ?? 0;
  // Pencere KART BASLIGINDA: ayni kelime ("payin") Istatistik'te de
  // geciyor ama orasi takvim ayi. Basliga yazmak karsilastirma
  // sorusunu bastan kapatiyor.
  const currentDonem = periods.find((p) => p.period_id === currentId);
  const currentDonemTxt = currentDonem ? periodLabel(currentDonem) : "";
  const sayanNet = useCountUp(myNet);

  /**
   * Odeme sayfasi TEK yuz.
   *
   * Onceden iki yuzdu (once tutar, sonra yollar) ve tutar yuzu bir gise
   * gibiydi: tutar zaten dolu geliyordu, kullanici ona bakip yeniden "Ode"ye
   * basiyordu. Ustelik karsi taraf bilgisini paylasmamissa akis orada
   * cikmaza giriyordu -- nakit odeyen birinin bile yolu kapaliydi.
   *
   * Simdi hepsi tek sayfada ve tek koyu dugme var: tutar ustte (cipler
   * kismi odemeyi ayri bir dugme olmaktan cikariyor), ortada yollar,
   * en altta kayit. Yollar sessiz liste satiri, cunku parayi tasiyan biz
   * degiliz; bizim sahip oldugumuz tek is en alttaki kayit.
   */
  const [karsiBilgi, setKarsiBilgi] = useState<PaymentInfo | null>(null);
  // Bir odeme yoluna gidilip donuldu mu? Donuste kayit satirinda isaret yanar.
  const [yolaGidildi, setYolaGidildi] = useState(false);
  const tutarRef = useRef<TextInput>(null);

  const iPay = payFor?.from === me;
  const tutar = () => parseFloat(payAmount.replace(",", ".")) || 0;
  const setTutar = (v: number) => {
    setError(null);
    setPayAmount(v.toFixed(2).replace(".", ","));
  };

  const acPaypal = async () => {
    if (!karsiBilgi?.paypal) return;
    await Linking.openURL(paypalLink(karsiBilgi.paypal, tutar()));
    setYolaGidildi(true);
  };

  const kopyalaIban = async () => {
    if (!karsiBilgi?.iban) return;
    await Clipboard.setStringAsync(karsiBilgi.iban);
    duyur("IBAN kopyalandı");
    setYolaGidildi(true);
  };

  const isteBilgi = async () => {
    if (!payFor) return;
    const ad = nameOf(payFor.to).split(" ")[0];
    try {
      await Share.share({
        message: `Merhaba ${ad}, KaSa'da sana ${formatEUR(payFor.amount)} borcum var. `
          + "Ödeme bilgini paylaşır mısın? (Profil → Ödeme Bilgilerim → Paylaş)",
      });
    } catch { /* iptal */ }
  };

  const openPay = async (t: Transfer) => {
    setPayFor(t);
    setPayAmount(t.amount.toFixed(2).replace(".", ","));
    setYolaGidildi(false);
    setError(null); duyur(null);
    // Yollar sayfayla birlikte aciliyor; ayri bir adim beklemesin.
    setKarsiBilgi(t.from === me ? await getPaymentFor(t.to) : null);
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
      duyur("Ödeme kaydedildi");
    } catch (e: any) { setError(e?.message || "Kaydedilemedi"); }
    finally { setBusy(false); }
  };

  const undoSettlement = async (id: string) => {
    setBusy(true); setError(null);
    try { await apiDelete(`/settlements/${id}`); await load(); duyur("Ödeme kaydı kaldırıldı"); }
    catch (e: any) { setError(e?.message || "Kaldırılamadı"); }
    finally { setBusy(false); }
  };

  const closePeriod = async () => {
    setBusy(true); setError(null); duyur(null);
    try {
      await apiPost("/periods/close", {});
      await refreshHH(); setSelected(undefined); await load();
      setMode("none"); duyur("Dönem kapatıldı, yeni dönem başladı");
    } catch (e: any) { setError(e?.message || "İşlem başarısız"); }
    finally { setBusy(false); }
  };

  const reopenPeriod = async () => {
    setBusy(true); setError(null); duyur(null);
    try {
      await apiPost("/periods/reopen", {});
      await refreshHH(); setSelected(undefined); await load();
      setMode("none"); duyur("Dönem yeniden açıldı");
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
          contentContainerStyle={[styles.scroll, altPay]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}
                            tintColor={colors.ink} progressBackgroundColor={colors.surface} />
          }
        >
          <ScreenHeader overline="KASA" title="Senin Hesabın">
            <Text style={styles.heroLabel}>NET DURUMUN</Text>
            {/* Sayarak degisiyor: odeme kaydedince rakamin bir anda atlamasi
                "oldu mu olmadi mi" sorusunu birakiyordu. */}
            <Text style={[styles.heroValue,
                          { color: myNet >= 0 ? colors.accentOnDark : colors.negativeOnDark }]}>
              {formatEUR(sayanNet, true)}
            </Text>
            <Text style={styles.heroHint}>
              {myNet > 0.01 ? "Ev sana borçlu" : myNet < -0.01 ? "Eve borcun var" : "Ödeşmiş durumdasın"}
            </Text>
            {/* Sifir olan sutun GOSTERILMIYOR. "Sana borçlu 0,00 €" gerçek
                bir sayıyla aynı yeri kaplayıp hiçbir şey söylemiyordu; iki
                kişilik bir borçta ayrıca üstteki net rakamın tekrarıydı. */}
            {/* Tek tarafli borcta bu satir ustteki net rakamin TEKRARI olur
                (net −40,60 · senin borcun 40,60 · kopruden 40,60 = uc kez).
                Yalnizca iki taraf da doluysa bilgi tasiyor. */}
            {owedToMe > 0.005 && iOwe > 0.005 && (
              <HeaderSplit items={[
                ...(owedToMe > 0.005
                  ? [{ label: "Sana borçlu", value: formatEUR(owedToMe), accent: true }] : []),
                ...(iOwe > 0.005
                  ? [{ label: "Senin borcun", value: formatEUR(iOwe) }] : []),
              ]} />
            )}
            {/* Süzgeç *içerik* değil BAĞLAM: "neye bakıyorum" sorusunun
                parçası, başlık ve toplamlarla aynı yerde durmalı. Beyaz
                yüzeyde kart olarak içerikle aynı ağırlığa giriyordu. */}
            {periods.length > 1 && (
              <HeaderPills>
                <HeaderPill
                  value={currentId || ""}
                  options={periods.map((p, i) => ({
                    value: p.period_id,
                    label: periodLabel(p),
                    hint: periodHint(p),
                    icon: p.status === "active" ? "flash" : "archive-outline",
                    iconAccent: p.status === "active",
                  }))}
                  onSelect={(v) => setSelected(v === activeId ? undefined : v)}
                  testID="denge-period"
                />
              </HeaderPills>
            )}
          </ScreenHeader>

          <Sheet>
            {loading ? (
              <ActivityIndicator color={colors.ink} style={{ marginTop: spacing.xxl }} />
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
                <Card title={`Kim Kime Borçlu · ${currentDonemTxt}`} style={styles.mx}>
                  {/* Bir istatistik degil, odesmenin girdisi: "ben ne odedim,
                      payim neydi" sorusu borcun kendisiyle ayni yerde durmali.
                      Istatistik karti bu ekrandan kalkti; sayfasi ayri. */}
                  {stats && stats.expense_count > 0 && (
                    <View style={styles.paidLine}>
                      <Text style={styles.paidLabel}>Senin ödediğin</Text>
                      <Text style={styles.paidValue}>{formatEUR(myPaid)}</Text>
                      {/* GERCEK pay: once `per_person` (toplam/uye sayisi)
                          gosteriliyordu ve kisiye ozel bolusmede yanlisti --
                          "odedigin - payin" ustteki net durumu tutmuyordu. */}
                      <Text style={styles.paidLabel}>· payın</Text>
                      <Text style={styles.paidValue}>{formatEUR(stats.my_share)}</Text>
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
                                <>
                                <View style={styles.bridgeActions}>
                                  <Pressable
                                    style={[styles.bridgeBtn, iPay ? styles.btnDark : styles.btnQuiet]}
                                    onPress={() => openPay(t)}
                                    testID={iPay ? `mark-paid-to-${t.to}` : `mark-paid-${t.from}`}
                                  >
                                    <Text style={iPay ? styles.btnDarkTxt : styles.btnQuietTxt}>
                                      {iPay ? "Öde" : "Ödedi"}
                                    </Text>
                                  </Pressable>
                                  {/* Alacakliya, ilk paylasima kadar. Hic bilgi
                                      girmemisse dugme "Paylas" demiyor -- formu
                                      aciyor; asil kesfedilmeyen sey o form. */}
                                  {!iPay && bilgim && !bilgim.paylasildi && (
                                    <Pressable
                                      style={[styles.bridgeBtn, styles.btnOutline]}
                                      onPress={paylasBilgim}
                                      testID={`share-payment-${t.from}`}
                                    >
                                      <Text style={styles.btnOutlineTxt} numberOfLines={1}>
                                        {bilgimVar ? "Bilgimi gönder" : "Ödeme bilgini ekle"}
                                      </Text>
                                    </Pressable>
                                  )}
                                </View>
                                {/* Paylastiktan sonra KAYBOLMUYOR, kuculuyor:
                                    IBAN degisir, eve yeni biri katilir. */}
                                {!iPay && bilgim?.paylasildi && (
                                  <Pressable onPress={paylasBilgim} hitSlop={10}
                                             style={styles.shareAgain}
                                             testID={`share-payment-${t.from}`}>
                                    <Ionicons name="share-social-outline" size={13}
                                              color={colors.inkTertiary} />
                                    <Text style={styles.shareAgainTxt}>
                                      Ödeme bilgimi gönder
                                    </Text>
                                  </Pressable>
                                )}
                                </>
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
                        {/* Boyutu KORUNUYOR -- yaptigi is buyuk ve bulunmasi
                            kolay olmali. Ama ortada odenmemis borc varken
                            kendini "hazir" gostermiyor.
                            PROJE-DOKUMANI §12'de yazan endise tam da bu:
                            "kolayca basilan bir dugme insanlari odesmeden
                            arsivlemeye iter". Bugun bu dugme ekranin en koyu,
                            en genis ogesi ve basparmagin en rahat ulastigi
                            yerde duruyor. Artik agirligini hak ettigi anda
                            kazaniyor: herkes odestiyse koyu ve davetkar,
                            borc varken sonuk. */}
                        <PrimaryButton label="Dönemi Kapat & Denkleştir" icon="checkmark-done"
                                       onPress={() => setMode("close")} testID="close-period-btn"
                                       tone={ordered.length > 0 ? "muted" : undefined} />
                        {ordered.length > 0 && (
                          <Text style={styles.footNote}>
                            {ordered.length === 1
                              ? "Bir borç henüz ödenmedi"
                              : `${ordered.length} borç henüz ödenmedi`}
                          </Text>
                        )}
                        {canReopen && (
                          <Pressable style={styles.undoBtn} onPress={() => setMode("reopen")}
                                     testID="reopen-period-btn">
                            <Ionicons name="arrow-undo" size={15} color={colors.inkSecondary} />
                            <Text style={styles.undoBtnTxt}>Son kapatmayı geri al</Text>
                          </Pressable>
                        )}
                      </>
                    )}

                  </View>
                )}
              </View>
            )}
          </Sheet>
        </ScrollView>

        {/* TEK yuz. Ust bolge tutar, orta bolge yollar, alt bolge kayit --
            aralarinda yalnizca sac teli cizgi var. Ekranda TEK koyu dugme
            duruyor: kalabalik hissini yaratan sey oge sayisi degil, esit
            bagiran ogelerdi. */}
        {payFor && (
          <BottomSheet
            visible
            onClose={() => { setPayFor(null); setError(null); }}
            testID="pay-sheet"
          >
            <Text style={[overline, styles.payOver]}>
              {iPay
                ? `${first(payFor.to).toLocaleUpperCase("tr")} KİŞİSİNE ÖDEME`
                : `${first(payFor.from).toLocaleUpperCase("tr")} KİŞİSİNDEN TAHSİLAT`}
            </Text>

            {/* Tutar bir soru degil, ekranda duran bir alan: dolu geliyor ve
                dokununca duzeltiliyor. Ayri bir "kismi ode" dugmesi yok --
                cipler o isi goruyor ve nadir durum sik durumla ayni yeri
                kaplamiyor. */}
            <View style={styles.amountRow}>
              <TextInput
                ref={tutarRef}
                style={styles.amountInput}
                value={payAmount}
                onChangeText={(v) => { setError(null); setPayAmount(v.replace(/[^\d.,]/g, "")); }}
                keyboardType="decimal-pad"
                selectTextOnFocus
                testID="settlement-amount"
              />
              <Text style={styles.amountCur}>{currencySign()}</Text>
            </View>

            <View style={styles.quick}>
              {[
                { k: "tam", label: "Tamamı", v: payFor.amount },
                { k: "yari", label: "Yarısı", v: Math.round(payFor.amount * 50) / 100 },
              ].map((q) => {
                const on = Math.abs(tutar() - q.v) < 0.005;
                return (
                  <Pressable
                    key={q.k}
                    style={[styles.quickChip, on && styles.quickChipOn]}
                    onPress={() => setTutar(q.v)}
                    testID={`pay-quick-${q.k}`}
                  >
                    <Text style={[styles.quickTxt, on && styles.quickTxtOn]}>{q.label}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                style={styles.quickChip}
                onPress={() => tutarRef.current?.focus()}
                testID="pay-quick-other"
              >
                <Text style={styles.quickTxt}>Başka</Text>
              </Pressable>
            </View>

            {error && <Text style={styles.err} testID="pay-error">{error}</Text>}

            {/* Yollar yalnizca ODEYEN tarafta. Karsi tarafin bilgisi CIHAZDA:
                sunucuda tutulmuyor, bir kez paylasildiginda kaydediliyor. */}
            {iPay && (
              <>
                <View style={styles.hair} />
                {karsiBilgi?.paypal ? (
                  <Pressable style={styles.wayRow} onPress={acPaypal} testID="way-paypal">
                    <View style={[styles.wayIcon, { backgroundColor: colors.infoSoft }]}>
                      <Ionicons name="logo-paypal" size={17} color={colors.onInfo} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.wayTitle}>PayPal ile öde</Text>
                      <Text style={styles.wayDesc}>Tutar dolu gider</Text>
                    </View>
                    <Ionicons name="open-outline" size={17} color={colors.inkTertiary} />
                  </Pressable>
                ) : null}
                {karsiBilgi?.paypal && karsiBilgi?.iban ? <Divider inset={64} /> : null}
                {karsiBilgi?.iban ? (
                  <Pressable style={styles.wayRow} onPress={kopyalaIban} testID="way-iban">
                    <View style={styles.wayIcon}>
                      <Ionicons name="copy-outline" size={17} color={colors.inkSecondary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.wayTitle}>IBAN{"’"}ı kopyala</Text>
                      <Text style={styles.wayIban} numberOfLines={1}>{formatIban(karsiBilgi.iban)}</Text>
                    </View>
                  </Pressable>
                ) : null}
                {/* Bilgi yoksa artik CIKMAZ degil, sadece bir satir eksik:
                    alttaki nakit kaydi her durumda duruyor. */}
                {!karsiBilgi?.paypal && !karsiBilgi?.iban ? (
                  <Pressable style={styles.wayRow} onPress={isteBilgi} testID="way-ask">
                    <View style={styles.wayIcon}>
                      <Ionicons name="help-circle-outline" size={17} color={colors.inkSecondary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.wayTitle}>
                        {first(payFor.to)} ödeme bilgisini paylaşmamış
                      </Text>
                      <Text style={styles.wayDesc}>Dokun, iste</Text>
                    </View>
                    <Ionicons name="share-outline" size={17} color={colors.inkTertiary} />
                  </Pressable>
                ) : null}
              </>
            )}

            {/* Uygulamanin gercekten sahip oldugu tek is. Bir yola gidilip
                donulduyse yaninda isaret yaniyor -- eskiden bunun yerine
                ekranin ortasina Alert firliyordu. */}
            <View style={styles.hair} />
            <View style={styles.recordRow}>
              <View style={{ flex: 1 }}>
                {/* Aciklama yalnizca ODEYEN tarafta anlamli: orada yollar da
                    var, "bu kayit olusturur" ayrimi gerekiyor. Alacaklida
                    yapilacak tek is zaten kayit. */}
                {iPay ? (
                  <>
                    <View style={styles.recordHead}>
                      {yolaGidildi && <PulseDot size={7} trigger={1} />}
                      <Text style={styles.wayTitle}>Nakit / elden ödedim</Text>
                    </View>
                    <Text style={styles.wayDesc}>
                      {yolaGidildi ? "Ödediysen kaydedelim" : "Yalnızca kayıt oluşturur"}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.wayTitle}>Ödedi</Text>
                )}
              </View>
              <Pressable style={styles.recordBtn} onPress={confirmPay} disabled={busy}
                         testID="confirm-settlement">
                {busy ? <ActivityIndicator color={colors.onBrand} />
                      : <Text style={styles.recordTxt}>Kaydet</Text>}
              </Pressable>
            </View>
          </BottomSheet>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  scroll: { backgroundColor: colors.bg, flexGrow: 1 },
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
  // Iki dugme yan yana durabilmeli; dar telefonda ikincisi kirilmadan kissin.
  bridgeActions: {
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: spacing.sm,
  },
  btnDark: { backgroundColor: colors.brand },
  btnDarkTxt: { ...T.bodySb, color: colors.onBrand },
  // Yesil DOLGU "bu odenmis" diye okunuyordu -- rengi de sozu de durum
  // bildiriyordu, oysa bir eylem. Kenarlikli notr, ve "Odendi" degil "Odedi":
  // karsisindaki "Ode" ile ayni fiil, satir tek dil konusuyor.
  btnQuiet: {
    borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface,
  },
  btnQuietTxt: { ...T.bodySb, color: colors.inkSecondary },
  // Ikincil eylem: dolu degil kenarlikli. "Odendi" ile ayni agirlikta olsaydi
  // hangisinin asil is oldugu okunmazdi.
  btnOutline: {
    borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg, flexShrink: 1,
  },
  btnOutlineTxt: { ...T.captionSb, color: colors.inkSecondary },
  shareAgain: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    alignSelf: "center", marginTop: spacing.sm,
  },
  shareAgainTxt: { ...T.caption, color: colors.inkTertiary },
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
  err: {
    ...T.bodySb, color: colors.negative, textAlign: "center",
    paddingHorizontal: spacing.lg, marginTop: spacing.sm,
  },
  confirm: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
             borderColor: colors.border, padding: spacing.lg, gap: spacing.md },
  confirmTxt: { ...T.body, color: colors.inkSecondary, textAlign: "center" },
  confirmRow: {
    flexDirection: "row", gap: spacing.md,
    paddingHorizontal: spacing.lg, marginTop: spacing.md,
  },
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
  // --- odeme sayfasi (tek yuz) ---
  payOver: { paddingHorizontal: spacing.lg },
  amountRow: {
    flexDirection: "row", alignItems: "baseline", gap: spacing.sm,
    paddingHorizontal: spacing.lg, marginTop: 2,
  },
  // Kutusuz: tutar bir form alani gibi degil, sayfanin basligi gibi okunmali.
  amountInput: {
    fontSize: 32, lineHeight: 40, fontFamily: fontFamily.bold,
    color: colors.ink, letterSpacing: -1, paddingVertical: 2, minWidth: 120,
  },
  amountCur: { fontSize: 22, lineHeight: 28, fontFamily: fontFamily.semibold, color: colors.inkTertiary },
  quick: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  quickChip: {
    flex: 1, alignItems: "center", justifyContent: "center", minHeight: 34,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  quickChipOn: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  quickTxt: { ...T.captionSb, color: colors.inkSecondary },
  quickTxtOn: { color: colors.accentDark },
  hair: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider, marginTop: spacing.lg },
  recordRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, minHeight: 60,
  },
  recordHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  // Sayfadaki TEK koyu dugme.
  recordBtn: {
    minHeight: 42, paddingHorizontal: spacing.xl, justifyContent: "center",
    borderRadius: radius.pill, backgroundColor: colors.brand,
  },
  recordTxt: { ...T.bodySb, color: colors.onBrand },
  wayRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, minHeight: 58,
  },
  wayIcon: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  wayTitle: { ...T.body, color: colors.ink },
  wayDesc: { ...T.caption, color: colors.inkTertiary, marginTop: 1 },
  wayIban: { ...T.caption, color: colors.inkSecondary, marginTop: 1, letterSpacing: 0.3 },
});
