/** Analizler — TAKVİM AYI bazlı, Ev / Kişisel sekmeli.
 *
 *  Ekranda adı "İstatistik" değil **ANALİZ**: sayfa artık sayı listelemiyor,
 *  soru cevaplıyor — kategorinin içine, marketin içine, ürünün geçmişine
 *  giriliyor. "İstatistik" kelimesi bakılıp geçilen bir tablo çağrıştırıyordu.
 *  Dosya ve rota adı `istatistik` olarak KALDI: yeniden adlandırmak sekiz
 *  dosyada import kırar ve kazancı sıfır.
 *
 *  Kasa'ya değil kendi sayfasına konuldu: Kasa bir *eylem* ekranı ("kim kime
 *  borçlu, dönemi kapat"), istatistik ise *gezinme* ekranı. İkisini aynı yere
 *  koymak, ödeşmeye gelen kişiyi grafiklerin arasından geçirmek olurdu.
 *
 *  Ay bazlı olmasının sebebi: dönem üç hafta da sürebilir yedi hafta da, ama
 *  "bu ay ne kadar harcadık" sorusunun cevabı dönemle değişmemeli. Elektrik
 *  hep ayın 15'inde gelir.
 *
 *  Buradaki her sayı birinin gerçekten sorduğu bir soruya cevap veriyor.
 *  Kişi başına TÜKETİM karşılaştırması bilinçli olarak yok: kimin daha çok
 *  tükettiğini değil kimin daha müsait olduğunu ölçer ve ev arkadaşları
 *  arasında gereksiz sürtüşme üretir. "Kim ne kadar ÖDEDİ" farklı bir şey ve
 *  ödeşmenin doğrudan girdisi.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Path, Line as SvgLine, Text as SvgText } from "react-native-svg";
import { apiGet } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, Sheet, Card, Row, Divider, Avatar, Money, CategoryIcon,
  categoryLabel, MerchantBadge, Donut, TabSwitch, BottomSheet,
  formatEUR, formatEURShort, formatQty, AylikCubuk,
  useScrollPad, useGeriDon, useBasaSar,
} from "@/src/ui";
import {
  colors, spacing, radius, type as T, overline, fontFamily, metrics, CATEGORY_ICONS,
} from "@/src/theme";

type Monthly = {
  month: string; total: number; expense_count: number;
  prev_total: number; prev_month?: string; change_pct: number | null;
  fixed: number; variable: number; per_person: number; member_count: number;
  my_share: number; my_personal: number;
  categories: { key: string; total: number; prev_total: number;
                change_pct: number | null; is_new?: boolean }[];
  merchants: { key: string; name: string; total: number; prev_total: number }[];
  by_member: { user_id: string; total: number }[];
  bills: { recurring_id: string; name: string; amount_fixed: boolean;
           total: number; prev_total: number; change_pct: number | null }[];
  cumulative: { day: string; total: number }[];
  prev_cumulative: { day: string; total: number }[];
  months: string[];
  /** Son 6 ay — YALNIZCA veri olan aylar. Evin ilk harcamasından öncesi
   *  hiç gelmiyor; "o ay hiç harcamadın" ile "o ay yoktun" farklı şeyler. */
  son_aylar: { month: string; total: number; expense_count: number }[];
  /** Ürün bazlı toplam, genel ada göre gruplanmış. İlk sekizi burada. */
  products: {
    key: string; name: string; total: number; count: number;
    market_count: number; qty: number | null; unit: string | null;
  }[];
  product_count: number;
};

type FiyatHareket = {
  key: string; name: string; merchant: string; pack_type: string;
  unit: string; now: number; prev: number; change_pct: number;
};

/**
 * Biriken harcama eğrisi — bu ay dolu, geçen ay kesikli gölge.
 *
 * Günlük çubukların yerine geçti: çubuklar az harcamada seyrek ve çirkin
 * duruyordu, biriken eğri tek harcamada bile düzgün. Daha iyi bir soruya da
 * cevap veriyor — "geçen ayın bu gününde neredeydik?"
 */
