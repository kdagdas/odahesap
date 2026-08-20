/** Anasayfa — ev odaklı. Kişisel bakiye Kasa'ya taşındı; burada evin
 *  toplamı, nereye gittiği, kimin ne ödediği ve günlük akış var. */
import { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { apiGet } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, Sheet, Card, Row, Divider, Avatar,
  Money, IconPill, CategoryIcon, categoryLabel, splitBadge, splitSummary, PulseDot,
  Donut, formatEUR, formatEURShort, useScrollPad, useBasaSar, yenileme,
  ayDe, buAy, degisimTxt,
} from "@/src/ui";
import { ConfirmSheet } from "@/app/duzenli";
import {
  colors, spacing, radius, type as T, overline, fontFamily, metrics, CATEGORY_ICONS,
} from "@/src/theme";

type Expense = {
  expense_id: string; added_by: string; target_type: string; target_user_id?: string;
  split_mode?: string; split_with?: Record<string, number> | null;
  total: number; merchant?: string; category?: string; source: string; expense_date?: string;
};
type Due = {
  recurring_id: string; name: string; amount: number; amount_fixed: boolean;
  day_of_month: number; scope: "household" | "self"; due_period: string | null;
  split_mode: "equal" | "exact"; split_with: Record<string, number>;
};
/** `/stats/monthly` — Anasayfa da İstatistik de **aynı ucu** okuyor.
 *
 *  Önceden Anasayfa dönem bazlı `/stats`'ı okuyordu: aynı olay iki ekranda
 *  iki farklı rakam gösteriyordu. Dönem para hesabına indi, görüntülemenin
 *  her yeri takvim ayı oldu. */
type Stats = {
  month: string; total: number; expense_count: number;
  change_pct: number | null; prev_same_day: number; elapsed_days: number;
  my_share: number; my_personal: number;
  categories: { key: string; total: number }[];
  by_member: { user_id: string; total: number }[];
  fixed?: number;
};

/**
 * Anasayfa'daki tek cümle. Sunucu SAYIYI gönderiyor, metni burası yazıyor —
 * aksi hâlde Almancaya çevrildiğinde veritabanında Türkçe cümleler kalırdı.
 */
type OneCikan =
  | { kind: "odesme"; amount: number; days: number }
  | { kind: "zam" | "ucuz"; name: string; pct: number; merchant: string; now: number;
      unit: string; impact?: number; prev_month?: string | null }
  | { kind: "market_farki"; name: string; cheap: string; cheap_price: number;
      expensive: string; expensive_price: number; unit: string; pct: number }
  | { kind: "degisim"; diff: number; category: string; cat_diff: number };
type ShopItem = { item_id: string; text: string; added_by: string; done: boolean };

const ONE_CIKAN_IKON: Record<string, any> = {
  odesme: "wallet-outline",
  zam: "trending-up",
  ucuz: "trending-down",
  market_farki: "swap-horizontal",
  // `sparkles` DEĞİL: ışıltı simgesi bugün her arayüzde "yapay zekâ" demek
  // ve burada üretilen şey bir tahmin değil, bir toplama. Takvim "bu ay"
  // diyor — cümlenin ilk kelimesiyle aynı şeyi.
  degisim: "calendar-outline",
};

/**
 * Satırın rengi SESİN YÜKSEKLİĞİNE göre değil, SENDEN NE İSTENDİĞİNE göre.
 *
 * Önce hepsi yeşildi, yani renk hiçbir şey söylemiyordu. Sürekli yanıp sönen
 * kırmızı da düşünüldü ve reddedildi: yanıp sönme bir KESİNTİdir, kesinti
 * ise "şimdi bir şey yap" demektir. "Domates zamlanmış" hiçbir eylem
 * istemiyor — alınmış domatesi geri alamazsın. En yüksek sesi eylem
 * gerektirmeyen bilgiye harcarsan, gerçekten acil bir şey çıktığında o ses
 * çoktan duvar kâğıdı olmuş olur. Ayrıca hiyerarşi ters dönerdi: fiyat,
 * borçtan daha acil görünürdü.
 *
 * Nabız TEK bir yerde: ödeşme satırında, çünkü senden gerçekten bir şey
 * isteyen tek satır o. O nabız da sonsuz değil — odaklanınca üç kez atıp
 * duruyor (`PulseDot`), yani "buraya bir kez bak" diyor.
 *
 * ### Nötr satırlar GRİ değil YEŞİL
 *
 * Önce gri denendi ("renk anlam taşır, süs olarak harcanmamalı") ama cihazda
 * sönük kaldı. Sebebi şu: lacivert alanda yeşil zaten SEMANTİK DEĞİL —
 * hemen üstteki trend satırı da yeşil ve orada gösterdiği şey bir ARTIŞ.
 * Yani bu blokta yeşil "iyi haber" demiyor, uygulamanın vurgu rengi demek.
 *
 * Kural buna göre kuruldu: **yalnızca istisnalar renkli.** Amber "senden bir
 * şey isteniyor", kiremit "para ters yöne gidiyor", yeşil geri kalan her şey.
 * İki yüksek sesli renk anlam taşıyor; üçüncüsü zemin.
 */
