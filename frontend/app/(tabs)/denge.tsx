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
  ScreenHeader, Sheet, Card, Row, Divider, Avatar, Money,
  IconPill, PrimaryButton, BottomSheet, PulseDot,
  useCountUp, formatEUR, currencySign, ayAdi,
  useScrollPad,
} from "@/src/ui";
import {
  getPaymentFor, getMyPayment, hasSharedPayment, markPaymentShared,
  shareText, paypalLink, formatIban, type PaymentInfo,
} from "@/src/payment";
import { colors, spacing, radius, type as T, overline, fontFamily, metrics } from "@/src/theme";

type Transfer = { from: string; to: string; amount: number };
/** Bir ayın içindeki hareket türü — `artiran` borcu büyüten taraf. */
type Hareket = { tur: string; tutar: number; artiran: boolean };
/** Bakiyenin ay ay dökümü — `share` borcu artıran, `paid` azaltan taraf. */
type EkstreAy = {
  month: string; share: number; paid: number; delta: number; lines?: Hareket[];
};
type Ekstre = { months: EkstreAy[]; carried: number; current_month: string };

/**
 * Hareket türlerinin ekrandaki adı. Sunucu yalnızca anahtar gönderiyor.
 *
 * `fisli` olanlar Harcamalar'a açılıyor; ödeme kayıtlarının altında fiş yok,
 * onlar Ödeme Geçmişi'nde yaşıyor.
 */
const TUR_ADI: Record<string, { ad: string; fisli: boolean }> = {
  pay: { ad: "Ev alışverişlerindeki payın", fisli: true },
  ev_odedigin: { ad: "Senin ödediğin ev alışverişleri", fisli: true },
  baskasi_icin: { ad: "Başkası için aldıkların", fisli: true },
  senin_icin: { ad: "Senin için alınanlar", fisli: true },
  odemelerin: { ad: "Kaydettiğin ödemeler", fisli: false },
  sana_odenen: { ad: "Sana ödenenler", fisli: false },
};
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

/** Ödeme geçmişinde katlanmadan görünen kayıt sayısı. */
const GECMIS_KISA = 3;

const relativeDay = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? "bugün" : days === 1 ? "dün" : `${days} gün önce`;
};


/**
 * Ekstrenin tek satırı — lacivert başlığın içinde, dokunulabilir.
 *
 * Açıkken satır `darkSurface` ile vurgulanıyor ve ok aşağı dönüyor. Vurgu
 * şart: açılım kavisin ALTINDA, beyaz alanda duruyor, yani dokunulan satır
 * ile açılan kart arasında bir boşluk var. Vurgu olmasa hangi satırın
 * karşılığı olduğu kaybolurdu.
 *
 * Açılım neden lacivertin içinde değil: satırlar 12 punto, orada altı satır
 * daha açmak okunmaz bir yığın yapar. Ayrıca lacivert alan bu turda "L boy"
 * olarak tanımlandı; içeriğe göre uzayınca üç boy sistemi anlamını yitirir.
 */