function Curve({ now, prev, height = 132 }: {
  now: { day: string; total: number }[];
  prev: { day: string; total: number }[];
  height?: number;
}) {
  const W = 300, H = height, padL = 40, padB = 18, padT = 8;
  const max = Math.max(1, now.at(-1)?.total ?? 0, prev.at(-1)?.total ?? 0);
  const plotW = W - padL - 8;
  const plotH = H - padB - padT;
  const path = (rows: { total: number }[], upto?: number) => {
    const list = upto != null ? rows.slice(0, upto) : rows;
    if (!list.length) return "";
    return list.map((r, i) => {
      const x = padL + (i / Math.max(rows.length - 1, 1)) * plotW;
      const y = padT + plotH - (r.total / max) * plotH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");
  };
  // Bu ay henüz bitmediyse eğri bugünde duruyor: ayın sonuna kadar düz bir
  // çizgi çekmek "harcama durdu" demek olurdu, oysa gün gelmedi.
  const today = new Date().toISOString().slice(0, 10);
  const upto = now.findIndex((r) => r.day > today);
  const shown = upto === -1 ? now.length : Math.max(upto, 1);
  const last = now[shown - 1];
  const lastX = padL + ((shown - 1) / Math.max(now.length - 1, 1)) * plotW;
  const lastY = padT + plotH - ((last?.total ?? 0) / max) * plotH;

  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      {[0, 0.5, 1].map((f) => (
        <SvgLine key={f} x1={padL} y1={padT + plotH * f} x2={W - 8} y2={padT + plotH * f}
                 stroke={colors.divider} strokeWidth={1} />
      ))}
      {[1, 0.5, 0].map((f) => (
        <SvgText key={f} x={padL - 6} y={padT + plotH * (1 - f) + 4} textAnchor="end"
                 fontSize={9} fill={colors.inkTertiary}>
          {formatEURShort(max * f)}
        </SvgText>
      ))}
      {prev.length > 1 && (
        <Path d={path(prev)} fill="none" stroke={colors.inkTertiary}
              strokeWidth={1.6} strokeDasharray="4 4" />
      )}
      <Path d={path(now, shown)} fill="none" stroke={colors.ink}
            strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      {last && <Circle cx={lastX} cy={lastY} r={4} fill={colors.ink} />}
      <SvgText x={padL} y={H - 4} fontSize={9} fill={colors.inkTertiary}>1</SvgText>
      <SvgText x={W - 8} y={H - 4} textAnchor="end" fontSize={9} fill={colors.inkTertiary}>
        {now.length}
      </SvgText>
    </Svg>
  );
}

/** "14 lt · 3 markette" — miktar yalnızca birim tekse yazılıyor.
 *  2 kg un ile 3 paket unu toplamak anlamsız bir sayı üretir; sunucu
 *  karışık birimde `qty`'yi zaten `null` gönderiyor. */
const urunAlt = (u: { qty: number | null; unit: string | null; market_count: number; count: number }) => {
  const parca: string[] = [];
  if (u.qty != null && u.unit) parca.push(`${formatQty(u.qty, u.unit)}`);
  else parca.push(`${u.count} kez`);
  // "Tek markette" beklenen durum; yalnızca istisna yazılıyor.
  if (u.market_count > 1) parca.push(`${u.market_count} markette`);
  return parca.join(" · ");
};

const AYLAR = ["", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
               "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const ayAdi = (m: string) => {
  const [y, mm] = m.split("-");
  return `${AYLAR[parseInt(mm, 10)] || ""} ${y}`;
};
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const shiftMonth = (m: string, by: number) => {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(y, mm - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function Istatistik() {
  const router = useRouter();
  const altPay = useScrollPad({ tabs: true });
  const scrollRef = useRef<ScrollView>(null);
  useBasaSar(scrollRef);
  const { user } = useAuth();
  const { members } = useHousehold();
  const [scope, setScope] = useState<"household" | "self">("household");
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<Monthly | null>(null);
  const [loading, setLoading] = useState(true);
  const [aySecici, setAySecici] = useState(false);
  /** Zamlananlar/ucuzlayanlar ayrı uçtan: `/stats/monthly` zaten büyük ve
   *  bu hesap iki ayın bütün fişlerini tarıyor. Kişisel sekmede anlamı yok
   *  (fiyat evin sepetine ait), o yüzden yalnızca ev kapsamında çekiliyor. */
  const [fiyat, setFiyat] = useState<{ up: FiyatHareket[]; down: FiyatHareket[] } | null>(null);
  /* Geri, geldiği yere. Sekme gezgininde `back()` Anasayfa'ya düşüyor. */
  const geriDon = useGeriDon();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await apiGet<Monthly>(`/stats/monthly?month=${month}&scope=${scope}`));
    } catch { setData(null); }
    finally { setLoading(false); }
    // Fiyat hareketleri AYRI ve sessiz: gelmezse sayfa yine açılıyor,
    // yalnızca o kart çizilmiyor. Ana istatistiği bekletmiyor.
    if (scope === "household") {
      try { setFiyat(await apiGet(`/stats/prices?month=${month}`)); }
      catch { setFiyat(null); }
    } else setFiyat(null);
  }, [month, scope]);
  useEffect(() => { load(); }, [load]);

  const member = (id: string) => members.find((m) => m.user_id === id);
  const cats = (data?.categories || []).map((c) => ({
    total: c.total, color: (CATEGORY_ICONS[c.key] || CATEGORY_ICONS.diger).color,
  }));
  // İleri gitmek bugünün ayını aşmamalı: boş bir geleceğe dolaşmanın anlamı yok.
  const canForward = month < thisMonth();
  const yillar = Array.from(new Set([
    ...(data?.months || []).map((m) => m.slice(0, 4)),
    thisMonth().slice(0, 4),
    month.slice(0, 4),
  ])).sort().reverse();

  return (
    <View style={styles.root} testID="istatistik-screen">
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.page, altPay]}
                  showsVerticalScrollIndicator={false}>
        <ScreenHeader
          size="l"
          overline="ANALİZ"
          title={ayAdi(month)}
          onTitlePress={() => setAySecici(true)}
          right={
            <Pressable onPress={geriDon} hitSlop={12} testID="stat-back" style={styles.headBtn}>
              <Ionicons name="close" size={20} color={colors.onDark} />
            </Pressable>
          }
        >
          {/* Oklar KOMSU ay icin, secici SICRAMAK icin. Yalnizca oklar varken
              gecen yilin Ocak'ina gitmek 19 dokunustu ve uygulama iki yil da
              kullanilacak. Ikisi birden duruyor cunku iki farkli soru: "gecen
              ay ne olmus" ile "gecen subat ne olmustu" ayni hareket degil. */}
          <View style={styles.monthNav}>
            <Pressable onPress={() => setMonth((m) => shiftMonth(m, -1))}
                       style={styles.navBtn} testID="stat-prev" hitSlop={8}>
              <Ionicons name="chevron-back" size={18} color={colors.onDark} />
            </Pressable>
            {/* Ay secici artik BASLIGA bagli, bu bloga degil: baslikta zaten
                "Agustos 2026" yaziyor ve tarihe bakan tarihe dokunuyor.
                Burasi tutarin yeri, tarihin degil. */}
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={styles.heroLabel}>
                {scope === "household" ? "EV HARCAMASI" : "KİŞİSEL HARCAMAN"}
              </Text>
              <Text style={styles.heroValue}>{formatEUR(data?.total ?? 0)}</Text>
            </View>
            <Pressable onPress={() => canForward && setMonth((m) => shiftMonth(m, 1))}
                       style={[styles.navBtn, !canForward && { opacity: 0.25 }]}
                       disabled={!canForward} testID="stat-next" hitSlop={8}>
              <Ionicons name="chevron-forward" size={18} color={colors.onDark} />
            </Pressable>
          </View>

          {data?.change_pct != null && (
            <View style={styles.trend}>
              <Ionicons
                name={data.change_pct >= 0 ? "trending-up" : "trending-down"}
                size={13} color={colors.accentOnDark}
              />
              <Text style={styles.trendTxt}>
                %{Math.abs(data.change_pct)} {data.change_pct >= 0 ? "artış" : "azalış"}
                {data.prev_month ? ` · ${ayAdi(data.prev_month)} ${formatEURShort(data.prev_total)}` : ""}
              </Text>
            </View>
          )}

          {/* Sekme anahtarı LACIVERTTE. Önce beyaz yüzeydeydi, Alınacaklar'da
              ise başlıkta — aynı iş iki yerde iki biçimde duruyordu. Anahtar
              *içerik* değil BAĞLAM: "neye bakıyorum" sorusunun parçası, tıpkı
              başlık ve toplam gibi. Beyaz yüzeyde kart olarak içerikle aynı
              ağırlığa giriyordu. İkonlar da Alınacaklar'la aynı, yani kontrol
              iki ekranda gerçekten tek bir şey. */}
          <View style={styles.tabWrap}>
            <TabSwitch
              value={scope}
              onChange={setScope}
              onDark
              options={[
                { value: "household" as const, label: "Ev", icon: "home" },
                { value: "self" as const, label: "Kişisel", icon: "person" },
              ]}
              testID="stat-tab"
            />
          </View>
        </ScreenHeader>

        <Sheet>
          <View style={{ gap: metrics.cardGap }}>
            {loading ? (
              <ActivityIndicator color={colors.ink} style={{ marginTop: spacing.xxl }} />
            ) : !data || data.expense_count === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="calendar-outline" size={38} color={colors.inkTertiary} />
                <Text style={styles.emptyTitle}>{ayAdi(month)} ayında kayıt yok</Text>
                <Text style={styles.emptyDesc}>
                  {scope === "household"
                    ? "Bu ay hiç ev harcaması girilmemiş."
                    : "Bu ay kendine ait bir harcama girmemişsin."}
                </Text>
              </View>
            ) : (
              <>
                {/* Halka ve kategori dokumu TEK kartta. Listedeki renk noktasi
                    halkanin dilimiyle eslesiyor, yani liste ayni zamanda
                    aciklama gorevi goruyor -- ayri bir legend satirina gerek
                    kalmiyor. Ay-ay degisim de ayni satirda: "neye gitti" ve
                    "neresi degisti" ayni soru. */}
                {data.categories.length > 0 && (
                  <Card title="Nereye Gitti" style={styles.mx}>
                    <View style={styles.donutWrap}>
                      <Donut parts={cats} size={148} stroke={13}>
                        <View style={{ alignItems: "center" }}>
                          <Text style={styles.donutTotal}>{formatEURShort(data.total)}</Text>
                          <Text style={styles.donutSub}>{data.expense_count} harcama</Text>
                        </View>
                      </Donut>
                    </View>
                    {data.categories.map((cat, i) => (
                      <View key={cat.key}>
                        <Divider inset={i === 0 ? 0 : spacing.lg} />
                        {/* Satır kategorinin içine açılıyor: 6 aylık seyir,
                            ne alındı, nereden. Halkanın dilimi yerine SATIR
                            hedef, çünkü dilim ince bir yay ve başparmak için
                            isabetsiz; satır zaten dilimin adı ve rengiyle
                            eşleşiyor. */}
                        <Pressable
                          style={styles.catRow}
                          onPress={() => router.push({
                            pathname: "/(tabs)/kategori",
                            // KAPSAM da taşınıyor: "Kişisel" sekmesinden
                            // girilen kategori, ev harcamasını değil senin
                            // kendine aldıklarını göstermeli.
                            params: { key: cat.key, ay: month, scope,
                                      geri: "/(tabs)/istatistik" },
                          })}
                          testID={`kategori-${cat.key}`}
                        >
                          {/* Once duz renkli bir noktaydi. Anasayfa ayni
                              kategorileri IKONLA gosteriyordu, yani uygulama
                              ayni sey icin iki dil konusuyordu. Ikon rengi
                              zaten kategorininki, dolayisiyla halkanin
                              dilimiyle eslesme de kaybolmuyor. */}
                          <CategoryIcon category={cat.key} size={30} />
                          <Text style={styles.catName} numberOfLines={1}>
                            {categoryLabel(cat.key)}
                          </Text>
                          {/* Rozet ISTISNA icindir. Once `change_pct === null`
                              yeterliydi ve gecen ay hic veri yoksa sekiz
                              kategorinin sekizi birden "yeni" oluyordu --
                              o noktada rozet kurali isaretliyor, istisnayi
                              degil. Sunucu artik karsilastirilacak gecmis
                              varsa `is_new` diyor. */}
                          {cat.is_new ? (
                            <View style={[styles.deltaTag, { backgroundColor: colors.infoSoft }]}>
                              <Text style={[styles.deltaTxt, { color: colors.onInfo }]}>yeni</Text>
                            </View>
                          ) : cat.change_pct !== null && Math.abs(cat.change_pct) >= 5 ? (
                            <View style={[styles.deltaTag, {
                              backgroundColor: cat.change_pct > 0 ? colors.negativeSoft : colors.accentSoft,
                            }]}>
                              <Text style={[styles.deltaTxt, {
                                color: cat.change_pct > 0 ? colors.negative : colors.accentDark,
                              }]}>
                                {cat.change_pct > 0 ? "↑" : "↓"} %{Math.abs(cat.change_pct)}
                              </Text>
                            </View>
                          ) : null}
                          <Money value={cat.total} style={styles.catValue} />
                          <Ionicons name="chevron-forward" size={14}
                                    color={colors.onSurfaceTertiary} />
                        </Pressable>
                      </View>
                    ))}
                  </Card>
                )}

                <Card title="Ay Boyunca" style={styles.mx} padded>
                  <Curve now={data.cumulative} prev={data.prev_cumulative} />
                  <View style={styles.curveLegend}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendLine, { backgroundColor: colors.ink }]} />
                      <Text style={styles.legendLabel}>bu ay {formatEURShort(data.total)}</Text>
                    </View>
                    {data.prev_total > 0 && (
                      <View style={styles.legendItem}>
                        <View style={[styles.legendLine, styles.legendDashed]} />
                        <Text style={styles.legendLabel}>
                          geçen ay {formatEURShort(data.prev_total)}
                        </Text>
                      </View>
                    )}
                  </View>
                </Card>

                {/* SON 6 AY — tek bakışta genel gidiş.
                    Çubuk sayısı = VERİ OLAN ay sayısı. Evin ilk harcamasından
                    önceki aylar sunucudan hiç gelmiyor: "o ay hiç harcamadın"
                    ile "o ay yoktun" farklı şeyler ve ikincisini sıfır çubukla
                    çizmek yalan olur.

                    İKİDEN AZ ayda kart hiç çizilmiyor — bir çubuğun
                    karşılaştıracağı bir şey yok ve o ayın rakamı zaten
                    başlıkta duruyor. Anasayfa'daki trend satırının kuralının
                    aynısı: karşılaştırılacak geçmiş yoksa çizme, dolgu
                    metniyle doldurma. */}
                {(data.son_aylar || []).length >= 2 && (
                  <Card title={`Son ${data.son_aylar.length} Ay`} style={styles.mx} padded>
                    <AylikCubuk aylar={data.son_aylar} buAy={data.month}
                                onSec={(m) => setMonth(m)} />
                  </Card>
                )}

                {/* EN ÇOK HARCADIKLARIMIZ — ürün bazlı, genel ada göre.
                    `MILSANI`, `MILBONA` ve `JA! MILCH` tek satırda "Süt"
                    olarak toplanıyor; bunu rakiplerin hiçbiri üretemez çünkü
                    hiçbiri fişi kalem kalem okumuyor.

                    **Adı "aldıklarımız" değil "HARCADIKLARIMIZ".** Liste
                    tutara göre sıralı ve ikisi farklı sorular: kilosu 20 €
                    olan etten 2 kilo ile kilosu 1 € olan undan 40 kilo aynı
                    tutarı verir. "Aldıklarımız" miktar ima ediyordu ve sıralama
                    onu tutmuyordu. Sıklığa göre sıralama "Tüm Ürünler"
                    sayfasında, kendi anahtarıyla.

                    Karşılaştırmaya ihtiyacı yok: ilk aydan itibaren dolu
                    geliyor. Yalnızca EV kapsamında — kişisel sekmede "ne
                    aldık" sorusunun öznesi kayboluyor. */}
                {(data.products || []).length > 0 && (
                  <Card title="En Çok Harcadıklarımız" style={styles.mx}
                        action={data.product_count > data.products.length
                          ? `Tümü · ${data.product_count}` : undefined}
                        onAction={() => router.push({
                          pathname: "/(tabs)/urunler",
                          params: { ay: data.month, scope, geri: "/(tabs)/istatistik" },
                        })}>
                    {data.products.map((u, i) => (
                      <View key={u.key}>
                        {i > 0 && <Divider inset={spacing.lg} />}
                        <View style={styles.urunRow}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.urunAd} numberOfLines={1}>{u.name}</Text>
                            <Text style={styles.urunAlt} numberOfLines={1}>
                              {urunAlt(u)}
                            </Text>
                          </View>
                          <Money value={u.total} />
                        </View>
                      </View>
                    ))}
                  </Card>
                )}

                {/* Duzenli giderlerin ay ay seyri. Kira aydan aya degismiyor
                    ve zaten listede yok; asil merak edilen elektrik, su,
                    dogalgaz gibi tutari degisen faturalar. Degismeyen satir
                    her ay ayni seyi soyler ve asil degiseni gizler. */}
                {data.bills.length > 0 && (
                  <Card title="Faturalar" style={styles.mx}>
                    {data.bills.map((b, i) => (
                      <View key={b.recurring_id}>
                        {i > 0 && <Divider inset={spacing.lg} />}
                        <View style={styles.catRow}>
                          <Ionicons name="repeat" size={16} color={colors.inkTertiary} />
                          <Text style={styles.catName} numberOfLines={1}>{b.name}</Text>
                          {b.change_pct !== null && (
                            <View style={[styles.deltaTag, {
                              backgroundColor: b.change_pct > 0 ? colors.negativeSoft : colors.accentSoft,
                            }]}>
                              <Text style={[styles.deltaTxt, {
                                color: b.change_pct > 0 ? colors.negative : colors.accentDark,
                              }]}>
                                {b.change_pct > 0 ? "↑" : "↓"} %{Math.abs(b.change_pct)}
                              </Text>
                            </View>
                          )}
                          <View style={{ alignItems: "flex-end", minWidth: 84 }}>
                            <Money value={b.total} />
                            <Text style={styles.billPrev}>
                              geçen ay {formatEURShort(b.prev_total)}
                            </Text>
                          </View>
                        </View>
                      </View>
                    ))}
                  </Card>
                )}

                {/* Senin toplam cikisin: ev payin + kisiselin. Oran degil
                    toplam -- "kisiselin evin yuzde 35'i" garip bir sayi,
                    "bu ay toplam su kadar harcadin" gercek bir soruya cevap. */}
                {scope === "household" && (
                  <Card title="Senin Katkın" style={styles.mx} padded>
                    <View style={styles.outRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.legendLabel}>Ev payın</Text>
                        <Text style={styles.outValue}>{formatEUR(data.my_share)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.legendLabel}>Kişisel</Text>
                        <Text style={styles.outValue}>{formatEUR(data.my_personal)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.legendLabel}>Toplam</Text>
                        {/* Nötr, yeşil DEĞİL. Yeşil bu uygulamada tek bir şey
                            demek: alacak. Senin toplam çıkışın bir alacak
                            değil, harcadığın para. Renk anlamını bir yerde
                            kaybederse her yerde kaybeder. */}
                        <Text style={styles.outValue}>
                          {formatEUR(data.my_share + data.my_personal)}
                        </Text>
                      </View>
                    </View>
                  </Card>
                )}

                {/* ZAMLANANLAR / UCUZLAYANLAR — evin KENDİ sepetinin enflasyonu.
                    Resmî enflasyon herkesin sepetidir; bu sizinki. Rakiplerin
                    hiçbirinde yok çünkü hiçbiri fişi kalem kalem okumuyor.

                    Ucuzlayanlar da listede: yalnızca zam göstermek insanı her
                    ay kötü haberle karşılar ve bir süre sonra kimse bakmaz.

                    Veri yoksa kart hiç çizilmiyor — bu ev üç farklı marketten
                    çoğunlukla market markası alıyor, kart aylarca boş
                    kalabilir ve bu sorun değil. */}
                {(fiyat?.up.length || fiyat?.down.length) ? (
                  <Card title="Fiyat Hareketleri" style={styles.mx}>
                    {[...(fiyat.up || []), ...(fiyat.down || [])].map((f, i) => (
                      <View key={`${f.merchant}-${f.key}-${f.pack_type}`}>
                        {i > 0 && <Divider inset={spacing.lg} />}
                        <View style={styles.fiyatRow}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.fiyatAd} numberOfLines={1}>{f.name}</Text>
                            {/* Market YAZILI: karşılaştırma aynı market içinde
                                yapıldığı için hangisi olduğu bilginin parçası. */}
                            <Text style={styles.fiyatAlt} numberOfLines={1}>
                              {f.merchant.toLocaleUpperCase("tr")} · {formatEUR(f.prev)} → {formatEUR(f.now)}
                              {f.unit !== "adet" ? `/${f.unit}` : ""}
                            </Text>
                          </View>
                          <View style={[styles.fiyatTag, {
                            backgroundColor: f.change_pct > 0 ? colors.negativeSoft : colors.accentSoft,
                          }]}>
                            <Text style={[styles.fiyatTagTxt, {
                              color: f.change_pct > 0 ? colors.negative : colors.accentDark,
                            }]}>
                              {f.change_pct > 0 ? "↑" : "↓"} %{Math.abs(f.change_pct)}
                            </Text>
                          </View>
                        </View>
                      </View>
                    ))}
                  </Card>
                ) : null}

                {scope === "household" && data.by_member.length > 0 && (
                  <Card title="Kim Ne Kadar Ödedi" style={styles.mx}>
                    {data.by_member.map((bm, i) => {
                      const m = member(bm.user_id);
                      return (
                        <View key={bm.user_id}>
                          {i > 0 && <Divider />}
                          <Row
                            leading={<Avatar name={m?.name} avatarId={(m as any)?.avatar_id}
                                             userId={m?.user_id} photoVersion={(m as any)?.photo_version} />}
                            title={m?.user_id === user?.user_id ? `${m?.name} (sen)` : (m?.name || "—")}
                            right={<Money value={bm.total} />}
                          />
                        </View>
                      );
                    })}
                  </Card>
                )}

                {/* Marketler artık LİSTE, yığın değil: satır tıklanabilir
                    olunca hedefin öngörülebilir yükseklikte olması gerekiyor
                    ve geçen ay sütunu da hizalanacak bir yer istiyor.

                    Geçen ay sütunu kategori kartındaki değişim rozetiyle aynı
                    işi yapıyor — "buraya geçen aydan çok mu gidiyoruz" sorusu,
                    kategoriler için sorulan sorunun aynısı. */}
                {data.merchants.length > 0 && (
                  <Card title="Marketler" style={styles.mx}>
                    {data.merchants.map((mm, i) => (
                      <View key={mm.key || mm.name}>
                        {i > 0 && <Divider inset={spacing.lg} />}
                        <Pressable
                          style={styles.merchRow}
                          onPress={() => router.push({
                            pathname: "/(tabs)/market",
                            params: { key: mm.key || mm.name, ad: mm.name, ay: month,
                                      scope, geri: "/(tabs)/istatistik" },
                          })}
                          testID={`market-${mm.key || mm.name}`}
                        >
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <MerchantBadge name={mm.name} />
                          </View>
                          <View style={{ alignItems: "flex-end" }}>
                            <Money value={mm.total} />
                            {/* Geçen ay YALNIZCA varsa: sıfırla karşılaştırmak
                                "%100 arttı" gibi anlamsız bir sayı üretir. */}
                            {mm.prev_total > 0.005 && (
                              <Text style={styles.merchPrev}>
                                geçen ay {formatEURShort(mm.prev_total)}
                              </Text>
                            )}
                          </View>
                          <Ionicons name="chevron-forward" size={14}
                                    color={colors.onSurfaceTertiary} />
                        </Pressable>
                      </View>
                    ))}
                  </Card>
                )}
              </>
            )}
          </View>
        </Sheet>
      </ScrollView>

      {/* Veri OLAN aylar belirgin, olmayanlar soluk ama yine secilebilir:
          "o ay hic harcama yok" da bir cevaptir, tiklanamaz bir hucre ise
          kullaniciya neden secemedigini soylemez. */}
      <BottomSheet visible={aySecici} onClose={() => setAySecici(false)} testID="stat-month-sheet">
        {yillar.map((yil) => (
          <View key={yil}>
            <Text style={styles.yilBaslik}>{yil}</Text>
            <View style={styles.ayIzgara}>
              {AYLAR.slice(1).map((ad, i) => {
                const anahtar = `${yil}-${String(i + 1).padStart(2, "0")}`;
                const secili = anahtar === month;
                const ileride = anahtar > thisMonth();
                const veriVar = (data?.months || []).includes(anahtar);
                if (ileride) return <View key={ad} style={styles.ayHucre} />;
                return (
                  <Pressable
                    key={ad}
                    style={[styles.ayHucre, secili && styles.ayHucreOn,
                            !veriVar && !secili && styles.ayHucreBos]}
                    onPress={() => { setMonth(anahtar); setAySecici(false); }}
                    testID={`stat-month-${anahtar}`}
                  >
                    <Text style={[styles.ayTxt, secili && styles.ayTxtOn]}>
                      {ad.slice(0, 3)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  // Alt boşluk `useScrollPad`'den geliyor: gezinme çubuğu payı cihaza göre
  // değişiyor, sabit bir sayı üç düğmeli telefonda son kartı çubuğun altında
  // bırakıyordu.
  page: { backgroundColor: colors.bg, flexGrow: 1 },
  headBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.darkSurface,
    alignItems: "center", justifyContent: "center",
  },
  monthNav: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm },
  navBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.darkSurface,
    alignItems: "center", justifyContent: "center",
  },
  heroLabel: { ...T.caption, color: colors.onDarkMuted, letterSpacing: 0.6 },
  // Ay secici: yil basligi + 12 hucrelik izgara. Liste yerine izgara, cunku
  // "gecen subat" aranirken goz aylari konumundan buluyor, sirasindan degil.
  yilBaslik: {
    ...overline, paddingHorizontal: spacing.lg,
    marginTop: spacing.md, marginBottom: spacing.xs,
  },
  ayIzgara: {
    flexDirection: "row", flexWrap: "wrap", gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  ayHucre: {
    width: "22%", minHeight: 40, alignItems: "center", justifyContent: "center",
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  ayHucreOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  ayHucreBos: { opacity: 0.35 },
  ayTxt: { ...T.captionSb, color: colors.inkSecondary },
  ayTxtOn: { color: colors.onDark },
  heroValue: {
    fontSize: 34, lineHeight: 42, fontFamily: fontFamily.bold,
    color: colors.onDark, letterSpacing: -1,
  },
  trend: {
    flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "center",
    backgroundColor: colors.darkSurface, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 5, marginTop: spacing.sm,
  },
  trendTxt: { ...T.captionSb, color: colors.accentOnDark },
  tabWrap: { marginTop: spacing.lg },
  mx: { marginHorizontal: spacing.lg },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xl },
  emptyTitle: { ...T.emph, color: colors.ink },
  emptyDesc: { ...T.caption, color: colors.inkTertiary, textAlign: "center", lineHeight: 19 },
  donutWrap: { alignItems: "center", paddingVertical: spacing.lg },
  donutTotal: { ...T.emph, fontSize: 20, color: colors.ink },
  donutSub: { ...T.caption, color: colors.inkTertiary },
  catValue: { minWidth: 74, textAlign: "right" },
  deltaTag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.sm },
  deltaTxt: { fontSize: 11, lineHeight: 15, fontFamily: fontFamily.medium },
  fiyatRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 48,
  },
  fiyatAd: { ...T.bodySb, color: colors.ink },
  fiyatAlt: { ...T.caption, fontSize: 11, color: colors.inkTertiary, marginTop: 1 },
  fiyatTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  fiyatTagTxt: { ...T.caption, fontSize: 11, fontFamily: fontFamily.semibold },
  urunRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 46,
  },
  urunAd: { ...T.bodySb, color: colors.ink },
  urunAlt: { ...T.caption, fontSize: 11, color: colors.inkTertiary, marginTop: 1 },
  curveLegend: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.sm },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendLine: { width: 14, height: 2, borderRadius: 1 },
  legendDashed: { backgroundColor: colors.inkTertiary, opacity: 0.7 },
  legendLabel: { ...T.caption, color: colors.inkTertiary },
  billPrev: { ...T.caption, fontSize: 11, color: colors.inkTertiary },
  outRow: { flexDirection: "row", gap: spacing.md },
  outValue: { ...T.bodySb, fontSize: 16, color: colors.ink, marginTop: 2 },
  foot: { ...T.caption, color: colors.inkTertiary, marginTop: spacing.md,
          paddingHorizontal: spacing.lg, paddingBottom: spacing.md, lineHeight: 17 },
  catRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 50,
  },
  catName: { ...T.body, color: colors.ink, flex: 1 },
  merchRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 48,
  },
  merchPrev: { ...T.caption, fontSize: 10, color: colors.inkTertiary, marginTop: 1 },
});