const ONE_CIKAN_RENK: Record<string, string> = {
  odesme: colors.attention,        // amber — senden bir şey bekliyor
  zam: colors.negativeOnDark,      // para ters yöne gidiyor
  ucuz: colors.accentOnDark,
  market_farki: colors.accentOnDark,
  degisim: colors.accentOnDark,
};

/* Kıyas ayının -e hâli. Elle yazıldı çünkü Türkçede ek ünlü uyumuna ve
   ünsüz yumuşamasına bağlı: "ocağa" ama "ekime", "aralığa" ama "marta".
   Kural üretmeye çalışmak, on iki kelimeyi yazmaktan uzun ve daha kırılgan. */
const AY_E_HALI = ["ocağa", "şubata", "marta", "nisana", "mayısa", "hazirana",
                   "temmuza", "ağustosa", "eylüle", "ekime", "kasıma", "aralığa"];
const ayaGore = (ym?: string | null) => {
  const i = ym ? Number(ym.slice(5, 7)) - 1 : -1;
  return i >= 0 && i < 12 ? `${AY_E_HALI[i]} göre ` : "";
};

/**
 * Cümlenin metni — sunucudan gelen sayıdan burada kuruluyor.
 *
 * Beş kaynak var ve öncelik sırası sunucuda: para > fiyat > ürün > değişim.
 * Borç kazanıyor çünkü bir EYLEM istiyor; ötekiler bilgi veriyor.
 */
/**
 * Cümle ÜÇ PARÇA dönüyor: önce · VURGU · sonra.
 *
 * Tek bir gri satır olarak yazıldığında sayı cümlenin içinde kayboluyordu.
 * Cümlenin taşıdığı bilgi zaten o sayı; gerisi onu konuşulur hâle getiren
 * bağlam. Vurgu beyaz ve yarım punto kalın — parlak bir renk gerekmiyor,
 * kontrast yetiyor.
 */
function oneCikanMetni(o: OneCikan): [string, string, string] {
  switch (o.kind) {
    case "odesme": {
      const hafta = Math.floor(o.days / 7);
      const sure = hafta >= 2 ? `${hafta} haftadır` : `${o.days} gündür`;
      return [`${sure} ödeşilmedi · `, `${formatEUR(o.amount)} borcun var`, ""];
    }
    /* KIYAS AYI cümlede. Önce yoktu ve cümle şimdiki zamanla konuşuyordu:
       "%51 zamlanmış" — sanki az önce olmuş gibi. Oysa kıyas iki ayın
       medyanı arasında ve alışveriş günler öncesinde olabilir. Ev sahibi
       bunu bir fişi düzelttikten sonra fark etti: uygulama düzenlemeye
       tepki veriyormuş gibi göründü. Yanlış olan sayı değil, TONDU.

       Kuyrukta artık birim fiyat değil ETKİ var: "şimdi 1,49 €/kg" doğru
       ama karşılığı olmayan bir sayı; "ayda 4,80 € fazla" cebe dokunuyor.
       Ürün sayfası zaten birim fiyatı gösteriyor. */
    case "zam":
      return [`${o.name} ${o.merchant.toLocaleUpperCase("tr-TR")}'de ${ayaGore(o.prev_month)}`,
              `%${o.pct} zamlanmış`,
              o.impact ? ` · ayda ${formatEUR(Math.abs(o.impact))} fazla`
                       : ` · şimdi ${formatEUR(o.now)}/${o.unit}`];
    case "ucuz":
      return [`${o.name} ${o.merchant.toLocaleUpperCase("tr-TR")}'de ${ayaGore(o.prev_month)}`,
              `%${Math.abs(o.pct)} ucuzlamış`,
              o.impact ? ` · ayda ${formatEUR(Math.abs(o.impact))} az`
                       : ` · şimdi ${formatEUR(o.now)}/${o.unit}`];
    case "market_farki":
      return [`${o.name}: `,
              `${o.cheap.toLocaleUpperCase("tr-TR")} ${formatEUR(o.cheap_price)}`,
              `, ${o.expensive.toLocaleUpperCase("tr-TR")} `
              + `${formatEUR(o.expensive_price)}`];
    case "degisim":
      return ["Bu ay ",
              `${formatEUR(Math.abs(o.diff))} ${o.diff > 0 ? "fazla" : "az"}`,
              ` · çoğu ${categoryLabel(o.category).toLocaleLowerCase("tr-TR")}`
              + " harcamasında"];
    default:
      return ["", "", ""];
  }
}