function EkstreSatir({
  etiket, tutar, eksi, acik, onPress, testID,
}: {
  etiket: string; tutar: string; eksi?: boolean;
  acik: boolean; onPress: () => void; testID: string;
}) {
  return (
    <Pressable onPress={onPress} testID={testID}
               style={[styles.ekstreRow, styles.ekstreTiklanir, acik && styles.ekstreAcik]}>
      <Text style={styles.ekstreLabel}>{etiket}</Text>
      <Text style={[styles.ekstreVal, eksi && styles.ekstreEksi]}>{tutar}</Text>
      <Ionicons name={acik ? "chevron-down" : "chevron-forward"} size={14}
                color={acik ? colors.onDark : colors.onDarkMuted} />
    </Pressable>
  );
}

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
  /** Bakiyenin ay ay dökümü — ekstre bloğu ve borç dökümü aynı hesaptan. */
  const [ekstre, setEkstre] = useState<Ekstre | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"none" | "close" | "reopen">("none");
  const [gecmisAcik, setGecmisAcik] = useState(false);
  /**
   * Ekstrenin açık satırı — `carried` · `share` · `paid`, ya da kapalı.
   *
   * Kimlik ETİKETE değil VERİYE bağlı: alacaklıyken "Ağustos'ta ödediklerin"
   * ile "Senin payın" yer değiştiriyor ama açılan şey satırın anlamını takip
   * etmeli, ekrandaki sırasını değil.
   */
  const [acikSatir, setAcikSatir] = useState<"carried" | "share" | "paid" | null>(null);
  /** Devir açıkken, içinde açılmış olan ay. */
  const [acikAy, setAcikAy] = useState<string | null>(null);
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
        // Ödeme geçmişi dönemleri AŞMALI: son ödeme dönemi kendiliğinden
        // kapattığı için, varsayılan (açık dönem) görünümü tam da
        // ilgilenilen anda boş liste dönüyordu — kayıtlar bir önceki, artık
        // kapanmış dönemde kalıyor.
        apiGet<{ settlements: Settlement[] }>(
          selected ? `/settlements?period_id=${selected}` : "/settlements?all_periods=true"),
        apiGet<Stats>(`/stats${q}`),
      ]);
      setPeriods(pers.periods || []);
      setNet(bal.net || {});
      setEkstre(bal.statement || null);
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

  /** Ekstre satırını aç/kapa. Aynı anda tek satır açık: iki açılım yan yana
   *  durursa "hangisi neyin cevabı" sorusu doğuyor. */
  const ac = (k: "carried" | "share" | "paid") => {
    setAcikSatir((v) => (v === k ? null : k));
    setAcikAy(null);
  };

  /** Hareket satırı → Harcamalar, süzülmüş olarak.
   *
   *  Burada ayrı bir fiş listesi çizilmiyor: fişleri çizen bir ekran zaten
   *  var ve orada tarih, market, kalemler, düzenleme — hepsi hazır. Süzgeç
   *  başlıkta ve kaldırılabilir; görünmezse insan "Sana düşen 62,60"yı ayın
   *  tamamı sanır. */
  const fisleriAc = (tur: string, ay: string) =>
    router.push(`/harcamalar?akis=${tur}&ay=${ay}`);

  const activeId = activePeriod?.period_id;
  const currentId = selected || activeId;
  const archived = currentId !== activeId;

  const myNet = Math.abs(net[me] || 0) < 0.005 ? 0 : (net[me] || 0);
  /* Alacakliyken ekstrenin etiketleri yer degistiriyor: ayni dort satir,
     ters yon. `share` borcu artiran, `paid` azaltan taraf. */
  const alacakli = myNet > 0.005;
  const buAyKutu: EkstreAy = ekstre
    ? (ekstre.months.find((m) => m.month === ekstre.current_month)
       || { month: ekstre.current_month, share: 0, paid: 0, delta: 0, lines: [] })
    : { month: "", share: 0, paid: 0, delta: 0, lines: [] };

  /** Açılan kartın başlığı, dokunulan satırın etiketiyle birebir aynı —
   *  başka bir kelime kullanmak "acaba başka bir şey mi açıldı" sorusu
   *  doğurur. */
  const acilimBaslik = !ekstre ? "" :
    acikSatir === "carried" ? "Önceki Aylardan"
      : acikSatir === (alacakli ? "paid" : "share")
        ? `${ayAdi(ekstre.current_month).split(" ")[0]}${alacakli ? "'ta Ödediklerin" : "'ta Sana Düşen"}`
        : alacakli ? "Senin Payın" : "Ödediklerin";

  /** Devir satırının içi: bu aydan öncekiler, eskiden yeniye. */
  const gecmisAylar = useMemo(
    () => (ekstre?.months || [])
      .filter((a) => a.month < (ekstre?.current_month || ""))
      .sort((a, b) => a.month.localeCompare(b.month)),
    [ekstre],
  );

  /** Bu ayın hareketleri, dokunulan satırın YÖNÜNE göre süzülmüş.
   *  `artiran` borcu büyüten taraf (`share`), diğerleri azaltan (`paid`) —
   *  ayrım sunucudaki tek tanımdan geliyor, burada yeniden hesaplanmıyor. */
  const buAyHareketleri = useMemo(() => {
    if (!acikSatir || acikSatir === "carried") return [];
    return (buAyKutu.lines || []).filter((l) => l.artiran === (acikSatir === "share"));
  }, [acikSatir, buAyKutu]);

  /** Tek hareket satırı. Fişi olan açılır, ödeme kaydı olan açılmaz. */
  const hareketSatiri = (l: Hareket, ay: string) => {
    const meta = TUR_ADI[l.tur] || { ad: l.tur, fisli: false };
    return (
      <Pressable key={`${ay}-${l.tur}`} style={styles.hareketRow}
                 disabled={!meta.fisli} testID={`hareket-${l.tur}`}
                 onPress={() => fisleriAc(l.tur, ay)}>
        <Text style={styles.hareketLabel}>{meta.ad}</Text>
        {/* İşaret kuralı tek: artı borcu artırır, eksi azaltır. "Kemal için
            aldıkların −12,00" en çok merak edilen soruyu kapatıyor — o parayı
            ayrıca almana gerek yok, düşüm burada oldu. */}
        <Text style={[styles.hareketVal, !l.artiran && styles.hareketEksi]}>
          {l.artiran ? "" : "−"}{formatEUR(l.tutar)}
        </Text>
        {meta.fisli
          ? <Ionicons name="chevron-forward" size={13} color={colors.onSurfaceTertiary} />
          : <View style={{ width: 13 }} />}
      </Pressable>
    );
  };

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

  /* Borçların / Alacakların / diğerleri.
     `simplify_debts` her kişiye tek net veriyor: neti eksi olan yalnızca
     ödeyen, artı olan yalnızca alan olarak çıkıyor. Yani ilk iki liste
     **asla aynı anda dolu olamaz** ve ekranda yön hiç karışmıyor. */
  const borclarim = ordered.filter((t) => t.from === me);
  const alacaklarim = ordered.filter((t) => t.to === me);
  const digerleri = ordered.filter((t) => t.from !== me && t.to !== me);

  // `by_member` yalnizca EV harcamalarini sayiyor; bu satir ise bakiyeyi
  // acikliyor, yani Salih icin odedigin de dahil olmali.

  /**
   * Köprü — iki avatar iki ucu tutuyor, tutar ortada.
   *
   * Tek satırlık "ince" bir sürüm denendi ve GERİ ALINDI: karşı tarafın
   * avatarı yanında bir de adı yazınca aynı bilgi iki kez geçiyordu. Köprüde
   * bu sorun yok, çünkü isimler avatarların altında ve yönü konumları
   * söylüyor.
   *
   * `ikincil` yalnızca ÖLÇÜ küçültüyor (avatar, tutar) — düğme rengini
   * değiştirmiyor. **İki borç da senin yapman gereken iş; birinin diğerine
   * üstünlüğü yok.** Renk yönü izliyor: ödeyecekken koyu, alacakken sessiz.
   *
   * Düğme ortada ve dar. Tam genişlikte olunca köprünün kendisinden fazla
   * yer kaplıyordu.
   */
  const kopruSatiri = (t: Transfer, ikincil: boolean) => {
    const iPay = t.from === me;
    const boy = ikincil ? 24 : 30;
    const uc = (id: string) => (
      <View style={styles.side}>
        <Avatar name={nameOf(id)} size={boy}
                avatarId={(member(id) as any)?.avatar_id}
                userId={id}
                photoVersion={(member(id) as any)?.photo_version} />
        <Text style={styles.sideName} numberOfLines={1}>{first(id)}</Text>
      </View>
    );
    return (
      /* Köprü YALNIZCA ödüyor. "Bu borç nereden geliyor" kapısı ekstre
         bloğuna taşındı — orada satırlar zaten dökümün özeti. İçinde düğme
         olan bir satırı tıklanabilir yapmak iç içe hedef sorunu üretiyordu. */
      <View style={styles.bridge} testID={`debt-${t.from}-${t.to}`}>
        <View style={styles.bridgeRow}>
          {uc(t.from)}
          <View style={styles.middle}>
            <Money value={t.amount}
                   style={ikincil ? styles.bridgeAmountSm : styles.bridgeAmount} />
            <View style={styles.wire}>
              <View style={styles.wireLine} />
              <Ionicons name="arrow-forward" size={12} color={colors.inkTertiary} />
              <View style={styles.wireLine} />
            </View>
          </View>
          {uc(t.to)}
        </View>
        {!archived && (
          <View style={styles.kopruDugmeSatir}>
            <Pressable style={[styles.kopruBtn, iPay ? styles.btnDark : styles.btnQuiet]}
                       onPress={() => openPay(t)}
                       testID={iPay ? `mark-paid-to-${t.to}` : `mark-paid-${t.from}`}>
              <Text style={iPay ? styles.btnDarkTxt : styles.btnQuietTxt}>
                {iPay ? "Öde" : "Ödedi"}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  };
  // Pencere KART BASLIGINDA: ayni kelime ("payin") Istatistik'te de
  // geciyor ama orasi takvim ayi. Basliga yazmak karsilastirma
  // sorusunu bastan kapatiyor.
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

  /**
   * "Ödeştik" — eski "Dönemi Kapat"ın yerini alıyor ama işi tam tersi.
   *
   * Eskisi bakiyeleri **siliyordu**: ödeşmeden kapatılan bir dönemin borcu
   * canlı ekrandan kayboluyor, kayıt arşivde kalıyor ama kimse bir daha
   * bakmıyordu. Yenisi önerilen transferleri **gerçek ödeme kaydı olarak
   * yazıyor**; bakiye zaten sıfıra iniyor ve dönem kendiliğinden kapanıyor.
   *
   * Aynı insan jesti ("nakit ödeştik, bitti"), dürüst defter: kim kime ne
   * ödediği ödeme geçmişinde duruyor ve geri alınabiliyor.
   */
  const odestik = async () => {
    setBusy(true); setError(null); duyur(null);
    try {
      const r = await apiPost<{ count: number }>("/settlements/all", {});
      await refreshHH(); setSelected(undefined); await load();
      setMode("none");
      duyur(`Ödeşildi · ${r?.count ?? 0} ödeme kaydedildi`);
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
          <ScreenHeader size="l" overline="KASA" title="Senin Hesabın">
            {/* EKSTRE BLOGU — net rakamin nereden geldigi, dort satirda.
                Once yalnizca "NET DURUMUN 40,60 €" yaziyordu ve sayinin
                nereden geldigi hicbir yerde gorunmuyordu.

                Dayandigi kimlik: **odedigin − sana dusen = bakiyen**.
                Devir bir DAGITIM degil bir ENSTANTANE (onceki ay sonundaki
                bakiyen), o yuzden FIFO gerekmiyor.

                Blok kendiliginden donuyor: alacakliyken etiketler yer
                degistiriyor, ayri bir tasarim gerekmiyor. Ev kac kisilik
                olursa olsun dort satir kaliyor.

                "Onceki aylardan" satiri YALNIZCA devir varsa ciziliyor:
                duzenli odesen bir evde ekran bugunkuyle ayni kaliyor. */}
            {ekstre ? (
              /* HER SATIR AYRI HEDEF, her satırın kendi oku var.
                 Önce bloğun tamamı tek hedefti ve ayrı bir döküm sayfasına
                 gidiyordu. O sayfa kaldırıldı: "Sana düşen 62,60" satırına
                 dokunan insan zaten fişleri görmek istiyor ve fişleri çizen
                 bir ekran (Harcamalar) zaten var — aynı listeyi ikinci kez
                 çizmek aynı işi iki yerde yapmaktı.

                 Ok kapalıyken sağa, açıkken aşağı bakıyor: hangi satırın
                 açıldığı ok olmadan yalnızca vurgudan anlaşılıyordu ve
                 vurgunun kendisi "seçili" ile "açık" arasında ayrım
                 yapmıyor. */
              <View style={styles.ekstre}>
                {Math.abs(ekstre.carried) > 0.005 && (
                  <EkstreSatir
                    etiket="Önceki aylardan"
                    tutar={formatEUR(alacakli ? -ekstre.carried : ekstre.carried)}
                    acik={acikSatir === "carried"}
                    onPress={() => ac("carried")}
                    testID="ekstre-carried"
                  />
                )}
                <EkstreSatir
                  etiket={ayAdi(ekstre.current_month).split(" ")[0]
                          + (alacakli ? "'ta ödediklerin" : "'ta sana düşen")}
                  tutar={formatEUR(alacakli ? buAyKutu.paid : buAyKutu.share)}
                  acik={acikSatir === (alacakli ? "paid" : "share")}
                  onPress={() => ac(alacakli ? "paid" : "share")}
                  testID="ekstre-ust"
                />
                <EkstreSatir
                  etiket={alacakli ? "Senin payın" : "Ödediklerin"}
                  tutar={"−" + formatEUR(alacakli ? buAyKutu.share : buAyKutu.paid)}
                  eksi
                  acik={acikSatir === (alacakli ? "share" : "paid")}
                  onPress={() => ac(alacakli ? "share" : "paid")}
                  testID="ekstre-alt"
                />
                <View style={styles.ekstreCizgi} />
                {/* SONUÇ satırı tıklanmıyor: açılacak bir şeyi yok, üstündeki
                    üç satırın toplamı zaten o. Ok da yok — dokunulamayan bir
                    satırda ok, çalışmayan bir düğmedir. */}
                <View style={styles.ekstreRow}>
                  <Text style={styles.ekstreLabel}>
                    {myNet > 0.01 ? "Ev sana borçlu"
                      : myNet < -0.01 ? "Kalan borcun" : "Ödeşmiş durumdasın"}
                  </Text>
                  {/* Sayarak degisiyor: odeme kaydedince rakamin bir anda
                      atlamasi "oldu mu olmadi mi" sorusunu birakiyordu. */}
                  <Text style={[styles.ekstreSonuc,
                                { color: myNet >= 0 ? colors.accentOnDark : colors.negativeOnDark }]}>
                    {formatEUR(Math.abs(sayanNet))}
                  </Text>
                </View>
              </View>
            ) : (
              <>
                <Text style={styles.heroLabel}>NET DURUMUN</Text>
                <Text style={[styles.heroValue,
                              { color: myNet >= 0 ? colors.accentOnDark : colors.negativeOnDark }]}>
                  {formatEUR(sayanNet, true)}
                </Text>
              </>
            )}
            {/* "Sana borçlu / Senin borcun" ikilisi KALKTI. Zaten yalnızca
                iki taraf da doluyken çiziliyordu; sadeleştirme her kişiye tek
                net verdiği için o durum hiç oluşmuyor. Ekstre bloğu da aynı
                soruyu daha iyi cevaplıyor. */}
            {/* DÖNEM SEÇİCİ KALKTI.
                Tek yaptığı "arşivlenmiş bir döneme bak"tı. Dönem para
                hesabından çıkınca kapalı dönem = **ödeşilmiş an** oldu, yani
                aynı bilgi ödemelerin kendisinde duruyor ve daha zengin: kim
                kime, ne zaman, ne kadar, ne kadarı kaldı. Yerini aşağıdaki
                Ödeme Geçmişi aldı. */}
          </ScreenHeader>

          <Sheet>
            {loading ? (
              <ActivityIndicator color={colors.ink} style={{ marginTop: spacing.xxl }} />
            ) : (
              <View style={{ gap: metrics.cardGap }}>
                {/* AÇILIM — kavisin hemen altında, dokunulan satırın karşılığı.
                    Kartın ilk sırada olması bilinçli: yukarıda dokunulan
                    satır ile arasında başka hiçbir şey yok. */}
                {acikSatir && ekstre && (
                  <Card title={acilimBaslik} style={styles.mx}
                        action="Kapat" onAction={() => setAcikSatir(null)}
                        testID="ekstre-acilim">
                    {acikSatir === "carried" ? (
                      /* DEVİR bir dağıtım değil bir enstantane: geçen ay
                         sonundaki bakiyen. Ama ay ay dökülebilir ve bu kurgu
                         değil kesin aritmetiktir — her ayın satırı o ay
                         bakiyenin ne kadar değiştiği.

                         Dil buna göre: "Haziran'dan kalan 48 €" kurgudur
                         (hangi euro'nun kaldığı bilinemez), "Haziran'da 48 €
                         borçlandın" olgudur. */
                      gecmisAylar.length === 0 ? (
                        <Row title="Ayrıntı yok"
                             subtitle="Önceki aylarda kayıtlı hareket bulunmuyor" />
                      ) : gecmisAylar.map((a, i) => (
                        <View key={a.month}>
                          {i > 0 && <Divider inset={spacing.lg} />}
                          <Pressable style={styles.ayRow} testID={`acilim-ay-${a.month}`}
                                     onPress={() => setAcikAy((v) => (v === a.month ? null : a.month))}>
                            <Text style={styles.ayAd}>{ayAdi(a.month).split(" ")[0]}</Text>
                            {/* Yeşil = borcu DÜŞÜREN ay: o ay ödediklerin
                                borçlandıklarından fazla. */}
                            <Text style={[styles.ayDelta,
                                          (alacakli ? -a.delta : a.delta) < 0 && styles.ayDeltaEksi]}>
                              {(alacakli ? -a.delta : a.delta) >= 0 ? "+" : "−"}
                              {formatEUR(Math.abs(a.delta))}
                            </Text>
                            <Ionicons name={acikAy === a.month ? "chevron-down" : "chevron-forward"}
                                      size={14} color={colors.onSurfaceTertiary} />
                          </Pressable>
                          {acikAy === a.month && (
                            <View style={styles.hareketler}>
                              {(a.lines || []).map((l) => hareketSatiri(l, a.month))}
                            </View>
                          )}
                        </View>
                      ))
                    ) : (
                      /* BU AYIN hareketleri. Ay katı atlanıyor çünkü satırın
                         kendisi zaten bir ay: "Ağustos'ta sana düşen". */
                      buAyHareketleri.length === 0 ? (
                        <Row title="Ayrıntı yok"
                             subtitle="Bu ayda kayıtlı hareket bulunmuyor" />
                      ) : (
                        <View style={styles.hareketler}>
                          {buAyHareketleri.map((l) => hareketSatiri(l, ekstre.current_month))}
                        </View>
                      )
                    )}
                  </Card>
                )}

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
                {/* Başlıktaki dönem aralığı ("· 3–16 Ağustos") KALKTI: eski
                    dönem matematiğinden kalmaydı ve artık yanıltıcı — bu kart
                    bir tarih aralığını değil **ödeşilmemiş her şeyi**
                    gösteriyor.

                    "Senin ödediğin · payın" satırı da kalktı: ikisi de
                    yukarıdaki ekstre bloğunda yazılı ve orada bir hesabın
                    parçası olarak duruyor. Aynı sayıyı iki kez göstermek,
                    turun başındaki şikâyetin ta kendisiydi. */}
                <Card title="Kim Kime Borçlu" style={styles.mx}>
                  {ordered.length === 0 ? (
                    <Row
                      leading={<IconPill name="checkmark-circle" color={colors.accent}
                                         tint={colors.accentSoft} />}
                      title="Herkes ödeşmiş"
                      subtitle="Kimsenin kimseye borcu kalmadı"
                      minHeight={metrics.rowHeightLg}
                    />
                  ) : (
                    <>
                      {borclarim.map((t, i) => (
                        <View key={`b-${t.to}-${i}`}>
                          {i > 0 && <Divider inset={spacing.lg} />}
                          {kopruSatiri(t, i > 0)}
                        </View>
                      ))}

                      {alacaklarim.map((t, i) => (
                        <View key={`a-${t.from}-${i}`}>
                          {(i > 0 || borclarim.length > 0) && <Divider inset={spacing.lg} />}
                          {kopruSatiri(t, i > 0)}
                        </View>
                      ))}

                      {/* Paylasma satiri KARTIN DIBINDE, bir kez. Once her
                          borclunun satirinda ayri ayri duruyordu, oysa
                          paylasilan IBAN hepsinde ayni. */}
                      {!archived && alacaklarim.length > 0 && bilgim && (
                        <>
                          <Divider inset={spacing.lg} />
                          <Pressable style={styles.paylasSatir} onPress={paylasBilgim}
                                     testID={`share-payment-${alacaklarim[0].from}`}>
                            <Ionicons name="share-social-outline" size={15} color={colors.accentDark} />
                            <Text style={styles.paylasTxt}>
                              {bilgimVar ? "Ödeme bilgini paylaş" : "Ödeme bilgini ekle"}
                            </Text>
                            <Ionicons name="chevron-forward" size={15} color={colors.onSurfaceTertiary} />
                          </Pressable>
                        </>
                      )}

                      {digerleri.map((t, i) => (
                        <View key={`d-${t.from}-${t.to}-${i}`}>
                          <Divider inset={spacing.lg} />
                          <View style={styles.otherRow}>
                            <Text style={styles.otherTxt} numberOfLines={1}>
                              {first(t.from)} <Text style={styles.arrow}>→</Text> {first(t.to)}
                            </Text>
                            <Money value={t.amount} color={colors.inkTertiary}
                                   style={styles.otherAmount} />
                          </View>
                        </View>
                      ))}
                    </>
                  )}
                </Card>


                {/* ÖDEME GEÇMİŞİ — dönem seçicisinin yerini alan yer.
                    Hap yalnızca "arşive bak" diyordu; burası kim kime ne
                    zaman ne kadar ödedi diye cevap veriyor ve ödeşilmiş
                    geçmiş de dahil, dönemleri aşıyor. */}
                {settlements.length > 0 && (
                  <Card title="Ödeme Geçmişi" style={styles.mx}
                        action={settlements.length > GECMIS_KISA
                          ? (gecmisAcik ? "Daha az" : `Tümü · ${settlements.length}`)
                          : undefined}
                        onAction={() => setGecmisAcik((v) => !v)}>
                    {/* Liste zamanla büyüyor ve Kasa bir EYLEM ekranı: sonuna
                        kadar aşağı inen bir geçmiş, altındaki "Ödeştik"i
                        ekranın dışına itiyordu. Son üçü duruyor, gerisi
                        başlıktaki bağlantıyla açılıyor. */}
                    {(gecmisAcik ? settlements : settlements.slice(0, GECMIS_KISA)).map((s, i) => {
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
                    {ordered.length === 0 ? null : !isAdmin ? (
                      <View style={styles.banner}>
                        <Ionicons name="information-circle" size={16} color={colors.inkSecondary} />
                        <Text style={styles.bannerTxt}>
                          Toplu ödeşmeyi yalnızca ev yöneticisi işaretleyebilir.
                          Kendi ödemeni yukarıdan kaydedebilirsin.
                        </Text>
                      </View>
                    ) : mode === "close" ? (
                      <View style={styles.confirm}>
                        <Text style={styles.confirmTxt}>
                          Kalan borçların hepsi ödenmiş olarak kaydedilecek.
                          Silinmiyor — kim kime ne ödediği deftere yazılıyor ve
                          geri alınabiliyor.
                        </Text>
                        <View style={styles.confirmRow}>
                          <Pressable style={styles.ghost} onPress={() => setMode("none")}
                                     testID="cancel-close-period">
                            <Text style={styles.ghostTxt}>Vazgeç</Text>
                          </Pressable>
                          <Pressable style={styles.solid} onPress={odestik} disabled={busy}
                                     testID="confirm-close-period">
                            {busy ? <ActivityIndicator color={colors.onBrand} />
                                  : <Text style={styles.solidTxt}>Evet, ödeştik</Text>}
                          </Pressable>
                        </View>
                      </View>
                    ) : mode === "reopen" ? (
                      <View style={styles.confirm}>
                        <Text style={styles.confirmTxt}>
                          Son ödeşme geri alınacak: kaydedilen ödemeler silinecek
                          ve borçlar yeniden görünecek.
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
                        {/* Eski dugme "Donemi Kapat & Denklestir" idi ve
                            bakiyeleri SILIYORDU; o yuzden odenmemis borc
                            varken bilerek sonuk gosteriliyordu -- PROJE-
                            DOKUMANI §12'deki endise ("kolayca basilan bir
                            dugme insanlari odesmeden arsivlemeye iter").

                            Artik silen bir sey yok: dugme odemeleri KAYDEDIYOR.
                            Dolayisiyla sonuk gostermenin sebebi de kalmadi --
                            tam tersine, dugmenin var olma sebebi odenmemis
                            borctur. Borc yoksa hic cizilmiyor. */}
                        {/* SÖNÜK, ve bu sefer sebebi farklı. Eski düğme
                            bakiyeleri siliyordu, o yüzden ödenmemiş borç
                            varken caydırıcı olsun diye sönüktü. Yenisi
                            ödemeleri kaydediyor — caydırılacak bir şey yok.
                            Ama asıl yol yukarıdaki köprülerin koyu "Öde"
                            düğmeleri; bu, toplu bir kısayol. İkincil olan
                            ikincil görünmeli. */}
                        <PrimaryButton label="Ödeştik" icon="checkmark-done"
                                       onPress={() => setMode("close")}
                                       tone="muted" testID="close-period-btn" />
                        <Text style={styles.footNote}>
                          {ordered.length === 1
                            ? "Kalan borç ödenmiş olarak kaydedilir"
                            : `${ordered.length} borç ödenmiş olarak kaydedilir`}
                        </Text>
                        {canReopen && (
                          <Pressable style={styles.undoBtn} onPress={() => setMode("reopen")}
                                     testID="reopen-period-btn">
                            <Ionicons name="arrow-undo" size={15} color={colors.inkSecondary} />
                            <Text style={styles.undoBtnTxt}>Son ödeşmeyi geri al</Text>
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
  ekstre: { marginTop: spacing.md, gap: 2 },
  ekstreRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  /* Dokunulabilir satır biraz nefes alıyor ve içeri kayıyor: vurgu bir kutu
     olarak çizildiğinde etiketin kutuya yapışmaması için. Negatif kenar
     boşluğu vurgunun bloğun hizasından taşmasını sağlıyor — kutu satırı
     sarmalı, satır kutunun içine sıkışmamalı. */
  ekstreTiklanir: {
    paddingVertical: 5, paddingHorizontal: spacing.sm,
    marginHorizontal: -spacing.sm, borderRadius: radius.sm,
  },
  ekstreAcik: { backgroundColor: colors.darkSurface },
  ekstreLabel: { ...T.caption, color: colors.onDarkMuted, flex: 1 },
  ekstreVal: { ...T.bodySb, color: colors.onDark },
  ekstreEksi: { color: colors.accentOnDark },
  ekstreCizgi: { height: 1, backgroundColor: colors.darkSurface, marginVertical: 5 },
  ayRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 46,
  },
  ayAd: { ...T.body, color: colors.ink, flex: 1 },
  ayDelta: { ...T.bodySb, fontSize: 15, color: colors.ink },
  ayDeltaEksi: { color: colors.accentDark },
  /* Hareketler ayın ALTINDA ve içeri girintili: sol çizgi "bunlar o satırın
     içi" diyor, başlıksız bir liste olsa aynı düzeyde okunurdu. */
  hareketler: {
    paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
    marginLeft: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.divider,
  },
  hareketRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingVertical: 7, paddingLeft: spacing.md,
  },
  hareketLabel: { ...T.caption, color: colors.inkSecondary, flex: 1 },
  hareketVal: { ...T.caption, fontFamily: fontFamily.medium, color: colors.ink },
  hareketEksi: { color: colors.accentDark },
  /* 34 değil 27.
     Hiyerarşi GÖRELİDİR: 34 punto, ekranda başka sayı yokken tasarlanmıştı.
     Ekstre gelince etrafı 14 puntoluk üç sayıyla çevrildi, yani baskın olmak
     için 2,4 kat gerekmiyor — 1,9 kat tartışmasız birinci ama bağırmıyor.
     Ayrıca borç rakamını büyütmek algılanan ciddiyeti artırıyor; burası
     türetilmiş bir sayı, üstünde nasıl oluştuğu yazılı. */
  ekstreSonuc: {
    fontSize: 27, lineHeight: 34, fontFamily: fontFamily.semibold,
    letterSpacing: -0.9, marginLeft: spacing.md,
  },
  // İkinci köprü yalnızca ÖLÇÜ olarak küçülüyor; düğme rengi değişmiyor.
  bridgeAmountSm: {
    fontSize: 16, lineHeight: 22, fontFamily: fontFamily.semibold, letterSpacing: -0.3,
  },
  // Düğme ORTADA ve dar: tam genişlikte olunca köprüden fazla yer kaplıyordu.
  kopruDugmeSatir: { alignItems: "center", marginTop: spacing.sm },
  kopruBtn: {
    minWidth: 108, alignItems: "center", justifyContent: "center",
    paddingHorizontal: spacing.xl, height: 34, borderRadius: radius.md,
  },
  paylasSatir: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 44,
  },
  paylasTxt: { ...T.bodySb, color: colors.accentDark, flex: 1 },
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
  /* 21 değil 19. Tek borç varken bu sayı ekstrenin son satırıyla AYNI oluyor;
     benzer ağırlıkta iki kez görünen bir rakam "hangisini okuyacağım"
     duraksaması üretiyor. Rolleri ayrı: ekstredeki bir SONUÇ, buradaki bir
     EYLEM HEDEFİ. */
  bridgeAmount: { fontSize: 19, lineHeight: 25, fontFamily: fontFamily.semibold, letterSpacing: -0.4 },
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

  // paidLine/paidLabel/paidValue kaldirildi: "senin odedigin - payin"
  // artik ekstre blogunda, bir hesabin parcasi olarak duruyor.
  _kaldirildi_paidLine: {
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