export default function Panel() {
  // Sekme cubugunun ve telefonun gezinme cubugunun kapladigi yer.
  // Elle yazilan 120/130 sabitleri cubuk yuksekligiyle birlikte
  // degismiyordu; olcu artik tek yerden geliyor.
  const altPay = useScrollPad({ tabs: true });
  const scrollRef = useRef<ScrollView>(null);
  useBasaSar(scrollRef);
  const { user } = useAuth();
  const {
    household, members, activePeriod, pendingMembers, isAdmin, refresh: refreshHH,
  } = useHousehold();
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [totalsPaid, setTotalsPaid] = useState<Record<string, number>>({});
  const [shopping, setShopping] = useState<ShopItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [oneCikanlar, setOneCikanlar] = useState<OneCikan[]>([]);
  const [due, setDue] = useState<Due[]>([]);
  const [confirming, setConfirming] = useState<Due | null>(null);
  // PulseDot her değiştiğinde yeniden atıyor; ekran odaklandıkça artıyor,
  // yani uygulamayı her açışta hatırlatma tekrarlanıyor ama sürekli
  // yanıp sönen bir animasyon çalışmıyor.
  const [focusTick, setFocusTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [st, exp, shop, ntf, rec, hl] = await Promise.all([
        apiGet<Stats>("/stats/monthly"),
        apiGet<{ expenses: Expense[] }>("/expenses"),
        apiGet<{ items: ShopItem[] }>("/shopping?scope=household"),
        apiGet<{ unread: number }>("/notifications"),
        apiGet<{ due: Due[] }>("/recurring"),
        apiGet<{ highlight: OneCikan | null; highlights?: OneCikan[] }>("/stats/highlight"),
        refreshHH(),
      ]);
      setStats(st);
      setExpenses(exp.expenses || []);
      // "Kim ne kadar ödedi" de aya geçti; `/balances` çağrısı gereksizleşti.
      setTotalsPaid(Object.fromEntries(
        (st.by_member || []).map((m) => [m.user_id, m.total])));
      setShopping((shop.items || []).filter((i) => !i.done));
      setUnread(ntf.unread || 0);
      setDue(rec.due || []);
      /* `highlights` yeni, `highlight` eski uçtan kalma. Sunucu ikisini de
         gönderiyor; burada da ikisi de okunuyor ki uygulama eski bir
         sunucuya bakarken satır sessizce kaybolmasın. */
      setOneCikanlar(hl?.highlights ?? (hl?.highlight ? [hl.highlight] : []));
    } catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [refreshHH]);

  useFocusEffect(useCallback(() => { load(); setFocusTick((t) => t + 1); }, [load]));

  const member = (id?: string | null) => members.find((m) => m.user_id === id);
  const firstName = (id?: string | null) => member(id)?.name?.split(" ")[0] || "?";

  const cats = (stats?.categories || []).slice(0, 4).map((c) => ({
    ...c, color: (CATEGORY_ICONS[c.key] || CATEGORY_ICONS.diger).color,
  }));

  return (
    <View style={styles.root} testID="panel-screen">
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.scroll, altPay]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl {...yenileme(refreshing, () => { setRefreshing(true); load(); })} />
        }
      >
        <ScreenHeader
          size="l"
          overline="EV"
          title={household?.name || "—"}
          right={
            /* Avatar buradan kaldırıldı: alt menüdeki Profil sekmesi zaten aynı
               yere gidiyordu, iki kapı "ayarları nereden açmıştım" sorusunu
               doğuruyordu. Zil ise kimsenin yapmadığı bir işi yapıyor —
               kaçırılan bildirimlere bakmak. */
            <Pressable onPress={() => router.push("/aktivite")} testID="open-activity-btn"
                       style={styles.bellBtn} hitSlop={8}>
              <Ionicons name="notifications-outline" size={20} color={colors.onDark} />
              {unread > 0 && (
                <View style={styles.badge} testID="activity-badge">
                  <Text style={styles.badgeTxt}>{unread > 9 ? "9+" : unread}</Text>
                </View>
              )}
            </Pressable>
          }
        >
          <Text style={styles.heroLabel}>{ayDe(stats?.month || buAy())} EV HARCAMASI</Text>
          <Text style={styles.heroValue}>{formatEUR(stats?.total ?? 0)}</Text>
          {/* Trend bir HAP değil bir SATIR: ana rakamın hemen altında, aynı
              sola dayalı, yani öznesini komşuluktan alıyor. Ortada duran ve
              öznesiz bir rozet "neyin %12'si" sorusunu bırakıyordu.

              Karşılaştırılan tutar YAZILI. Görünen sayı doğrulanabilir
              olmalı; "%12" tek başına hiçbir şey söylemiyor.

              Hesap AYNI GÜNE göre: önceden bu ayın şu ana kadarki toplamı
              geçen ayın TAM toplamıyla karşılaştırılıyordu ve ayın 5'inde
              bakan herkes "%80 azalış" görüyordu.

              Karşılaştırılacak geçmiş yoksa satır HİÇ çizilmiyor -- dolgu
              metni yok, uydurma yok; yeni evde başlık bir tık kısa kalıyor.

              Tıklanabilir, çünkü bu satırı okuyanın aklından geçen soru
              "neden?" ve cevabı eğride. Merak ile kapı aynı yerde. */}
          {stats?.change_pct != null && (
            <Pressable style={styles.trendRow} hitSlop={8} testID="open-stats-trend"
                       onPress={() => router.push("/istatistik")}>
              <Ionicons
                name={stats.change_pct >= 0 ? "trending-up" : "trending-down"}
                size={13} color={colors.accentOnDark}
              />
              <Text style={styles.trendPct}>{degisimTxt(stats.change_pct)}</Text>
              <Text style={styles.trendPrev} numberOfLines={1}>
                · geçen ay bugün {formatEURShort(stats.prev_same_day)}
              </Text>
            </Pressable>
          )}

          {/* ARAMA — lacivert alanın DİBİNDE, kahraman rakamın altında.
              Buraya konmasının sebebi: aramanın öne çıkma derecesi,
              uygulamanın ne kadarının "bulma işi" olduğuyla orantılı.
              Spotify'da arama bir sekmedir çünkü bulmak işin kendisidir;
              burada günlük iş fiş taramak, ama veri büyüdükçe bulma işi de
              büyüyor. Kahraman rakamla yarışmıyor (altında ve sessiz), ama
              GÖRÜNÜR — başlıktaki bir büyüteç aramanın var olduğunu
              öğretmez, duran bir çubuk öğretir.

              Placeholder bedava bir ders veriyor: uygulamanın neyi bildiğini
              dört kelimeyle anlatıyor.

              Klavye BURADA açılmıyor: dokununca arama ekranına gidiyor.
              Yerinde arama Anasayfa'yı sonuç listesi barındırmaya zorlardı.
              Sahte arama çubuğu standart kalıptır (Spotify, Airbnb, App
              Store hepsi böyle yapar). */}
          {/* BU AY DİKKAT ÇEKEN ŞEY — bir grafik değil bir CÜMLE.
              Halka bileşimi gösteriyor, değişimin sebebini değil; oysa
              yüksek sesle sorulan tek soru "bu ay neden daha pahalı?".

              KONUMU trend satırından AYRI: ikisi farklı işler yapıyor (biri
              "ne kadar", öteki "neden") ve yan yana durunca ikisi de
              başlığın alt yazısı gibi okunuyordu. Şimdi üstte "rakam +
              trend", altta "cümle + arama" diye iki blok var.

              SOLA DAYALI kalıyor: uygulamanın her yerinde metin sola dayalı
              ve ortalanmış tek satır afiş gibi durup okunmaz hale gelir.

              Kayda değer bir şey yoksa çizilmiyor. Dolgu metni yazılsaydı
              kullanıcı bir hafta içinde satırın bazen bilgi taşıdığını
              bazen sadece orada durduğunu öğrenir ve bir daha hiç okumazdı. */}
          {oneCikanlar.length > 0 && (
            <View style={styles.oneCikanBlok} testID="one-cikan">
              {oneCikanlar.map((o, i) => {
                const [bas, vurgu, kuyruk] = oneCikanMetni(o);
                return (
                  <Pressable
                    key={`${o.kind}-${i}`}
                    style={[styles.oneCikan, i > 0 && styles.oneCikanAyrac]}
                    hitSlop={4}
                    testID={`one-cikan-${o.kind}`}
                    onPress={() => router.push(
                      o.kind === "odesme" ? "/(tabs)/denge" : "/istatistik")}
                  >
                    {/* Nabız yalnızca ödeşmede — gerekçesi `ONE_CIKAN_RENK`'te. */}
                    {o.kind === "odesme" ? (
                      <View style={styles.oneCikanNabiz}>
                        <PulseDot size={8} color={colors.attention} trigger={focusTick} />
                      </View>
                    ) : (
                      <Ionicons name={ONE_CIKAN_IKON[o.kind]} size={14}
                                color={ONE_CIKAN_RENK[o.kind] || colors.onDarkMuted}
                                style={{ marginTop: 2 }} />
                    )}
                    <Text style={styles.oneCikanTxt} numberOfLines={3}>
                      {bas}
                      <Text style={styles.oneCikanVurgu}>{vurgu}</Text>
                      {kuyruk}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <Pressable style={styles.araKutu} onPress={() => router.push("/arama")}
                     testID="open-search">
            <Ionicons name="search" size={16} color={colors.onDarkMuted} />
            <Text style={styles.araTxt}>Süt, REWE, Kemal…</Text>
          </Pressable>
        </ScreenHeader>

        <Sheet>
          {loading ? (
            <ActivityIndicator color={colors.ink} style={{ marginTop: spacing.xxl }} />
          ) : (
            <View style={{ gap: metrics.cardGap }}>
              {/* DİKKAT ŞERİDİ — kavisin hemen altında ve YALNIZCA varsa.
                  Normal günlerde hiç çizilmiyor; yeri boş durmuyor.

                  İçeriği "senden bir şey bekleyen" işler. Bugün tek madde
                  var: bekleyen katılma isteği, ve yalnızca yöneticiye.
                  Başkasının yapamayacağı bir işi ona duyurmak, herkese
                  duyurup çoğunun elinden bir şey gelmemesinden iyi.

                  Vadesi gelen düzenli ödemeler bilerek GİRMİYOR: kendi kartı
                  hemen altında duruyor ve ikisi birden olursa aynı iş iki kez
                  yazılmış olur.

                  Rengi uyarı değil dikkat: birinin eve katılmak istemesi bir
                  hata değil, beklenen ve olağan bir olay. */}
              {isAdmin && pendingMembers.length > 0 && (
                <Pressable style={[styles.serit, styles.mx]} testID="dikkat-serit"
                           onPress={() => router.push("/ev-ayarlari")}>
                  <Ionicons name="person-add" size={16} color={colors.onWarning} />
                  <Text style={styles.seritTxt} numberOfLines={2}>
                    {pendingMembers.length === 1
                      ? `${pendingMembers[0].name.split(" ")[0]} eve katılmak istiyor`
                      : `${pendingMembers.length} kişi eve katılmak istiyor`}
                  </Text>
                  <Ionicons name="chevron-forward" size={15} color={colors.onWarning} />
                </Pressable>
              )}

              {/* Vadesi gelen düzenli ödemeler. Onaylanmadan hiçbir kayıt
                  oluşmuyor; kart yalnızca bekleyen varsa çıkıyor.

                  En üstte, koyu başlığın hemen altında: bu bir iş ve
                  yapılınca kart kayboluyor. Normal günlerde ekran eskisi
                  gibi, çünkü bekleyen yoksa hiç çizilmiyor. */}
              {due.length > 0 && (
                <Card
                  title={`Vadesi Gelenler · ${due.length}`}
                  lead={<PulseDot trigger={focusTick} testID="due-dot" />}
                  action={due.length > 3 ? `Tümü · +${due.length - 3}` : undefined}
                  onAction={() => router.push("/duzenli")}
                  style={styles.mx}
                  testID="due-card"
                >
                  {due.slice(0, 3).map((d, i) => (
                    <View key={d.recurring_id}>
                      {i > 0 && <Divider />}
                      <Pressable style={styles.dueRow} onPress={() => setConfirming(d)}
                                 testID={`due-row-${d.recurring_id}`}>
                        <View style={styles.dayBox}>
                          <Text style={styles.dayTxt}>{d.day_of_month}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.dueTitle}>{d.name}</Text>
                          <Text style={styles.dueSub} numberOfLines={1}>
                            {d.scope === "self"
                              ? "Sadece ben"
                              : splitSummary({ mode: d.split_mode, with: d.split_with },
                                             members, user?.user_id)}
                            {d.amount_fixed ? "" : " · değişken"}
                          </Text>
                        </View>
                        <Money value={d.amount} />
                        <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceTertiary} />
                      </Pressable>
                    </View>
                  ))}
                </Card>
              )}

              {/* Kart artık ayın tamamını anlatıyor: ev nereye harcadı → sana
                  ne düştü → devamı için kapı. Tek özne akışı, kartın
                  ortasında konu değişmiyor.

                  Kapı KOYU DÜĞME değil alt satır: uygulamanın kuralı
                  "sayfada tek koyu düğme" ve Anasayfa'nın birincil eylemi
                  ortadaki fiş tarama. Ama başlıktaki sönük hapa göre çok
                  daha büyük bir hedef -- İstatistik'in keşfedilmeme sebebi
                  oraya giden tek kapının bir fısıltı olmasıydı. */}
              {cats.length > 0 && (
                <Card title="Nereye Gitti" style={styles.mx}>
                  <View style={styles.donutRow}>
                    <View style={styles.donutWrap}>
                      <Donut parts={cats} />
                      <View style={styles.donutCenter}>
                        <Text style={styles.donutTotal}>{formatEURShort(stats?.total ?? 0)}</Text>
                        <Text style={styles.donutSub}>{stats?.expense_count} harcama</Text>
                      </View>
                    </View>
                    <View style={{ flex: 1, gap: spacing.sm }}>
                      {cats.map((c) => (
                        <View key={c.key} style={styles.legend}>
                          <CategoryIcon category={c.key} size={26} />
                          <Text style={styles.legendTxt} numberOfLines={1}>{categoryLabel(c.key)}</Text>
                          <Money value={c.total} style={styles.legendVal} />
                        </View>
                      ))}
                    </View>
                  </View>

                  <Divider inset={0} />
                  {/* "Sana düşen" = ev harcamalarından payına düşen, kim
                      ödemiş olursa olsun. "Ödediğin" değil -- o Kasa'da ve
                      ikisinin farkı bakiyen. "Pay" kelimesi bunu
                      öğretmiyordu.

                      Kişisel SIFIRSA sütun çizilmiyor: kendine hiç harcama
                      girmeyen biri için kalıcı duvar kâğıdı olurdu.
                      (Kasa'daki sıfır sütunu gizleme kuralının aynısı.) */}
                  <View style={styles.mineRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.mineLabel}>SANA DÜŞEN</Text>
                      <Text style={styles.mineValue}>{formatEUR(stats?.my_share ?? 0)}</Text>
                    </View>
                    {(stats?.my_personal ?? 0) > 0.005 && (
                      <>
                        <View style={styles.mineSep} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.mineLabel}>KİŞİSEL</Text>
                          <Text style={styles.mineValue}>{formatEUR(stats!.my_personal)}</Text>
                        </View>
                      </>
                    )}
                  </View>

                  <Divider inset={0} />
                  <Pressable style={styles.doorRow} testID="open-stats-btn"
                             onPress={() => router.push("/istatistik")}>
                    <Ionicons name="stats-chart" size={15} color={colors.accentDark} />
                    <Text style={styles.doorTxt}>Tüm analizler</Text>
                    <Ionicons name="chevron-forward" size={15} color={colors.onSurfaceTertiary} />
                  </Pressable>
                </Card>
              )}

              {/* Satıra dokununca o kişinin O AYKİ dökümü açılıyor. Kart
                  ayın rakamını veriyor, sayfa onun neyden oluştuğunu; ay
                  parametre olarak taşınıyor ki iki ekran aynı pencereye
                  baksın. Üye dökümü Tur 10'a kadar hiçbir yerden
                  açılmıyordu — dönem seçicisiyle birlikte kapısı da
                  kaybolmuştu. */}
              {members.length > 0 && (
                <Card title="Kim Ne Kadar Ödedi" style={styles.mx}>
                  {members.map((m, i) => (
                    <View key={m.user_id}>
                      <Row
                        leading={<Avatar name={m.name} avatarId={(m as any).avatar_id}
                                         userId={m.user_id} photoVersion={(m as any).photo_version} />}
                        title={`${m.name}${m.user_id === user?.user_id ? " (sen)" : ""}`}
                        right={<Money value={totalsPaid[m.user_id] || 0} />}
                        chevron
                        onPress={() => router.push({
                          pathname: "/(tabs)/member-detail",
                          params: { memberId: m.user_id, ay: stats?.month || buAy(),
                                    geri: "/(tabs)/panel" },
                        })}
                        testID={`member-row-${m.user_id}`}
                      />
                      {i < members.length - 1 && <Divider />}
                    </View>
                  ))}

                  {/* HAYALET SATIR — yalnızca tek kişilik evde.
                      Kesikli daire ve soluk yazı bilerek: bir ÖĞE gibi değil
                      bir YER gibi okunsun. Koyu düğme değil, çünkü bu kart
                      zaten çalışıyor (senin ödediğin duruyor) ve sayfanın
                      birincil eylemi ortadaki fiş tarama.

                      Ev iki kişi olunca satır kayboluyor: kalıcı bir "davet
                      et" 364 gün yer kaplar, bir gün işe yarar. Dördüncü bir
                      kişi geldiğinde kapı Profil → Ev ayarları ("Üyeler,
                      davet kodu, ev adı"). */}
                  {members.length <= 1 && (
                    <>
                      <Divider />
                      <Row
                        leading={<View style={styles.hayaletDaire}>
                          <Ionicons name="add" size={17} color={colors.inkTertiary} />
                        </View>}
                        title={<Text style={styles.hayaletTxt}>
                          {pendingMembers.length > 0
                            ? `${pendingMembers.length} kişi katılmayı bekliyor`
                            : "Ev arkadaşını davet et"}
                        </Text>}
                        chevron
                        onPress={() => router.push("/ev-ayarlari")}
                        testID="panel-davet"
                      />
                    </>
                  )}
                </Card>
              )}

              <Card title="Alınacaklar"
                    action={shopping.length > 3 ? `Tümü · +${shopping.length - 3}` : "Tümü"}
                    onAction={() => router.push("/(tabs)/liste?scope=household")}
                    style={styles.mx}>
                {shopping.length === 0 ? (
                  <Row title="Liste temiz" subtitle="Eve lazım olanı yazın, markete giden görsün"
                       leading={<IconPill name="checkmark" color={colors.accent}
                                          tint={colors.accentSoft} size={34} />} />
                ) : (
                  shopping.slice(0, 3).map((it, i) => (
                    <View key={it.item_id}>
                      <Row
                        minHeight={46}
                        leading={<View style={styles.check} />}
                        title={<Text style={styles.itemTxt}>{it.text}</Text>}
                        right={<Text style={styles.itemWho}>
                          {it.added_by === user?.user_id ? "sen" : firstName(it.added_by)}
                        </Text>}
                      />
                      {i < Math.min(shopping.length, 3) - 1 && <Divider inset={58} />}
                    </View>
                  ))
                )}
              </Card>

              <Card title="Son Harcamalar"
                    action={expenses.length > 5 ? `Tümü · +${expenses.length - 5}` : "Tümü"}
                    onAction={() => router.push("/harcamalar")} style={styles.mx}>
                {expenses.length === 0 ? (
                  <Row title="Henüz harcama yok" subtitle="İlk fişi tara veya elle ekle"
                       leading={<IconPill name="receipt-outline" color={colors.inkSecondary}
                                          tint={colors.surfaceSecondary} size={34} />} />
                ) : (
                  expenses.slice(0, 5).map((e, i) => {
                    const author = member(e.added_by);
                    const target = splitBadge(e, members, user?.user_id).txt;
                    return (
                      <View key={e.expense_id}>
                        <Row
                          onPress={() => router.push("/harcamalar")}
                          testID={`expense-row-${e.expense_id}`}
                          leading={<Avatar name={author?.name} avatarId={(author as any)?.avatar_id}
                                           userId={author?.user_id} photoVersion={(author as any)?.photo_version} />}
                          title={author?.name || "Bilinmeyen"}
                          subtitle={`${e.merchant || (e.source === "receipt" ? "Fiş" : "Manuel")} · ${target}`}
                          right={<Money value={e.total} />}
                        />
                        {i < Math.min(expenses.length, 5) - 1 && <Divider />}
                      </View>
                    );
                  })
                )}
              </Card>
            </View>
          )}
        </Sheet>
      </ScrollView>

      {confirming && (
        <ConfirmSheet
          tpl={confirming as any}
          members={members}
          meId={user?.user_id}
          onClose={() => setConfirming(null)}
          onDone={() => { setConfirming(null); load(); }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  scroll: { backgroundColor: colors.bg, flexGrow: 1 },
  /* Kesikli çerçeve: dolu bir avatarla aynı yuvada durur ama "burası boş"
     der. Ölçüsü avatarla aynı olmak zorunda, yoksa satır kayıyor. */
  hayaletDaire: {
    width: metrics.icon, height: metrics.icon, borderRadius: metrics.icon / 2,
    borderWidth: 1, borderStyle: "dashed",
    borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center",
  },
  hayaletTxt: { ...T.body, color: colors.inkSecondary },
  /* Trend satırından bir tık daha AŞAĞIDA: ikisi farklı iş yapıyor ("ne
     kadar" ile "neden") ve fazla yakın durunca aynı bloğun iki satırı gibi
     okunuyordu. */
  /* Blok bir kez boşluk bırakıyor, satırlar arasında değil: her satıra
     `marginTop` verilseydi üç satır arasındaki mesafe başlıkla arasındaki
     mesafe kadar olur ve üçü ayrı ayrı bloklar gibi okunurdu. */
  oneCikanBlok: { marginTop: spacing.lg },
  oneCikan: {
    flexDirection: "row", alignItems: "flex-start", gap: 6,
  },
  /* İnce ayraç: üç satır aynı bloğa ait ama ayrı cümleler. Ayraç olmadan
     saran bir satırın nerede bitip ötekinin nerede başladığı belirsizdi. */
  oneCikanAyrac: {
    marginTop: spacing.sm, paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.darkSurface,
  },
  /* Nabız noktası ikondan küçük; ikon hizasında dursun diye kendi kabı var. */
  oneCikanNabiz: { width: 14, alignItems: "center", marginTop: 5 },
  oneCikanTxt: { ...T.caption, color: colors.onDarkMuted, flex: 1, lineHeight: 19 },
  /* Vurgu: beyaz ve yarı kalın. Parlak bir renk gerekmiyor — koyu zeminde
     kontrast tek başına yetiyor ve renk bu uygulamada anlam taşıyor
     (yeşil = alacak), süs olarak harcanmamalı. */
  oneCikanVurgu: { ...T.captionSb, color: colors.onDark },
  araKutu: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.darkSurface, borderRadius: radius.pill,
    paddingHorizontal: spacing.lg, height: 42, marginTop: spacing.lg,
  },
  araTxt: { ...T.body, color: colors.onDarkMuted },
  serit: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.warningSoft, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  seritTxt: { ...T.bodySb, color: colors.onWarning, flex: 1 },
  mx: { marginHorizontal: spacing.lg },
  heroLabel: { ...overline, color: colors.onDarkMuted },
  heroHint: { ...T.caption, color: colors.onDarkMuted, marginTop: 2 },
  trendRow: {
    flexDirection: "row", alignItems: "center", gap: 5,
    alignSelf: "flex-start", marginTop: 3,
  },
  trendPct: { ...T.captionSb, color: colors.accentOnDark },
  trendPrev: { ...T.caption, color: colors.onDarkMuted, flexShrink: 1 },
  mineRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  mineLabel: { ...overline, fontSize: 10, color: colors.inkTertiary },
  mineValue: { ...T.bodySb, fontSize: 16, color: colors.ink, marginTop: 1 },
  mineSep: { width: 1, height: 30, backgroundColor: colors.divider, marginHorizontal: spacing.lg },
  doorRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 44,
  },
  doorTxt: { ...T.bodySb, color: colors.accentDark, flex: 1 },
  statsPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: colors.darkSurface, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 6,
  },
  statsPillTxt: { ...T.captionSb, color: colors.onDark },
  heroValue: { ...T.hero, color: colors.onDark, marginTop: spacing.xs },
  bellBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: colors.darkSurface,
    alignItems: "center", justifyContent: "center",
  },
  badge: {
    position: "absolute", top: -3, right: -3, minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.negative, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 5, borderWidth: 2, borderColor: colors.dark,
  },
  badgeTxt: { color: colors.onDark, fontSize: 10, lineHeight: 14, fontFamily: fontFamily.bold },
  dueRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 60,
  },
  dayBox: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  dayTxt: { ...T.bodySb, color: colors.ink },
  dueTitle: { ...T.emph, color: colors.ink },
  dueSub: { ...T.caption, color: colors.onSurfaceTertiary, marginTop: 1 },
  donutRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg,
              paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  donutWrap: { width: 108, height: 108, alignItems: "center", justifyContent: "center" },
  donutCenter: { position: "absolute", alignItems: "center" },
  donutTotal: { ...T.bodySb, color: colors.ink },
  donutSub: { fontSize: 10, lineHeight: 13, fontFamily: fontFamily.regular, color: colors.inkTertiary },
  legend: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  legendTxt: { ...T.caption, color: colors.inkSecondary, flex: 1 },
  legendVal: { ...T.caption, fontFamily: fontFamily.semibold, color: colors.ink },
  check: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.borderStrong },
  itemTxt: { ...T.body, color: colors.ink },
  itemWho: { ...T.caption, color: colors.inkTertiary },
});
