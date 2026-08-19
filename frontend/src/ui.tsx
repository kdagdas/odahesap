/**
 * Ortak arayüz bileşenleri.
 *
 * Tasarım kuralları burada tek yerde toplanır:
 *  - Liste satırları ayrı ayrı kartlara konmaz. Tek kap (`Card`) içinde
 *    `Row`'lar ve aralarında saç teli `Divider` durur. Önceki sürümde her
 *    satır kendi kenarlığı ve gölgesiyle ayrı bir karttı; sekiz harcama
 *    sekiz kenarlık demekti.
 *  - Kart başlığı kartın İÇİNDEDİR (`Card title=`), üstünde gri etiket değil.
 *  - Ekran başına tek yükseltilmiş yüzey: koyu `ScreenHeader`. Kartlar düz.
 *  - Tutarlar sağa yaslı ve eşit genişlikte rakamla (`Money`).
 */
import React from "react";
import {
  View, Text, Pressable, StyleSheet, ViewStyle, StyleProp, Image, TextStyle,
  Keyboard, Platform, Modal, Alert, TextInput, Animated, BackHandler,
  LayoutAnimation, UIManager,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle } from "react-native-svg";
import { useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  Gesture, GestureDetector, GestureHandlerRootView,
} from "react-native-gesture-handler";

import {
  colors, spacing, radius, type as T, overline, fontFamily, metrics, merchantTint,
  CATEGORY_ICONS, CATEGORY_LABEL_TR, getAvatar,
} from "./theme";

/* ------------------------------------------------------------------ metin */

export function Overline({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[overline, style]}>{children}</Text>;
}

/**
 * Para. Rakamlar eşit genişlikte, böylece alt alta tutarlar hizalanır.
 *
 * `numberOfLines={1}` KULLANILMAZ: Android metni önce ölçüp sonra `tnum`
 * özelliğini uyguluyor, tablo rakamları dar rakamlardan (1, 7) geniş olduğu
 * için metin ölçülen kutusuna sığmayıp "…" ile kırpılıyordu — € işareti
 * yerine üç nokta çıkmasının sebebi buydu.
 *
 * Satır sonu sorunu bunun yerine iki yerden çözülüyor: `flexShrink: 0` tutarın
 * sıkışmasını, `formatEUR` içindeki bölünmez boşluk da "€"nin alt satıra
 * düşmesini engelliyor.
 */
export function Money({
  value, style, sign = false, color,
}: { value?: number | null; style?: StyleProp<TextStyle>; sign?: boolean; color?: string }) {
  return (
    <Text style={[styles.money, color ? { color } : null, style]}>
      {formatEUR(value, sign)}
    </Text>
  );
}

/* ------------------------------------------------------- koyu ekran başlığı */

/** Başlığın üç boyu — bkz. `ScreenHeader`. */
export type HeaderSize = "s" | "m" | "l";

/**
 * Boya göre alt boşluk.
 *
 * `sheet` yukarı doğru 24 piksel (`spacing.xl`) biniyor, yani bu sayıların
 * 24'ü kavisin altında kalıyor. Görünen boşluk sırasıyla **8 / 12 / 20.**
 * Kavis binişi her boyda aynı — uygulamanın imzası olan o katman bozulmuyor.
 */
const HEADER_PAD: Record<HeaderSize, number> = {
  s: spacing.xl + spacing.sm,
  m: spacing.xl + spacing.md,
  l: spacing.xxl + spacing.md,
};

/**
 * Tam genişlikte koyu alan; içerik yüzeyi bunun üzerine kavisle biner.
 * Hero bir kart değil, ekranın kendisidir — "her şey dikdörtgen" hissini
 * kıran asıl hamle bu.
 *
 * ### Üç boy
 *
 * Boy bir YÜKSEKLİK değil bir **İÇERİK** kuralıdır; Material 3'ün
 * küçük/orta/büyük üst çubuğu gibi:
 *
 * | Boy | İçerik | Ekranlar |
 * |---|---|---|
 * | `s` | yalnızca kimlik | Ayarlar, Ev ayarları, Aktivite, Düzenli, Ödeme bilgilerim, Harcama düzenle |
 * | `m` | kimlik + tek şerit (sekme, süzgeç, tek satır durum) | Alınacaklar, Harcamalar, Bildirimler, Profil |
 * | `l` | kahraman sayı | Anasayfa, Kasa, İstatistik, üye dökümü, elle giriş |
 *
 * Verilmezse çocuk olup olmamasından türetilir (`children` varsa `m`, yoksa
 * `s`); `l` her zaman **açıkça** yazılır çünkü türetilemez.
 *
 * Önceden her başlık boyundan bağımsız olarak aynı alt boşluğu (44) ödüyor ve
 * `headerTop` çocuk olmasa bile 16 piksel ekliyordu: yalnızca başlık taşıyan
 * bir ekranda başlığın altında 36 piksel **görünür boşluk** kalıyordu.
 * Yüksekliklerin ekrandan ekrana gezinmesinin sebebi buydu — her ekranın
 * kendi sayısını uydurması değil, tek bir sayının her ekrana uymamasıydı.
 */
export function ScreenHeader({
  overline: over, title, right, children, testID, onTitlePress, size,
}: {
  overline?: string; title?: string; right?: React.ReactNode;
  children?: React.ReactNode; testID?: string;
  /** Başlık bir seçici açıyorsa (ör. İstatistik'te ay): yanına ok gelir. */
  onTitlePress?: () => void;
  /** Verilmezse içerikten türetilir. `l` açıkça yazılmalı. */
  size?: HeaderSize;
}) {
  const insets = useSafeAreaInsets();
  const boy: HeaderSize = size ?? (children ? "m" : "s");
  return (
    <LinearGradient
      colors={[colors.dark, colors.darkAlt]}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[styles.header, {
        paddingTop: insets.top + spacing.md,
        paddingBottom: HEADER_PAD[boy],
      }]}
      testID={testID}
    >
      <View style={styles.headerInner}>
      {(over || title || right) && (
        /* Boşluk yalnızca ALTINDA bir şey varsa; yoksa başlık boşluğa
           bakıyordu. */
        <View style={[styles.headerTop, children ? styles.headerTopGap : null]}>
          <View style={{ flex: 1 }}>
            {over ? <Text style={styles.headerOverline}>{over}</Text> : null}
            {title ? (
              onTitlePress ? (
                <Pressable onPress={onTitlePress} style={styles.headerTitleRow}
                           hitSlop={8} testID="header-title">
                  <Text style={styles.headerTitle}>{title}</Text>
                  <Ionicons name="chevron-down" size={17} color={colors.onDarkMuted} />
                </Pressable>
              ) : <Text style={styles.headerTitle}>{title}</Text>
            ) : null}
          </View>
          {right}
        </View>
      )}
      {children}
      </View>
    </LinearGradient>
  );
}

/** Koyu başlığın içindeki iki sütunlu istatistik bloğu. */
export function HeaderSplit({ items }: { items: { label: string; value: string; accent?: boolean }[] }) {
  /* ÜÇ sütun dar telefona sığmıyor: 360dp ekranda kenar boşlukları ve
     ayraçlar düşünce sütun başına ~95dp kalıyor, "1.240,50 €" ise 17 puntoda
     oraya sığmayıp alt satıra düşüyor. Üçten itibaren ölçü küçülüyor, ayraç
     boşluğu daralıyor ve satırlar tek satıra kilitleniyor.

     `minWidth: 0` şart: flex çocuğu varsayılan olarak içeriğinden daha dar
     olmayı reddediyor ve `numberOfLines` tek başına taşmayı durdurmuyor. */
  const sik = items.length >= 3;
  return (
    <View style={styles.split}>
      {items.map((it, i) => (
        <React.Fragment key={it.label}>
          {i > 0 && <View style={[styles.splitLine, sik && { marginRight: spacing.md }]} />}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.splitLabel} numberOfLines={1}>{it.label}</Text>
            <Text
              numberOfLines={1}
              style={[styles.splitValue, sik && styles.splitValueSik,
                      it.accent && { color: colors.accentOnDark }]}
            >
              {it.value}
            </Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

/**
 * Koyu başlıkta yüzde değişimi rozeti.
 *
 * `onPress` verilirse rozetin kendisi istatistiklere giden düğme olur — yan
 * yana iki hap koymak yerine tek ve daha büyük bir dokunma hedefi.
 */
export function TrendBadge({
  pct, onPress, testID,
}: { pct?: number | null; onPress?: () => void; testID?: string }) {
  const up = (pct ?? 0) >= 0;
  // İlk dönemde kıyaslanacak bir şey yok; "%0 artış" yazmak yanlış olurdu.
  const hasTrend = pct !== null && pct !== undefined;
  const inner = (
    <>
      {hasTrend && (
        <>
          <Ionicons name={up ? "trending-up" : "trending-down"} size={13} color={colors.accentOnDark} />
          <Text style={styles.trendTxt}>%{Math.abs(pct as number)} {up ? "artış" : "azalış"}</Text>
        </>
      )}
      {onPress && (
        <>
          {hasTrend && <View style={styles.trendSep} />}
          <Ionicons name="stats-chart" size={12} color={colors.accentOnDark} />
          <Text style={styles.trendTxt}>Analizler</Text>
          <Ionicons name="chevron-forward" size={12} color={colors.accentOnDark} />
        </>
      )}
    </>
  );
  return onPress
    ? <Pressable onPress={onPress} testID={testID} style={styles.trend} hitSlop={6}>{inner}</Pressable>
    : <View style={styles.trend}>{inner}</View>;
}

/**
 * Klavyenin kapladığı yükseklik.
 *
 * `KeyboardAvoidingView` mutlak konumlu (position: absolute) öğeleri
 * itmiyor — alttan açılan sayfalar tam da öyle konumlanıyor ve klavye
 * açılınca tutar alanı klavyenin arkasında kalıyordu. Kenardan kenara
 * (edge-to-edge) çizim açık olduğu için pencere yeniden boyutlanması da
 * güvenilir değil. Yüksekliği doğrudan ölçüp elle yukarı itmek her iki
 * platformda da öngörülebilir çalışan tek yol.
 */
export function useKeyboardHeight() {
  const [height, setHeight] = React.useState(0);
  React.useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return height;
}

/**
 * Telefon genişliği. Tabletlerde içerik bunun ötesine yayılmıyor.
 *
 * Uygulama telefon önceliklidir ve satırların çoğu `space-between` kullanır:
 * ad solda, tutar sağda. 380 piksellik bir kutuda doğru duran bu düzen 1000
 * piksellik bir tablette iki ucu birbirinden kopuk iki sütuna dönüşüyordu.
 * Tek tek yamamak yerine kabı sınırlamak doğrusu — ekranların hepsi `Sheet`
 * ve `ScreenHeader` kullandığı için kural iki yerde duruyor.
 */
export const CONTENT_MAX_WIDTH = 560;

/**
 * Alt sekme cubugunun kapladigi yukseklik.
 *
 * Tek yerde duruyor cunku iki taraf birden okuyor: cubugu CIZEN
 * `(tabs)/_layout.tsx` ve altinda kalmamak icin pay birakan sekme ekranlari.
 * Ayri ayri yazildiginda biri degisip oteki unutuluyordu -- ekranlarda 120 ve
 * 130 gibi elle uydurulmus sayilar tam olarak bu yuzden vardi.
 */
export const tabBarHeight = (bottomInset: number) => 60 + Math.max(bottomInset, 12) + 12;

/**
 * Kaydirma alaninin alt bosluğu.
 *
 * KURAL: hicbir icerik gezinme cubugunun altinda kalmaz. `edgeToEdgeEnabled`
 * acik oldugu icin uygulama kenardan kenara ciziyor ve bu payi her ekran
 * kendisi birakmak zorunda. Sabit bir sayi yazmak (`paddingBottom: 32`)
 * gezinme cubugu olmayan telefonda dogru, uc dugmeli telefonda yanlisti --
 * son kartin yarisi cubugun altinda kaliyordu.
 *
 * `tabs: true` sekme cubugu olan ekranlar icin; digerlerinde yalnizca
 * telefonun kendi cubugu kadar pay birakilir.
 */
/**
 * Sekme yığınında "geri" — `router.back()` YETMİYOR.
 *
 * Harcamalar, İstatistik ve üye dökümü `(tabs)` grubunda `href: null` ile
 * duruyor: bunlar *gezilen* ekranlar, sekme çubuğu kalmalı (bkz. DEVAM.md
 * "Sekme çubuğu hangi ekranda kalır"). Ama sekme gezgininde bir ekrandan
 * diğerine geçmek yığına EKLEME değil sekme DEĞİŞTİRME; `back()` o yüzden
 * yığının dibindeki ilk sekmeye, yani Anasayfa'ya düşüyor. Kasa'dan girip
 * geri çıkan insan Kasa'ya dönmüyordu.
 *
 * Çözüm gideni değil GELDİĞİ YERİ taşımak: çağıran `?geri=` yazıyor.
 */
export function useGeriDon(varsayilan = "/(tabs)/panel") {
  const router = useRouter();
  const { geri } = useLocalSearchParams<{ geri?: string }>();
  const don = React.useCallback(() => {
    const hedef = typeof geri === "string" && geri.startsWith("/") ? geri : varsayilan;
    router.replace(hedef as any);
  }, [geri, varsayilan, router]);

  /* DONANIM GERİ TUŞU da aynı yere gitmeli.
     Köşedeki X düğmesi bu kancayı kullanıyordu ama telefonun kendi geri
     jesti kullanmıyordu: o, sekme gezgininin varsayılanına düşüyor ve
     yığının dibindeki Anasayfa'ya gidiyordu. İstatistik → kategori → geri
     yapan insan İstatistik'e değil Anasayfa'ya çıkıyordu.

     `true` döndürmek olayı burada bitiriyor; ekran odakta değilken
     dinleyici kaldırılıyor ki üst üste açılan ekranlarda yalnızca en
     üsttekinin geri tuşu çalışsın. */
  useFocusEffect(
    React.useCallback(() => {
      const abone = BackHandler.addEventListener("hardwareBackPress", () => {
        don();
        return true;
      });
      return () => abone.remove();
    }, [don]),
  );

  return don;
}

/**
 * Sekme her odaklandığında listeyi başa sarar.
 *
 * Sekmeye dokunmak "buraya bakmak istiyorum" demektir, "bıraktığım yere
 * dönmek istiyorum" değil — ekranın cevabı (borcun ne kadar, ev ne harcadı)
 * en üstte duruyor ve yarısından açılan bir liste o cevabı gizliyordu.
 *
 * `animated: false` bilerek: odaklanma anındaki bir kaydırma animasyonu
 * veri çekmeyle aynı kareye düşüyor ve titreme gibi görünüyor.
 */
export function useBasaSar(ref: React.RefObject<{ scrollTo: (o: any) => void } | null>) {
  useFocusEffect(
    React.useCallback(() => {
      ref.current?.scrollTo({ y: 0, animated: false });
    }, [ref]),
  );
}

/**
 * `RefreshControl` özellikleri — tek yerden, çünkü bir tanesi PLATFORMA GÖRE
 * çalışıyor ve bu sessizce kırılıyordu.
 *
 * **`tintColor` yalnızca iOS'ta geçerli.** Android dönen oku `colors`
 * dizisinden alıyor ve verilmezse sistemin VARSAYILAN koyu mavisini
 * kullanıyor. Karanlık temada o ok, `progressBackgroundColor` olarak verilen
 * koyu yüzeyin (#161B22) üstüne düşünce neredeyse görünmez oluyordu —
 * kullanıcı "yenilerken yukarıdan dönen işaret" diye tam bunu bildirdi.
 *
 * `ink` seçildi çünkü iki temada da zeminden en uzak renk: aydınlıkta koyu
 * mürekkep, karanlıkta açık. Yeşil denendi ama beyaz üstünde 3:1'in altında
 * kalıyor.
 */
export function yenileme(refreshing: boolean, onRefresh: () => void) {
  return {
    refreshing,
    onRefresh,
    tintColor: colors.ink,          // iOS
    colors: [colors.ink],           // Android
    progressBackgroundColor: colors.surface,
  };
}

/**
 * Aylık çubuk — "Son 6 Ay".
 *
 * ### Neden her çubuğun üstünde sayı var
 *
 * Çıplak çubuk yalnızca sıralama söyler; ekranda görünen her sayının
 * doğrulanabilir olması uygulamanın kuralı. Kısaltılmış biçim (`1,2b`)
 * kullanılıyor çünkü altı sütun dar telefonda sütun başına ~45 piksel
 * bırakıyor ve tam tutar oraya sığmıyor.
 *
 * ### Neden bu ay koyu
 *
 * Karşılaştırmanın öznesi o. Renk yerine yükseklikle ayırmak olmazdı —
 * kısa bir ay en alçak çubuk olur ve gözden kaçar.
 *
 * ### Ortalama çizgisi
 *
 * Tek başına "474 €" bir sayıdır; çubukların arasından geçen bir çizgi ise
 * "bu ay ortalamanın altındayız" cümlesini kurdurur. Rakam altta yazılı.
 *
 * ### Çubuğa dokunmak
 *
 * Sayfayı o aya götürüyor. Yeni bir ekran değil, zaten var olan ay
 * seçicisinin daha hızlı hâli — kademeli açılım kuralı.
 */
export function AylikCubuk({
  aylar, buAy, onSec,
}: {
  aylar: { month: string; total: number }[];
  buAy: string;
  onSec: (m: string) => void;
}) {
  const enYuksek = Math.max(...aylar.map((a) => a.total), 0.01);
  const ortalama = aylar.reduce((s, a) => s + a.total, 0) / Math.max(aylar.length, 1);
  const TAVAN = 64;
  const ARA = 5;
  /** Kaç slotluk genişliğe göre ölçüleceği. ALTI sabit: iki aylık bir evin
   *  çubuğu, altı aylık bir evinkiyle aynı kalınlıkta olsun. Ölçmeden
   *  yapılamıyor, çünkü kartın genişliği ekrana göre değişiyor. */
  const SLOT = 6;
  const [genislik, setGenislik] = React.useState(0);
  const slotGen = genislik > 0
    ? Math.max((genislik - (SLOT - 1) * ARA) / SLOT, 8)
    : 0;
  // Ortalama çizgisi yalnızca ÇUBUKLARIN üstünde: boş alana kadar uzasaydı
  // veri olmayan aylarda da bir ortalama varmış gibi görünürdü.
  const cizgiGen = slotGen > 0
    ? aylar.length * slotGen + (aylar.length - 1) * ARA
    : 0;

  return (
    <>
      <View style={[styles.cubukSatir, { gap: ARA }]}
            onLayout={(e) => setGenislik(e.nativeEvent.layout.width)}>
        {/* Çizgi çubukların ARKASINDAN geçiyor: önlerinden geçse kısa
            çubukları ikiye böler ve okunmaz olur. */}
        {cizgiGen > 0 && (
          <View pointerEvents="none"
                style={[styles.ortCizgi,
                        { width: cizgiGen, bottom: (ortalama / enYuksek) * TAVAN }]} />
        )}
        {slotGen > 0 && aylar.map((a) => {
          const bu = a.month === buAy;
          return (
            <Pressable key={a.month} style={[styles.cubukKap, { width: slotGen }]}
                       onPress={() => onSec(a.month)} testID={`cubuk-${a.month}`}>
              <Text style={[styles.cubukTutar, bu && styles.cubukTutarBu]} numberOfLines={1}>
                {formatEURShort(a.total)}
              </Text>
              <View style={[styles.cubuk, {
                height: Math.max((a.total / enYuksek) * TAVAN, 3),
                backgroundColor: bu ? colors.ink : colors.borderStrong,
              }]} />
              <Text style={[styles.cubukAy, bu && styles.cubukAyBu]} numberOfLines={1}>
                {AYLAR[parseInt(a.month.slice(5, 7), 10)]?.slice(0, 3)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Divider inset={0} />
      <View style={styles.ortSatir}>
        <Text style={styles.ortLabel}>{aylar.length} ay ortalaması</Text>
        <Money value={ortalama} color={colors.ink} />
      </View>
    </>
  );
}

/**
 * İKİ İKONLU küçük anahtar — kart başlığına sığan en dar seçici.
 *
 * `TabSwitch` yazı taşıyor ve kart başlığında başlığın kendisiyle yarışıyor.
 * Burada seçenek adı zaten BAŞLIKTA yazılı ("En Çok Harcadıklarımız" ↔
 * "En Sık Aldıklarımız"), yani ikon tek başına yeterli: dokunulunca başlık
 * değişiyor ve ne olduğu okunuyor.
 *
 * Var olma sebebi keşfedilebilirlik: sıklık sıralaması "Tüm Ürünler"
 * sayfasının içinde saklıydı ve kimse orada bir anahtar olduğunu bilmiyordu.
 */
export function IconSwitch<T extends string>({
  value, options, onChange, testID,
}: {
  value: T;
  options: { value: T; icon: string; label: string }[];
  onChange: (v: T) => void;
  testID?: string;
}) {
  return (
    <View style={styles.ikonAnahtar} testID={testID}>
      {options.map((o) => {
        const secili = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.ikonBtn, secili && styles.ikonBtnSecili]}
            hitSlop={6}
            accessibilityLabel={o.label}
            testID={testID ? `${testID}-${o.value}` : undefined}
          >
            <Ionicons name={o.icon as any} size={15}
                      color={secili ? colors.ink : colors.inkTertiary} />
          </Pressable>
        );
      })}
    </View>
  );
}

export function useScrollPad(opts?: { tabs?: boolean; extra?: number }) {
  const insets = useSafeAreaInsets();
  /* Sekme cubugu `position: absolute` DEGIL: React Navigation ekrani zaten
     cubugun ustunde bitiriyor, yani ScrollView'in gorunur alani cubugu hic
     icermiyor. Buraya cubuk yuksekligi eklemek ~120 piksel bos kaydirma
     uretiyordu -- son oge ekranin ortasina geliyor ve altinda hicbir sey
     olmayan bir bosluk kaliyordu. (Eski koddaki elle yazilmis 120/130
     sabitleri de ayni hatayi tasiyordu.)
     Sekmeli ekranda cihazin gezinme cubugu payini da cubuk kendisi
     ustleniyor; burada yalnizca nefes payi kaliyor. */
  const alt = opts?.tabs ? 0 : insets.bottom;
  return { paddingBottom: alt + (opts?.extra ?? spacing.xxl) };
}

/**
 * Liste degisimini yumusatir — bir sonraki cizimde uygulanir.
 *
 * KURAL: animasyon degisimi ACIKLAR, suslemez. Alinacaklar'da isaretlenen
 * madde bir yerden otekine ZIPLIYORDU; kayarak gitmesi "senin yaptigin seyin
 * sonucu" diyor. Sekme gecis animasyonu ise BILEREK yok -- denenmis ve geri
 * alinmisti, cunku sekmeye basmak ayni anda veri cekiyor ve animasyon o
 * render firtinasiyla yarisiyor (bkz. SIRADAKI-TUR.md).
 */
export function animateNextLayout() {
  if (Platform.OS === "android" && !UIManager.setLayoutAnimationEnabledExperimental) return;
  LayoutAnimation.configureNext(LayoutAnimation.create(
    220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity,
  ));
}

/**
 * Degisen bir tutari hedefine SAYARAK gider.
 *
 * Odeme kaydedince bakiyenin bir anda yeni degere atlamasi "bir sey oldu mu"
 * sorusunu biraktiyordu; sayarak gitmesi yaptigin isin etkisini gosteriyor.
 * Revolut ve Monzo'nun imzasi. Tek sayi degistigi icin liste yeniden
 * cizilmiyor -- kasma riski yok.
 */
export function useCountUp(value: number, ms = 550) {
  const [gosterilen, setGosterilen] = React.useState(value);
  const onceki = React.useRef(value);
  React.useEffect(() => {
    const bas = onceki.current;
    if (bas === value) return;
    const t0 = Date.now();
    const id = setInterval(() => {
      const p = Math.min((Date.now() - t0) / ms, 1);
      // easeOutCubic: hizli basla, yavas bitir.
      const e = 1 - Math.pow(1 - p, 3);
      setGosterilen(bas + (value - bas) * e);
      if (p >= 1) { clearInterval(id); onceki.current = value; setGosterilen(value); }
    }, 16);
    return () => clearInterval(id);
  }, [value, ms]);
  return gosterilen;
}

/** İçerik yüzeyi — koyu başlığın üzerine kavisle biner. */
export function Sheet({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.sheet, style]}>
      <View style={styles.sheetInner}>{children}</View>
    </View>
  );
}

/* ---------------------------------------------------------------- kartlar */

export function Card({
  children, title, action, onAction, style, testID, padded = false, onLayout, lead,
  headRight,
}: {
  children?: React.ReactNode; title?: string; action?: string; onAction?: () => void;
  /** Başlığın sağına bir düğüm — küçük bir anahtar gibi. `action` yazıdır,
   *  bu ise bileşen; ikisi aynı anda verilmez. */
  headRight?: React.ReactNode;
  style?: StyleProp<ViewStyle>; testID?: string; padded?: boolean;
  /** Başlığın soluna küçük bir işaret (ör. `PulseDot`). */
  lead?: React.ReactNode;
  /** Kartın kaydırma alanı içindeki y konumu — bir bölüme atlamak için. */
  onLayout?: (y: number) => void;
}) {
  return (
    <View
      style={[styles.card, style]}
      testID={testID}
      onLayout={onLayout ? (e) => onLayout(e.nativeEvent.layout.y) : undefined}
    >
      {title ? (
        <View style={styles.cardHead}>
          <View style={styles.cardHeadLeft}>
            {lead ? <View style={{ marginRight: spacing.sm }}>{lead}</View> : null}
            <Text style={styles.cardTitle}>{title}</Text>
          </View>
          {headRight ?? (action ? (
            <Pressable onPress={onAction} hitSlop={10}>
              <Text style={styles.cardAction}>{action}</Text>
            </Pressable>
          ) : null)}
        </View>
      ) : null}
      <View style={padded ? [styles.cardBody, !title && styles.cardBodyTopless] : undefined}>
        {children}
      </View>
    </View>
  );
}

/** Kap içindeki tek satır. Sol yuva 40, ortada metin, sağda değer. */
export function Row({
  leading, title, subtitle, right, onPress, testID, chevron,
  minHeight = metrics.rowHeight,
}: {
  leading?: React.ReactNode; title?: React.ReactNode; subtitle?: React.ReactNode;
  right?: React.ReactNode; onPress?: () => void; testID?: string; minHeight?: number;
  /** Satırın bir yere GİTTİĞİNİ söyleyen ok. Dokunulabilir ama hiçbir yere
   *  gitmeyen satırlarda (onay, seçim) konmaz — orada ok yalan söyler. */
  chevron?: boolean;
}) {
  const body = (
    <View style={[styles.row, { minHeight }]}>
      {leading ? <View style={styles.rowLeading}>{leading}</View> : null}
      <View style={{ flex: 1 }}>
        {typeof title === "string" ? <Text style={styles.rowTitle}>{title}</Text> : title}
        {typeof subtitle === "string"
          ? <Text style={styles.rowSub}>{subtitle}</Text>
          : subtitle}
      </View>
      {right}
      {chevron ? (
        <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceTertiary}
                  style={{ marginLeft: spacing.sm }} />
      ) : null}
    </View>
  );
  return onPress
    ? <Pressable onPress={onPress} testID={testID} android_ripple={{ color: colors.divider }}>{body}</Pressable>
    : <View testID={testID}>{body}</View>;
}

/**
 * Satır arası saç teli. Varsayılan girinti metin başlangıcına denk gelir:
 * kenar boşluğu 16 + ikon yuvası 36 + boşluk 12 = 64.
 */
export function Divider({ inset = metrics.dividerInset }: { inset?: number }) {
  return <View style={[styles.divider, { marginLeft: inset }]} />;
}

/* ------------------------------------------------------------ ikon / avatar */

/** Dairesel renkli ikon kabı — referans finans uygulamalarındaki gibi. */
export function IconPill({
  name, color, tint, size = metrics.icon, mci = false,
}: { name: string; color: string; tint: string; size?: number; mci?: boolean }) {
  const Icon: any = mci ? MaterialCommunityIcons : Ionicons;
  return (
    <View style={[styles.iconPill, { width: size, height: size, borderRadius: size / 2, backgroundColor: tint }]}>
      <Icon name={name} size={Math.round(size * 0.46)} color={color} />
    </View>
  );
}

export function CategoryIcon({ category, size = metrics.icon }: { category: string; size?: number }) {
  const c = CATEGORY_ICONS[category] || CATEGORY_ICONS.diger;
  return <IconPill name={c.icon} color={c.color} tint={c.bg} size={size} mci />;
}

export function categoryLabel(key: string) {
  return CATEGORY_LABEL_TR[key] || CATEGORY_LABEL_TR.diger;
}

/**
 * Dokunulabilir kategori simgesi.
 *
 * Düz simge dekoratif görünüyordu — kimse dokunulabileceğini anlamadı.
 * Köşesindeki küçük kalem rozeti, profil fotoğrafındaki kamera rozetiyle
 * aynı işaret: "buraya dokun, değiştir".
 */
export function CategoryPicker({
  category, onPress, size = metrics.icon, testID,
}: { category: string; onPress: () => void; size?: number; testID?: string }) {
  return (
    <Pressable onPress={onPress} testID={testID} hitSlop={6}>
      <CategoryIcon category={category} size={size} />
      <View style={styles.editBadge}>
        <Ionicons name="pencil" size={9} color={colors.onDark} />
      </View>
    </Pressable>
  );
}

/** Dokunulabilir birim etiketi — kenarlıklı hap, düğüm gibi okunuyor. */
export function UnitPicker({
  unit, onPress, testID,
}: { unit: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} testID={testID} hitSlop={8} style={styles.unitPill}>
      <Text style={styles.unitPillTxt}>{unit.toLocaleUpperCase("tr-TR")}</Text>
      <Ionicons name="chevron-down" size={10} color={colors.accentDark} />
    </Pressable>
  );
}

export function Avatar({
  name, size = metrics.icon, avatarId, userId, photoVersion,
}: {
  name?: string; size?: number; avatarId?: number | null;
  userId?: string | null; photoVersion?: string | null;
}) {
  const preset = getAvatar(avatarId);
  const [token, setToken] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const wants = !!(userId && photoVersion);

  React.useEffect(() => {
    let alive = true;
    if (!wants) return;
    setFailed(false);
    require("./api").getToken().then((t: string | null) => { if (alive) setToken(t); });
    return () => { alive = false; };
  }, [wants, photoVersion]);

  const box = { width: size, height: size, borderRadius: size / 2 };

  if (wants && token && !failed) {
    return (
      <Image
        source={{
          uri: `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/users/${userId}/photo?v=${photoVersion}`,
          headers: { Authorization: `Bearer ${token}` },
        }}
        style={[styles.avatar, box, { backgroundColor: preset.color }]}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <View style={[styles.avatar, box, { backgroundColor: preset.color }]}>
      <Ionicons name={preset.icon as any} size={Math.floor(size * 0.5)} color="#fff" />
    </View>
  );
}

/**
 * Bir kez gösterilip kapatılan ipucu kartı.
 *
 * Görsel işaret (kenarlıklı hap, kalem rozeti) tek başına yetmedi — kimse
 * simgeye dokunulabileceğini fark etmedi. Yazıyla bir kez söylemek gerekiyor.
 * Kapatıldığı bilgisi cihazda kalıyor, bir daha çıkmıyor.
 */
export function HintCard({
  hintKey, children, testID,
}: { hintKey: string; children: React.ReactNode; testID?: string }) {
  const [shown, setShown] = React.useState(false);
  const storageKey = `hint:${hintKey}`;

  React.useEffect(() => {
    let alive = true;
    require("@react-native-async-storage/async-storage").default
      .getItem(storageKey)
      .then((v: string | null) => { if (alive && !v) setShown(true); })
      .catch(() => {});
    return () => { alive = false; };
  }, [storageKey]);

  if (!shown) return null;
  return (
    <View style={styles.hint} testID={testID}>
      <Ionicons name="bulb-outline" size={18} color={colors.onInfo} />
      <Text style={styles.hintTxt}>{children}</Text>
      <Pressable
        hitSlop={10}
        onPress={() => {
          setShown(false);
          require("@react-native-async-storage/async-storage").default
            .setItem(storageKey, "1").catch(() => {});
        }}
        testID={testID ? `${testID}-dismiss` : undefined}
      >
        <Ionicons name="close" size={18} color={colors.onInfo} />
      </Pressable>
    </View>
  );
}

/**
 * Seçim satırı + alttan açılan liste.
 *
 * İki seçenek için iki düğme yeterliydi ama liste büyüyecek (yeni ülkeler,
 * yeni para birimleri). Yan yana düğme üçten sonra taşıyor; liste büyüdükçe
 * ekranı yeniden tasarlamamak için baştan açılır liste.
 */
export type SelectOption<T extends string> = {
  value: T;
  label: string;
  /** Solda duran kısa işaret: bayrak ya da para birimi simgesi. */
  mark?: string;
  hint?: string;
  /** Ionicons adı — `mark` yerine simge istendiğinde (ör. aktif dönem ⚡). */
  icon?: string;
  /** Simgeyi vurgulu renkte çizer. */
  iconAccent?: boolean;
  /** Henüz gelmedi — listede görünür ama seçilemez. */
  soon?: boolean;
  /** Simge yerine bir kişinin avatarı — kişi süzgecinde her satır kendi
   *  yüzünü taşısın diye. `avatarlar` verilirse (ör. "Herkes") üçü yığın
   *  hâlinde çizilir. */
  avatar?: { name?: string; avatarId?: number | null; userId?: string | null; photoVersion?: string | null };
  avatarlar?: { name?: string; avatarId?: number | null; userId?: string | null; photoVersion?: string | null }[];
};

/** Üst üste binen avatarlar — "Herkes" seçeneğinin yüzü.
 *  `ring` bindirmenin arkasındaki halka: koyu başlıkta `dark`, beyaz
 *  sayfada `surface` — yoksa avatarlar birbirine yapışık görünür. */
function AvatarYigin({
  kisiler, size = 20, ring = colors.dark,
}: {
  kisiler: NonNullable<SelectOption<string>["avatarlar"]>;
  size?: number; ring?: string;
}) {
  const gorunen = kisiler.slice(0, 3);
  const bindirme = Math.round(size * 0.38);
  return (
    <View style={{ flexDirection: "row", width: size + (gorunen.length - 1) * (size - bindirme) }}>
      {gorunen.map((k, i) => (
        <View key={k.userId || i}
              style={{ marginLeft: i === 0 ? 0 : -bindirme,
                       borderRadius: size, borderWidth: 1.5, borderColor: ring }}>
          <Avatar name={k.name} size={size} avatarId={k.avatarId}
                  userId={k.userId} photoVersion={k.photoVersion} />
        </View>
      ))}
    </View>
  );
}

/**
 * Koyu başlığın altında, beyaz yüzeyin kavisinin hemen üstünde duran seçici hap.
 *
 * Süzgeç *içerik* değil **bağlam**: "neye bakıyorum" sorusunun parçası, tıpkı
 * başlık ve toplamlar gibi. Beyaz yüzeye kart olarak konunca içerikle aynı
 * ağırlığa giriyor ve ekran dikdörtgen kart yığınına dönüyordu. Yatay çip
 * şeridi de çalışmıyordu: altı kişilik bir evde isimler, iki yıllık kullanımda
 * ~24 dönem şeridin dışına taşıyor.
 *
 * Renk `darkSurface` — başlıktaki yuvarlak düğmelerle aynı, yani yeni bir
 * görsel dil eklenmiyor.
 */
export function HeaderPills({ children }: { children: React.ReactNode }) {
  return <View style={styles.pillRow}>{children}</View>;
}

/**
 * KALDIRILABİLİR süzgeç hapı — seçilmiyor, yalnızca kaldırılıyor.
 *
 * `HeaderPill`'den ayrı bir bileşen çünkü sorduğu soru farklı. O bir
 * seçicidir ("hangi ay?"), bu bir DURUM bildirir ("şu an süzülüyorsun") ve
 * tek eylemi süzgeci kaldırmaktır — açılacak bir listesi yok.
 *
 * Görünür olması şart. Kasa'dan "Ağustos'ta sana düşen 98,32"ye dokunup
 * gelen biri, hapı görmezse ekrandaki listeyi ayın TAMAMI sanır ve iki sayı
 * tutmadığı için uygulamanın yanlış hesapladığını düşünür.
 *
 * Çarpı sağda ve hapın kendisi düğme: küçük bir simgeyi ayrı hedef yapmak
 * başparmak için isabetsiz, üstelik hapın başka bir işi yok.
 */
export function HeaderClearPill({
  label, onClear, testID,
}: { label: string; onClear: () => void; testID?: string }) {
  return (
    <Pressable style={[styles.pill, styles.pillAktif]} onPress={onClear} testID={testID}>
      <Text style={styles.pillTxt} numberOfLines={1}>{label}</Text>
      <Ionicons name="close" size={13} color={colors.onDark} />
    </Pressable>
  );
}

export function HeaderPill<T extends string>({
  value, options, onSelect, testID,
}: {
  value: T;
  options: SelectOption<T>[];
  onSelect: (v: T) => void;
  testID?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <Pressable style={styles.pill} onPress={() => setOpen(true)} testID={testID}>
        {current?.avatarlar?.length ? (
          <AvatarYigin kisiler={current.avatarlar} size={17} />
        ) : current?.avatar ? (
          <Avatar name={current.avatar.name} size={17} avatarId={current.avatar.avatarId}
                  userId={current.avatar.userId} photoVersion={current.avatar.photoVersion} />
        ) : current?.icon ? (
          <Ionicons
            name={current.icon as any} size={13}
            color={current.iconAccent ? colors.accentOnDark : colors.onDarkMuted}
          />
        ) : null}
        <Text style={styles.pillTxt} numberOfLines={1}>{current?.label ?? value}</Text>
        <Ionicons name="chevron-down" size={12} color={colors.onDarkMuted} />
      </Pressable>

      <BottomSheet visible={open} onClose={() => setOpen(false)}>
        {options.map((o, i) => (
          <React.Fragment key={o.value}>
            {i > 0 && <View style={[styles.divider, { marginLeft: spacing.lg }]} />}
            <Pressable
              style={styles.pickRow}
              onPress={() => { setOpen(false); if (o.value !== value) onSelect(o.value); }}
              testID={testID ? `${testID}-${o.value}` : undefined}
            >
              {o.avatarlar?.length ? (
                <View style={{ width: 30, alignItems: "center" }}>
                  <AvatarYigin kisiler={o.avatarlar} size={22} ring={colors.surface} />
                </View>
              ) : o.avatar ? (
                <Avatar name={o.avatar.name} size={26} avatarId={o.avatar.avatarId}
                        userId={o.avatar.userId} photoVersion={o.avatar.photoVersion} />
              ) : o.icon ? (
                <Ionicons
                  name={o.icon as any} size={17}
                  color={o.iconAccent ? colors.accent : colors.inkTertiary}
                  style={{ width: 22, textAlign: "center" }}
                />
              ) : null}
              <View style={{ flex: 1 }}>
                <Text style={styles.pickLabel}>{o.label}</Text>
                {o.hint ? <Text style={styles.pickHint}>{o.hint}</Text> : null}
              </View>
              {o.value === value ? (
                <Ionicons name="checkmark" size={20} color={colors.accent} />
              ) : null}
            </Pressable>
          </React.Fragment>
        ))}
      </BottomSheet>
    </>
  );
}

export function SelectRow<T extends string>({
  label, value, options, onSelect, locked, lockReason, testID,
}: {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onSelect: (v: T) => void;
  /** Kilitliyse kilit simgesi çıkar; dokununca sebebi söylenir. */
  locked?: boolean;
  lockReason?: string;
  testID?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <Pressable
        style={styles.selectRow}
        onPress={() => (locked
          ? Alert.alert(label, lockReason || "Bu ayar değiştirilemiyor.")
          : setOpen(true))}
        testID={testID}
      >
        {current?.mark ? <Text style={styles.selectMark}>{current.mark}</Text> : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.selectLabel}>{label}</Text>
          <Text style={[styles.selectValue, locked && { color: colors.inkSecondary }]}>
            {current?.label ?? value}
          </Text>
        </View>
        <Ionicons
          name={locked ? "lock-closed" : "chevron-down"}
          size={locked ? 16 : 18}
          color={colors.inkTertiary}
        />
      </Pressable>

      {/* Modal şart: alt sayfa kartın içinde `position: absolute` ile
          konumlanınca ekranı değil KARTI kaplıyor ve metinlerin üstüne
          yarı saydam biçimde biniyordu. React Native'de portal yok. */}
      <BottomSheet visible={open} onClose={() => setOpen(false)}>
            <Text style={styles.pickTitle}>{label}</Text>
            {options.map((o, i) => (
              <React.Fragment key={o.value}>
                {i > 0 && <View style={[styles.divider, { marginLeft: spacing.lg }]} />}
                <Pressable
                  style={[styles.pickRow, o.soon && { opacity: 0.4 }]}
                  disabled={o.soon}
                  onPress={() => { setOpen(false); if (o.value !== value) onSelect(o.value); }}
                  testID={testID ? `${testID}-${o.value}` : undefined}
                >
                  {o.mark ? <Text style={styles.pickMark}>{o.mark}</Text> : null}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickLabel}>{o.label}</Text>
                    {o.hint ? <Text style={styles.pickHint}>{o.hint}</Text> : null}
                  </View>
                  {o.soon
                    ? <Text style={styles.pickSoon}>yakında</Text>
                    : o.value === value
                      ? <Ionicons name="checkmark" size={20} color={colors.accent} />
                      : null}
                </Pressable>
              </React.Fragment>
            ))}
      </BottomSheet>
    </>
  );
}

/**
 * Dikkat çeken küçük nokta — ekran her odaklandığında birkaç kez atar.
 *
 * Sürekli yanıp sönmüyor, bilerek. Yanıp sönme bir kez işe yarar: günde on
 * kez açılan bir ekranda birkaç güne kalmadan duvar kâğıdına döner ve
 * görünmez olmadan önce sinir bozucu olur. Ayrıca hiç durmayan bir animasyon
 * Anasayfa'da pil harcar ve işletim sistemlerinin "hareketi azalt" ayarının
 * hedeflediği tam olarak budur.
 *
 * `trigger` her değiştiğinde yeniden atıyor; ekran odaklandığında artan bir
 * sayaç veriliyor, yani uygulamayı her açışta hatırlatma tekrarlanıyor.
 */
export function PulseDot({
  trigger = 0, size = 8, color = colors.attention, beats = 3, testID,
}: {
  trigger?: number; size?: number; color?: string; beats?: number; testID?: string;
}) {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    v.setValue(0);
    Animated.sequence(
      Array.from({ length: beats }, () =>
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: 260, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 320, useNativeDriver: true }),
        ])
      )
    ).start();
  }, [trigger, beats]);

  return (
    <View style={{ width: size, height: size }} testID={testID}>
      {/* Dışarı doğru açılan halka; nokta hep tam görünür kalıyor ki
          animasyon kapalıyken bile işaret yerinde dursun. */}
      <Animated.View
        style={{
          position: "absolute", width: size, height: size, borderRadius: size / 2,
          backgroundColor: color,
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0, 0.35] }),
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
        }}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

/**
 * Kategori dağılımı halkası. Dikdörtgen olmayan tek görsel öğe.
 *
 * Çap aynı, çizgi ince: kalın halka pasta grafiğe yaklaşıp ağırlaşıyordu.
 * İnce halka aynı bilgiyi taşıyıp ortadaki toplama yer açıyor.
 *
 * Anasayfa ve istatistik sayfası aynı bileşeni kullanıyor: iki ayrı çizim
 * olsaydı biri güncellenip öteki unutulurdu.
 */
export function Donut({
  parts, size = 108, stroke = 9, children,
}: {
  parts: { total: number; color: string }[];
  size?: number; stroke?: number; children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const sum = parts.reduce((s, p) => s + p.total, 0) || 1;
  let offset = 0;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        {/* Sessiz taban halkası: tek kategori varsa bile daire kapalı okunuyor. */}
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={colors.border} strokeWidth={stroke} />
        {parts.map((p, i) => {
          const len = (p.total / sum) * circ;
          const el = (
            <Circle
              key={i} cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={p.color} strokeWidth={stroke} strokeLinecap="butt"
              strokeDasharray={`${len} ${circ - len}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          );
          offset += len;
          return el;
        })}
      </Svg>
      {children}
    </View>
  );
}

/**
 * Alttan acilan sayfa -- elle asagi cekilerek kapatilir.
 *
 * Tepesindeki 36x4'luk tutamak once yalnizca bir SUSTU: tutulup cekilmiyordu.
 * Cekilmeyen bir tutamak, hic tutamak olmamasindan kotudur -- kullanici
 * deniyor, tepki gelmiyor, uygulama bozuk hissettiriyor.
 *
 * Butun paneller (kategori, birim, ulke, dil, bolusme, duzenli odeme, onay)
 * buradan geciyor; jest tek yerde durdugu icin hepsi ayni anda duzeldi.
 *
 * Kurallar:
 *  - Yalnizca ASAGI suruklenir; yukari cekmek sayfayi buyutmez.
 *  - Yariyi gecen ya da hizli birakilan surukleme kapatir, digeri geri oturur.
 *
 * ### Klavye
 *
 * Uc sey birlikte olmali, ikisi tek basina yarim kaliyor:
 *
 *  1. Sayfa BLOK halinde yukari kalkar (`marginBottom`), yukari dogru
 *     BUYUMEZ. Buyuseydi uzun bir formda baslik ekranin tepesine kacardi.
 *  2. Klavye acikken ALT koseler de yuvarlanir. Yukari kalktigi an sayfa
 *     ekrana yapisik degil, yuzen bir kart; koseli alt kenar ve altindan
 *     gorunen zemin onu "kopuk" gosteriyordu.
 *  3. Azami yukseklik klavyeye gore kisilir, boylece uzun form tasmak yerine
 *     kendi icinde kayar.
 */
export function BottomSheet({
  visible, onClose, children, maxHeight, testID,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxHeight?: number;
  testID?: string;
}) {
  /* Guvenli alan modalin ICINDEN OLCULMUYOR -- disaridan, kok saglayicidan
     okunup sayi olarak iceri veriliyor.

     Onceki uc deneme (modal icine kendi `SafeAreaProvider`i, `initialMetrics`,
     `SafeAreaView edges`) hep ayni seye dayaniyordu: modal penceresini olcmek.
     Olcum bir YARIS ve ust uste acilan ikinci sayfada kaybediliyordu -- ilk
     sayfa kapanirken ikincisi olculuyor, `insets.bottom` sifir donuyor,
     bir daha da duzelme firsati olmuyor cunku yeni bir yerlesim olayi gelmiyor.
     `initialWindowMetrics` de bu yarisi kapatmiyor: Android'de `null`
     olabiliyor ve `?? undefined` sessizce sifira dusuyordu.

     Kok saglayici ise uygulama acilirken bir kez olculmus ve dogru degeri
     tutuyor. Buradan okumak icin tek sart modal penceresinin kok pencereyle
     AYNI geometride olmasi -- `statusBarTranslucent` + `navigationBarTranslucent`
     tam olarak bunu yapiyor: dialog da kenardan kenara ciziliyor. */
  const insets = useSafeAreaInsets();
  return (
    /* `animationType="slide"` KULLANILMIYOR: o, pencerenin TAMAMINI
       kaydiriyordu -- karartma da dahil. Sonuc ekranda goruluyordu: karartma
       alttan yukari suzuluyor, kapanirken yukaridan asagi dusuyor ve bir
       titreme birakiyordu. Dogrusu karartmanin YERINDE durup sonumlenmesi,
       yalnizca sayfanin kaymasi. Ikisi de asagida elle yapiliyor. */
    <Modal
      visible={visible} transparent animationType="none" onRequestClose={onClose}
      statusBarTranslucent navigationBarTranslucent
    >
      {/* Modal'in ICERIGI kendi `GestureHandlerRootView`'una sariliyor.
          Zorunlu: RN `Modal` AYRI bir native agacta cizilir, yani uygulamanin
          kokundeki `GestureHandlerRootView`'un altinda DEGILDIR. Yeni mimaride
          (Fabric) modal icindeki dokunuslari RNGH yonetiyor ve bu sarmalayici
          olmadan icerideki hicbir jest calismiyor -- alt sayfa "tutuluyor ama
          hic tepki vermiyor" halindeydi, tam sebebi buydu. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SheetBody onClose={onClose} maxHeight={maxHeight} insets={insets} testID={testID}>
          {children}
        </SheetBody>
      </GestureHandlerRootView>
    </Modal>
  );
}

function SheetBody({
  onClose, children, maxHeight, insets, testID,
}: {
  onClose: () => void;
  children: React.ReactNode;
  maxHeight?: number;
  insets: EdgeInsets;
  testID?: string;
}) {
  const kb = useKeyboardHeight();
  const win = useWindowDimensions();
  /** Surukleme kaydirmasi. */
  const y = React.useRef(new Animated.Value(0)).current;
  /** Giris/cikis: 0 = kapali, 1 = acik. Karartmanin opakligi da bundan. */
  const giris = React.useRef(new Animated.Value(0)).current;
  const height = React.useRef(0);

  React.useEffect(() => {
    // Yay, dogrusal zamanlamadan daha dogal: sayfa "gelip yerine oturuyor".
    // `bounciness: 0` -- ziplama bir alt sayfada oyuncakli duruyor.
    Animated.spring(giris, {
      toValue: 1, useNativeDriver: true, bounciness: 0, speed: 14,
    }).start();
  }, [giris]);

  const kapat = React.useCallback(() => {
    Animated.timing(giris, {
      toValue: 0, duration: 180, useNativeDriver: true,
    }).start(() => { giris.setValue(0); y.setValue(0); onClose(); });
  }, [onClose, giris, y]);

  /**
   * Sürükleme jesti — **RNGH**, `PanResponder` DEĞİL.
   *
   * Önce `PanResponder` kullanılıyordu ve hiç çalışmıyordu: kullanıcı
   * tutamağı tutup çekiyor, sayfa kılını kıpırdatmıyordu. Sebebi ölçümle
   * bulundu — `onMoveShouldSetPanResponder` hiç ÇAĞRILMIYOR:
   *
   *   * uygulama yeni mimaride (`newArchEnabled: true`, Fabric),
   *   * RN `Modal` AYRI bir native ağaçta çiziliyor,
   *   * ve orada dokunuşları RNGH yönetiyor; içerideki düz `PanResponder`
   *     hiçbir zaman responder olamıyor.
   *
   * Aynı sebeple listedeki `Swipeable` sorunsuz çalışıyordu: o, kökteki
   * `GestureHandlerRootView`'un altında.
   *
   * `runOnJS(true)` şart: geri kalan animasyon RN `Animated` ile kurulu ve
   * `Animated.Value.setValue()` UI ipliğindeki bir worklet'ten çağrılamaz.
   * `activeOffsetY` / `failOffsetX` ise jestin sınırını çiziyor — yatay
   * hareket ve içerideki listelerin kendi kaydırması bize ait değil.
   */
  const surukle = React.useMemo(
    () => Gesture.Pan()
      .runOnJS(true)
      // Görünen tutamak ince; dokunma alanı buradan büyüyor.
      .hitSlop({ top: 12, bottom: 12 })
      .activeOffsetY(8)
      .failOffsetX([-24, 24])
      .onUpdate((e) => { if (e.translationY > 0) y.setValue(e.translationY); })
      .onEnd((e) => {
        // Yeterince çekildiyse kapan; yoksa yerine otur. Hız da sayılıyor:
        // kısa ama hızlı bir fiske de "kapat" demektir.
        const yeter = e.translationY > Math.max(height.current * 0.35, 90)
          || e.velocityY > 800;
        if (yeter) {
          Animated.timing(giris, {
            toValue: 0, duration: 160, useNativeDriver: true,
          }).start(() => { giris.setValue(0); y.setValue(0); onClose(); });
        } else {
          Animated.spring(y, {
            toValue: 0, useNativeDriver: true, bounciness: 0, speed: 18,
          }).start();
        }
      }),
    [y, giris, onClose],
  );

  // Klavye acikken sayfa yuzuyor: dort kosesi de yuvarlak ve kenarlardan
  // biraz iceride dursun ki "ekrana yapisik" degil "kart" okunsun.
  const yuzuyor = kb > 0;

  return (
    <View style={styles.sheetWrap}>
      {/* Karartma YERINDE durur, yalnizca sonumlenir. */}
      <Animated.View style={[styles.sheetScrim, { opacity: giris }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={kapat} testID="sheet-scrim" />
      </Animated.View>
      <Animated.View
        style={[
          styles.pickSheet,
          yuzuyor && styles.pickSheetFloating,
          {
            marginBottom: kb,
            maxHeight: maxHeight ?? (win.height - kb - insets.top - spacing.xxl),
            // Surukleme kaydirmasi + giris kaymasi birlikte.
            transform: [{
              translateY: Animated.add(
                y,
                giris.interpolate({ inputRange: [0, 1], outputRange: [560, 0] }),
              ),
            }],
          },
        ]}
        onLayout={(e) => { height.current = e.nativeEvent.layout.height; }}
        testID={testID}
      >
        {/* Surukleme yalnizca tutamak bolgesinden. Icerikten de surukleseydik
            sayfanin icindeki listelerin kendi kaydirmasiyla kavga ederdi. */}
        <GestureDetector gesture={surukle}>
          <View style={styles.grabZone}>
            <View style={styles.pickGrab} />
          </View>
        </GestureDetector>
        {/* Gezinme cubugu payi. Klavye acikken alt kenar zaten klavyenin
            uzerinde duruyor, orada pay eklemek bosluk birakirdi. */}
        <View style={{ paddingBottom: (yuzuyor ? 0 : insets.bottom) + spacing.lg }}>
          {children}
        </View>
      </Animated.View>
    </View>
  );
}

/**
 * Iki secenekli sekme seridi.
 *
 * **Kayan hap animasyonu denendi ve KALDIRILDI.** Animasyonun kendisi native
 * tarafta calisiyordu ama akici gorunmuyordu: sekmeye basmak ayni anda
 * sunucudan veri cekiyor ve butun liste yeniden ciziliyor, animasyon o yukle
 * yarisiyor. Kasan bir gecis, hic gecis olmamasindan kotudur.
 */
export function TabSwitch<T extends string>({
  value, options, onChange, onDark = false, testID,
}: {
  value: T;
  options: { value: T; label: string; icon?: string }[];
  onChange: (v: T) => void;
  /** Koyu basligin icinde kullaniliyorsa: renkler tersine doner. */
  onDark?: boolean;
  testID?: string;
}) {
  return (
    <View style={[styles.tabs, onDark && styles.tabsOnDark]} testID={testID}>
      {options.map((o) => {
        const on = o.value === value;
        // Secili hap `brand` zeminde duruyor -> yazi `onBrand`.
        // Koyu baslikta ise hap beyaz -> yazi koyu.
        const renk = onDark
          ? (on ? colors.dark : colors.onDarkMuted)
          : (on ? colors.onBrand : colors.inkSecondary);
        return (
          <Pressable
            key={o.value}
            style={[
              styles.tab,
              on && (onDark ? styles.tabOnDarkActive : styles.tabActive),
            ]}
            onPress={() => onChange(o.value)}
            testID={testID ? `${testID}-${o.value}` : undefined}
          >
            {o.icon ? (
              <Ionicons
                name={(on ? o.icon : `${o.icon}-outline`) as any}
                size={15} color={renk}
              />
            ) : null}
            <Text style={[styles.tabTxt, { color: renk }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* --------------------------------------------------------------- bölüşme */

export type Split = { mode: "equal" | "exact"; with: Record<string, number> };

export type SplitMember = { user_id: string; name: string };

/** Herkes eşit bölüşen liste — yeni harcamanın varsayılanı. */
export const splitAll = (members: SplitMember[]): Split => ({
  mode: "equal",
  with: Object.fromEntries(members.map((m) => [m.user_id, 1])),
});

/**
 * Kayıttan bölüşme listesini çıkarır — sunucudaki `split_of()`'un eşi.
 *
 * `split_with` alanı yazılmamış eski kayıtlar `target_type`'tan türetiliyor.
 * Tek yerde durması şart: rozet, düzenleme ekranı ve özet aynı cevabı
 * vermezse kullanıcı ekranlar arasında farklı bölüşüm görür.
 */
export function splitFromExpense(
  e: {
    added_by: string; total: number; target_type?: string; target_user_id?: string | null;
    split_mode?: string; split_with?: Record<string, number> | null;
  },
  members: SplitMember[],
): Split {
  if (e.split_with && Object.keys(e.split_with).length) {
    return { mode: e.split_mode === "exact" ? "exact" : "equal", with: { ...e.split_with } };
  }
  if (e.target_type === "roommate" && e.target_user_id) {
    return { mode: "exact", with: { [e.target_user_id]: Number(e.total) } };
  }
  if (e.target_type === "self") {
    return { mode: "exact", with: { [e.added_by]: Number(e.total) } };
  }
  return splitAll(members);
}

/**
 * Harcama listelerindeki bölüşme rozeti.
 *
 * Üç ekran bunu ayrı ayrı hesaplıyordu ve üçü de yalnızca eski üç durumu
 * biliyordu; "seçili kişiler" hepsinde yanlış etikete düşüyordu.
 */
export function splitBadge(
  e: Parameters<typeof splitFromExpense>[0],
  members: SplitMember[],
  meId?: string,
  /** Başkasının dökümüne bakarken "Kendim" değil "Kendisi" doğru. */
  selfLabel = "Kendim",
): { txt: string; color: string; bg: string } {
  const split = splitFromExpense(e, members);
  const ids = Object.keys(split.with);
  if (ids.length === 1 && ids[0] === e.added_by)
    return { txt: selfLabel, color: colors.onWarning, bg: colors.warningSoft };
  if (ids.length === 1) {
    const who = members.find((m) => m.user_id === ids[0])?.name?.split(" ")[0] || "?";
    return { txt: `→ ${who}`, color: colors.onInfo, bg: colors.infoSoft };
  }
  if (ids.length === members.length && members.length > 0)
    // `colors.dark` DEĞİL: o bir ZEMİN rengi ve karanlık temada #0A1120'ye
    // düşüyor, yani `surfaceSecondary` (#1D232C) üstünde koyu-üstüne-koyu
    // oluyordu ve etiket okunmuyordu. `inkSecondary` iki temada da zeminden
    // uzak duruyor.
    return { txt: "Ev", color: colors.inkSecondary, bg: colors.surfaceSecondary };
  return { txt: splitSummary(split, members, meId), color: colors.accentDark, bg: colors.accentSoft };
}

const parseAmount = (s: string) => parseFloat((s || "").replace(",", ".")) || 0;
const showAmount = (n: number) => n.toFixed(2).replace(".", ",");

/** Bölüşme listesini tek satırda özetler: "Tüm ev", "Sen + Salih", "→ Ali". */
export function splitSummary(split: Split, members: SplitMember[], meId?: string): string {
  const ids = Object.keys(split.with || {});
  if (!ids.length) return "Seçilmedi";
  const suffix = split.mode === "exact" && ids.length > 1 ? " · kişiye özel" : "";
  if (ids.length === members.length && members.length > 0) return "Tüm ev" + suffix;
  if (ids.length === 1) {
    if (ids[0] === meId) return "Sadece ben";
    const who = members.find((m) => m.user_id === ids[0]);
    return `→ ${who?.name?.split(" ")[0] || "?"}`;
  }
  const names = ids.map((id) =>
    id === meId ? "Sen" : members.find((m) => m.user_id === id)?.name?.split(" ")[0] || "?"
  );
  // Üçten sonra isimler satıra sığmıyor ve okunmuyor; sayı daha bilgilendirici.
  return (names.length <= 3 ? names.join(" + ") : `${names.length} kişi`) + suffix;
}

/**
 * Kimlerin bölüştüğünü seçen alt sayfa.
 *
 * Beş durumun hepsi tek ekranda: herkes işaretli = ev, sadece ben = kişisel,
 * tek kişi = ona ait, bir kısmı = seçili kişiler, "Tutar gir" = kişiye özel.
 * İki aşamalı bir listeye bölünmedi çünkü fiş inceleme ekranında her kalem
 * için ayrı ayrı açılıyor — orada her fazladan dokunuş on beşle çarpılıyor.
 *
 * Seçim sayfa kapanana kadar yereldedir: yarım kalmış bir tutar girişi
 * (toplamı tutmayan bölüşüm) dışarıya sızmamalı.
 */
export function SplitPicker({
  label = "BÖLÜŞÜM", value, onChange, members, meId, total, allowExact = true, testID,
}: {
  label?: string;
  value: Split;
  onChange: (s: Split) => void;
  members: SplitMember[];
  meId?: string;
  total: number;
  /** Fiş kaleminde kapalı: kalemin fiyatı belli, sorulan tek şey kimler bölüşüyor. */
  allowExact?: boolean;
  testID?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<Split["mode"]>(value.mode);
  const [picked, setPicked] = React.useState<string[]>(Object.keys(value.with || {}));
  const [amounts, setAmounts] = React.useState<Record<string, string>>({});
  const [err, setErr] = React.useState<string | null>(null);

  const start = () => {
    const ids = Object.keys(value.with || {});
    setMode(value.mode);
    setPicked(ids);
    setAmounts(
      Object.fromEntries(
        members.map((m) => [
          m.user_id,
          value.mode === "exact" && value.with[m.user_id] != null
            ? showAmount(Number(value.with[m.user_id]))
            : ids.includes(m.user_id) && ids.length
              ? showAmount(total / ids.length)
              : "",
        ])
      )
    );
    setErr(null);
    setOpen(true);
  };

  const toggle = (id: string) => {
    setErr(null);
    setPicked((p) => {
      const next = p.includes(id) ? p.filter((x) => x !== id) : [...p, id];
      // Eşit bölüşmede kişi sayısı değişince önizlenen paylar da değişmeli.
      if (mode === "equal" && next.length) {
        setAmounts((a) =>
          Object.fromEntries(
            members.map((m) => [m.user_id, next.includes(m.user_id) ? showAmount(total / next.length) : ""])
          )
        );
      }
      return next;
    });
  };

  const switchMode = (m: Split["mode"]) => {
    setErr(null);
    setMode(m);
    if (m === "exact" && picked.length) {
      // Eşit paylarla doldur: çoğu kira bu rakamların yakınından başlıyor.
      setAmounts((a) =>
        Object.fromEntries(
          members.map((mem) => [
            mem.user_id,
            picked.includes(mem.user_id) ? (a[mem.user_id] || showAmount(total / picked.length)) : "",
          ])
        )
      );
    }
  };

  const entered = picked.reduce((s, id) => s + parseAmount(amounts[id]), 0);
  const remaining = Math.round((total - entered) * 100) / 100;

  const hepsiSecili = picked.length === members.length && members.length > 0;
  const benSecili = picked.length === 1 && picked[0] === meId;
  /**
   * Kisayol etkinken kisi kutulari BOS durur.
   *
   * Once liste kisayolu birebir yansitiyordu: "Tum ev" secince ucu de
   * isaretli geliyordu ve "yalniz Salih" demek icin ikisini tek tek
   * kaldirmak gerekiyordu. Oysa kullanici ikisini AYRI arac olarak
   * kullaniyor -- biri kisayol, oteki elle secim. Artik listeye ilk dokunus
   * kisayolu birakip yalnizca o kisiyi seciyor.
   */
  const kisayolAktif = hepsiSecili || benSecili;

  /**
   * Varis noktasi secimi. `allowExact` kapaliysa (fis kalemi) sayfa kapanir --
   * orada baska bir secenek yok, onay istemek bos bir dokunus olurdu.
   */
  const hedefSec = (ids: string[]) => {
    setErr(null);
    setPicked(ids);
    if (mode === "equal" && ids.length) {
      setAmounts(Object.fromEntries(members.map((m) => [
        m.user_id, ids.includes(m.user_id) ? showAmount(total / ids.length) : "",
      ])));
    }
    if (!allowExact && ids.length) {
      onChange({ mode: "equal", with: Object.fromEntries(ids.map((id) => [id, 1])) });
      setOpen(false);
    }
  };

  const confirm = () => {
    if (!picked.length) { setErr("En az bir kişi seçin"); return; }
    if (mode === "exact") {
      if (Math.abs(remaining) > 0.01) {
        setErr(`Tutarların toplamı ${showAmount(total)} olmalı · ${showAmount(Math.abs(remaining))} ${remaining > 0 ? "eksik" : "fazla"}`);
        return;
      }
      onChange({ mode: "exact", with: Object.fromEntries(picked.map((id) => [id, parseAmount(amounts[id])])) });
    } else {
      onChange({ mode: "equal", with: Object.fromEntries(picked.map((id) => [id, 1])) });
    }
    setOpen(false);
  };

  return (
    <>
      <Pressable style={styles.selectRow} onPress={start} testID={testID}>
        <View style={{ flex: 1 }}>
          <Text style={styles.selectLabel}>{label}</Text>
          <Text style={styles.selectValue}>{splitSummary(value, members, meId)}</Text>
        </View>
        <Ionicons name="chevron-down" size={18} color={colors.inkTertiary} />
      </Pressable>

      <BottomSheet visible={open} onClose={() => setOpen(false)}>
            <View style={styles.splitHead}>
              <Text style={overline}>KİMLER BÖLÜŞÜYOR?</Text>
              <Text style={styles.splitTotal}>{formatEUR(total)}</Text>
            </View>

            {/* En sik iki durum artik birer VARIS NOKTASI, listeyi degistiren
                cip degil. Onceden "sadece ben" demek uc dokunustu (ac - cip -
                Tamam) ve fiste 15 kalem varsa bu 45 dokunus ediyordu.

                Fis inceleme ekraninda (`allowExact=false`) dokunmak sayfayi
                KAPATIYOR: orada verilecek karar tek. Elle giriste kapanmiyor,
                cunku 1200 EUR kirayi 350/400/450 diye bolmek icin once "Tum
                ev" secilip sonra "Tutar gir"e gecmek gerekiyor -- kapansa o
                yol kalmazdi. Kural keyfi degil: SECENEK VARSA ONAY VAR. */}
            <Pressable
              style={[styles.destRow, hepsiSecili && styles.destRowOn]}
              onPress={() => hedefSec(members.map((m) => m.user_id))}
              testID={testID ? `${testID}-quick-all` : undefined}
            >
              <View style={[styles.destIcon, hepsiSecili && styles.destIconOn]}>
                <Ionicons name="home" size={17} color={hepsiSecili ? colors.onBrand : colors.inkSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.destTitle}>Tüm ev</Text>
                <Text style={[styles.destSub, hepsiSecili && { color: colors.accentDark }]}>
                  {members.length} kişi · {formatEUR(total / Math.max(members.length, 1))} kişi başı
                </Text>
              </View>
              {hepsiSecili && <Ionicons name="checkmark" size={20} color={colors.accentDark} />}
            </Pressable>

            <View style={[styles.divider, { marginLeft: spacing.lg }]} />

            <Pressable
              style={[styles.destRow, benSecili && styles.destRowOn]}
              onPress={() => hedefSec(meId ? [meId] : [])}
              testID={testID ? `${testID}-quick-me` : undefined}
            >
              <View style={[styles.destIcon, benSecili && styles.destIconOn]}>
                <Ionicons name="person" size={17} color={benSecili ? colors.onBrand : colors.inkSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.destTitle}>Sadece ben</Text>
                <Text style={[styles.destSub, benSecili && { color: colors.accentDark }]}>
                  Kimse görmez
                </Text>
              </View>
              {benSecili && <Ionicons name="checkmark" size={20} color={colors.accentDark} />}
            </Pressable>

            {/* "Hicbiri" bir DURUM degil bir ARAC -- ev sahibi de onu zaten
                "temizle" diye kullaniyordu. Digerleriyle ayni boyda durmasi
                yaniltiyordu; basligin yanina kucuk bir yaziya indi. */}
            <View style={styles.kisilerHead}>
              {/* "Ya da" kasitli: kisayollarla listenin AYRI oldugunu, denemeden
                  once soyluyor. Bos kutucuklar da ayni seyi gosteriyor ama
                  yazi onu bir kesinlige baglıyor. */}
              <Text style={overline}>YA DA KİŞİ SEÇ</Text>
              {!kisayolAktif && picked.length > 0 && (
                <Pressable onPress={() => { setErr(null); setPicked([]); }} hitSlop={10}
                           testID={testID ? `${testID}-quick-none` : undefined}>
                  <Text style={styles.temizle}>Temizle</Text>
                </Pressable>
              )}
            </View>

            {allowExact && (
              <View style={styles.segment}>
                {(["equal", "exact"] as const).map((m) => (
                  <Pressable
                    key={m}
                    style={[styles.segBtn, mode === m && styles.segBtnOn]}
                    onPress={() => switchMode(m)}
                    testID={testID ? `${testID}-mode-${m}` : undefined}
                  >
                    <Text style={[styles.segTxt, mode === m && styles.segTxtOn]}>
                      {m === "equal" ? "Eşit" : "Tutar gir"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            {members.map((m, i) => {
              const on = !kisayolAktif && picked.includes(m.user_id);
              return (
                <React.Fragment key={m.user_id}>
                  {i > 0 && <View style={[styles.divider, { marginLeft: spacing.lg }]} />}
                  <Pressable
                    style={styles.pickRow}
                    onPress={() => {
                      // Kisayoldan geliniyorsa liste sifirdan baslar: tek
                      // dokunusla "yalniz bu kisi".
                      if (kisayolAktif) { setErr(null); setPicked([m.user_id]); return; }
                      toggle(m.user_id);
                    }}
                    testID={testID ? `${testID}-member-${m.user_id}` : undefined}
                  >
                    <Ionicons
                      name={on ? "checkbox" : "square-outline"}
                      size={22}
                      color={on ? colors.accent : colors.inkTertiary}
                    />
                    <Text style={[styles.pickLabel, { flex: 1 }, !on && { color: colors.inkTertiary }]}>
                      {m.name}{m.user_id === meId ? " (sen)" : ""}
                    </Text>
                    {!on ? (
                      <Text style={styles.splitShare}>—</Text>
                    ) : mode === "exact" ? (
                      <TextInput
                        style={styles.splitInput}
                        value={amounts[m.user_id] ?? ""}
                        onChangeText={(t) => {
                          setErr(null);
                          setAmounts((a) => ({ ...a, [m.user_id]: t.replace(/[^\d.,]/g, "") }));
                        }}
                        keyboardType="decimal-pad"
                        placeholder="0,00"
                        placeholderTextColor={colors.inkTertiary}
                        testID={testID ? `${testID}-amount-${m.user_id}` : undefined}
                      />
                    ) : (
                      <Text style={styles.splitShare}>{formatEUR(total / Math.max(picked.length, 1))}</Text>
                    )}
                  </Pressable>
                </React.Fragment>
              );
            })}

            <View style={[styles.splitFoot, err ? styles.splitFootErr : null]}>
              {/* Kisayol etkinken sayiyi tekrarlamiyoruz: "Tum ev" satirinda
                  zaten "3 kisi" yaziyor. */}
              <Text style={[styles.splitFootTxt, err ? styles.splitFootTxtErr : null]}>
                {err || (kisayolAktif ? "" : `${picked.length} kişi bölüşüyor`)}
              </Text>
              {!err && mode === "exact" && (
                <Text style={[styles.splitFootTxt, Math.abs(remaining) > 0.01 && styles.splitFootTxtErr]}>
                  kalan {showAmount(remaining)}
                </Text>
              )}
            </View>

            <Pressable style={styles.splitOk} onPress={confirm} testID={testID ? `${testID}-ok` : undefined}>
              <Text style={styles.splitOkTxt}>Tamam</Text>
            </Pressable>
      </BottomSheet>
    </>
  );
}

/* --------------------------------------------------------------- rozetler */

export function Tag({
  label, tint, color, style,
}: { label: string; tint: string; color: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.tag, { backgroundColor: tint }, style]}>
      <Text style={[styles.tagTxt, { color }]}>{label}</Text>
    </View>
  );
}

export function MerchantBadge({ name }: { name?: string | null }) {
  if (!name) return null;
  const { bg, fg } = merchantTint(name);
  return (
    <View style={[styles.merchant, { backgroundColor: bg }]}>
      <Text style={[styles.merchantTxt, { color: fg }]} numberOfLines={1}>
        {name.toUpperCase()}
      </Text>
    </View>
  );
}

export function Chip({
  label, active, onPress, testID, icon,
}: { label: string; active?: boolean; onPress?: () => void; testID?: string; icon?: any }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]} testID={testID}>
      {icon && (
        <Ionicons name={icon} size={14} color={active ? colors.onBrand : colors.inkSecondary}
                  style={{ marginRight: 5 }} />
      )}
      <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{label}</Text>
    </Pressable>
  );
}

export function PrimaryButton({
  label, onPress, disabled, testID, style, icon, tone,
}: {
  label: string; onPress?: () => void; disabled?: boolean; testID?: string;
  style?: StyleProp<ViewStyle>; icon?: any;
  /**
   * `muted`: boyut aynı, ağırlık düşük.
   *
   * "Devre dışı" DEĞİL — basılabilir. Amaç engellemek değil, ciddi ve geri
   * alınması zor bir eylemin doğru anı gelmeden davetkâr görünmemesi.
   */
  tone?: "muted";
}) {
  const kisik = tone === "muted";
  const fg = kisik ? colors.inkSecondary : colors.onBrand;
  return (
    <Pressable onPress={onPress} disabled={disabled}
               style={[styles.primary, kisik && styles.primaryMuted,
                       disabled && { opacity: 0.5 }, style]} testID={testID}>
      {icon && <Ionicons name={icon} size={18} color={fg} style={{ marginRight: 8 }} />}
      <Text style={[styles.primaryTxt, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------- biçimleyici */

/**
 * Türkçe biçim: binlik "." , kuruş ",". Rakam ile para birimi arasındaki
 * boşluk bölünmez (U+00A0) — normal boşluk olduğunda dar bir satırda sembol
 * tek başına alt satıra düşüyordu. İşaret ile rakam arası da aynı sebeple.
 */
const NBSP = "\u00A0";

/**
 * Ekranda gösterilen para birimi.
 *
 * Modül düzeyinde bir değişken, çünkü `formatEUR` yüzlerce yerde bağlam
 * almadan çağrılıyor; her çağrı yerine ev nesnesini taşımak uygulamanın
 * yarısını dolaşmak demekti. Ev yüklendiğinde bir kez yazılıyor.
 * Dönüşüm yok — bir ev tek para birimi kullanır, biz yalnızca sembol seçeriz.
 */
let currencySymbol = "\u20AC";
export const setCurrency = (code?: string | null) => {
  currencySymbol = code === "TRY" ? "\u20BA" : "\u20AC";
};

/** Yalnizca simge \u2014 tutar alanini elle dizen yerler icin (\u00F6r. \u00F6deme sayfas\u0131). */
export const currencySign = () => currencySymbol;

export function formatEUR(n: number | null | undefined, sign = false) {
  if (n === null || n === undefined || isNaN(n as number)) return `0,00${NBSP}${currencySymbol}`;
  const v = Number(n);
  const abs = Math.abs(v);
  const [int, dec] = abs.toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const prefix = sign ? (v >= 0 ? `+${NBSP}` : `\u2212${NBSP}`) : (v < 0 ? "\u2212" : "");
  return `${prefix}${grouped},${dec}${NBSP}${currencySymbol}`;
}

export const UNITS = ["adet", "kg", "lt", "paket"] as const;
export type Unit = (typeof UNITS)[number];
export const nextUnit = (u?: string): Unit =>
  UNITS[(UNITS.indexOf((u as Unit) || "adet") + 1) % UNITS.length];

/**
 * Miktar + birim. Tartılan ürünlerde fişte "0,590 kg" yazıyor; birim
 * taşınmadığı için bu "590 adet" olarak görünüyordu.
 */
export function formatQty(quantity?: number | null, unit?: string | null) {
  const q = quantity ?? 1;
  const u = (unit as Unit) || "adet";
  // Kilo ve litre ondalıklı, adet tam sayı okunur.
  const n = u === "kg" || u === "lt"
    ? q.toFixed(q < 1 || q % 1 ? 3 : 0).replace(".", ",").replace(/,?0+$/, "")
    : String(Math.round(q * 100) / 100).replace(".", ",");
  return `${n} ${u}`;
}

/** Dar yerlerde kuruşu düşürür: "1.240,00 €" -> "1.240 €". */
export function formatEURShort(n: number | null | undefined) {
  return formatEUR(n).replace(`,00${NBSP}€`, `${NBSP}€`);
}

export function formatDateTR(iso?: string | null) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return !y || !m || !d ? iso : `${d}.${m}.${y}`;
}

/* ------------------------------------------------------------------- aylar */
/* Görüntülemenin her yeri takvim ayı olduğu için ay adı iki ekranda birden
   geçiyor; tek yerde duruyor. Bulunma hâli tablodan geliyor, ünlü uyumu
   kuralla üretilemiyor: Ağustos'*ta* ama Eylül'*de*, Nisan'*da*. */
const AYLAR = ["", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
               "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const AYLAR_DE = ["", "Ocak'ta", "Şubat'ta", "Mart'ta", "Nisan'da", "Mayıs'ta",
                  "Haziran'da", "Temmuz'da", "Ağustos'ta", "Eylül'de", "Ekim'de",
                  "Kasım'da", "Aralık'ta"];

const ayNo = (m: string) => parseInt((m || "").slice(5, 7), 10) || 0;

/** `2026-08` → `Ağustos 2026` */
export function ayAdi(m: string) {
  return `${AYLAR[ayNo(m)] || ""} ${(m || "").slice(0, 4)}`.trim();
}

/** `2026-08` → `AĞUSTOS'TA` — başlık üstü etiketi için. */
export function ayDe(m: string) {
  return (AYLAR_DE[ayNo(m)] || "").toLocaleUpperCase("tr-TR");
}

/** `2026-08` — içinde bulunulan ay. */
export function buAy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Seçilebilir aylar: bu aydan geriye, evin KURULDUĞU aya kadar.
 *
 * Dönem çiplerinin yerini aldı. Görüntülemenin her yeri takvim ayı;
 * Harcamalar ile üye dökümünün penceresi aynı listeden gelmek zorunda.
 *
 * `baslangic` (evin `created_at`'i) verilirse liste orada duruyor: evin var
 * olmadığı bir aya bakmak "kayıt yok" demekten başka bir şey söylemiyor ve
 * seçiciyi boş aylarla uzatıyordu. Verilmezse son 12 ay — güvenli bir tavan.
 */
export function sonAylar(...sinirlar: (string | null | undefined)[]): string[] {
  const d = new Date();
  // Verilen sınırların (ev kuruluşu, en eski harcama) EN ERKENİ. Geriye
  // tarihli fiş created_at'ten önceye düşebiliyor; o ay gizlenmemeli.
  const altlar = sinirlar.map((x) => (x || "").slice(0, 7)).filter(Boolean);
  const alt = altlar.length ? altlar.sort()[0] : "";
  const out: string[] = [];
  for (let i = 0; i < 60; i++) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const key = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
    out.push(key);
    // Sınıra inince dur. Tavan 60 ay: sınır yoksa ya da gelecekteyse liste
    // sonsuza gitmesin.
    if (alt && key <= alt) break;
    if (!alt && out.length >= 12) break;
  }
  return out;
}

/**
 * Değişim metni: "%12 fazla" · "2,5 katı".
 *
 * Yüzde %200'ü aşınca okunurluğunu yitiriyor — "%340 artış" kimsenin
 * kafasında bir şeye karşılık gelmiyor, "3,4 katı" geliyor.
 */
export function degisimTxt(pct: number) {
  const abs = Math.abs(pct);
  if (abs >= 200) return `${(1 + abs / 100).toFixed(1).replace(".", ",")} katı`;
  return `%${abs} ${pct >= 0 ? "fazla" : "az"}`;
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ stiller */

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    // paddingBottom boya göre veriliyor (HEADER_PAD) — yüzey buraya biner.
  },
  headerInner: { width: "100%", maxWidth: CONTENT_MAX_WIDTH, alignSelf: "center" },
  headerTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  headerTopGap: { marginBottom: spacing.lg },
  headerOverline: { ...overline, color: colors.onDarkMuted },
  headerTitle: { ...T.screen, color: colors.onDark },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start" },
  split: { flexDirection: "row", alignItems: "center", marginTop: spacing.lg },
  splitLine: { width: 1, height: 34, backgroundColor: "rgba(255,255,255,0.14)", marginRight: spacing.lg },
  splitLabel: { ...T.caption, color: colors.onDarkMuted },
  splitValue: { ...T.emph, color: colors.onDark, marginTop: 1 },
  /* Üç sütunda ölçü küçülüyor ve harf aralığı sıkışıyor: aynı genişlikte
     iki hane daha sığıyor, okunurluk gözle fark edilecek kadar düşmüyor. */
  splitValueSik: { fontSize: 15, lineHeight: 20, letterSpacing: -0.3 },
  trend: {
    flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start",
    backgroundColor: "rgba(16,185,129,0.18)", paddingHorizontal: spacing.md,
    paddingVertical: 5, borderRadius: radius.pill, marginTop: spacing.md,
  },
  trendTxt: { ...T.captionSb, color: colors.accentOnDark },
  trendSep: { width: StyleSheet.hairlineWidth, height: 12, backgroundColor: colors.accentOnDark, opacity: 0.4, marginHorizontal: 2 },
  sheet: {
    flex: 1, backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    marginTop: -spacing.xl, paddingTop: spacing.lg,
  },
  // Zemin tam genişlikte kalır (kenardan kenara tasarım ögesi), yalnızca
  // içindekiler ortalanır.
  sheetInner: { width: "100%", maxWidth: CONTENT_MAX_WIDTH, alignSelf: "center", flex: 1 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, overflow: "hidden",
  },
  // `paddingTop: 0` cunku normalde ustunde `cardHead` durur. Baslik yoksa
  // o dolgu hic gelmiyordu ve ilk satir kartin kenarina yapisiyordu.
  cardBody: { padding: spacing.lg, paddingTop: 0 },
  cardBodyTopless: { paddingTop: spacing.lg },
  cardHeadLeft: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
  cardHead: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    // Başlık ile veri arası bilerek geniş: başlık listeye yapışınca ikisi tek
    // blok gibi okunuyor, ayrılınca başlık gerçekten başlık oluyor.
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md + 2,
  },
  cardTitle: { ...T.title, color: colors.ink },
  cardAction: { ...T.captionSb, color: colors.accent },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  rowLeading: { width: metrics.leading, alignItems: "center" },
  rowTitle: { ...T.bodySb, color: colors.ink },
  rowSub: { ...T.caption, color: colors.inkTertiary, marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider },
  money: { ...T.emph, color: colors.ink, fontVariant: ["tabular-nums"], flexShrink: 0 },
  iconPill: { alignItems: "center", justifyContent: "center" },
  editBadge: {
    position: "absolute", right: -3, bottom: -3,
    width: 16, height: 16, borderRadius: 8, backgroundColor: colors.dark,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: colors.surface,
  },
  unitPill: {
    flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start",
    paddingHorizontal: 7, height: 20, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentSoft,
  },
  unitPillTxt: {
    fontSize: 10, lineHeight: 13, fontFamily: fontFamily.semibold,
    letterSpacing: 0.5, color: colors.accentDark,
  },
  hint: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.infoSoft, borderRadius: radius.md, padding: spacing.md,
  },
  hintTxt: { ...T.caption, color: colors.onInfo, flex: 1, lineHeight: 18 },
  selectRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: metrics.rowHeight,
  },
  // Renk ACIKCA veriliyor: verilmeyince varsayilan siyah geliyor ve
  // karanlik temada € isareti kayboluyordu.
  selectMark: {
    fontSize: 22, lineHeight: 28, width: 30, textAlign: "center", color: colors.ink,
  },
  // Koyu basligin altinda, kavisin hemen ustunde duran secici seridi.
  /* Çubuklar: sabit yükseklikli bir şerit, altında ay adı.
     `alignItems: flex-end` çubukları tabana oturtuyor; ortalama çizgisi de
     aynı tabandan ölçülüyor. */
  /* Çubuklar SOLA DAYALI ve genişlikleri KAPAKLI.
     `flex: 1` ile esnetildiğinde iki aylık bir evde çubuklar kütük gibi
     oluyordu. Kapak, iki aylık evle altı aylık evin çubuklarını aynı
     kalınlıkta tutuyor; sağda kalan boşluk zamanla doluyor ve grafiğin
     kendisi "biriktikçe dolacak" diyor — dolgu metni gerekmiyor. */
  cubukSatir: {
    flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-start",
    height: 100, position: "relative", marginBottom: spacing.md,
  },
  ortCizgi: {
    position: "absolute", left: 0, height: 1,
    borderTopWidth: 1, borderTopColor: colors.borderStrong,
    borderStyle: "dashed", opacity: 0.8,
  },
  cubukKap: { alignItems: "center" },
  cubuk: { width: "100%", borderRadius: 3 },
  cubukTutar: { ...T.caption, fontSize: 9, color: colors.inkTertiary, marginBottom: 3 },
  cubukTutarBu: { color: colors.ink, fontFamily: fontFamily.semibold },
  cubukAy: { ...T.caption, fontSize: 9, color: colors.inkTertiary, marginTop: 4 },
  cubukAyBu: { color: colors.ink, fontFamily: fontFamily.semibold },
  ortSatir: {
    flexDirection: "row", alignItems: "center",
    paddingTop: spacing.md, paddingHorizontal: 0,
  },
  ortLabel: { ...T.caption, color: colors.inkTertiary, flex: 1 },
  ikonAnahtar: {
    flexDirection: "row", backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill, padding: 2, gap: 2,
  },
  ikonBtn: {
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: radius.pill,
  },
  ikonBtnSecili: { backgroundColor: colors.surface },
  pillRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg, flexWrap: "wrap" },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1,
    backgroundColor: colors.darkSurface, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 6,
  },
  /* Etkin süzgeç yeşil çerçeveli: yanındaki seçici haplarla aynı kutu, ama
     "bu şu an bir şey yapıyor" diyen tek işaret. Dolgu değil çerçeve —
     dolgu, lacivert başlıktaki tek koyu düğme kuralını bozardı. */
  pillAktif: { borderWidth: 1, borderColor: colors.accentOnDark },
  pillTxt: { ...T.captionSb, color: colors.onDark, flexShrink: 1 },
  selectLabel: { ...T.caption, color: colors.inkTertiary },
  selectValue: { ...T.bodySb, color: colors.ink, marginTop: 1 },
  sheetWrap: { ...StyleSheet.absoluteFillObject, justifyContent: "flex-end" },
  sheetScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(12,22,38,0.45)" },
  pickSheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl, paddingTop: spacing.lg,
    width: "100%", maxWidth: CONTENT_MAX_WIDTH, alignSelf: "center",
  },
  pickSheetFloating: {
    borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl,
    marginHorizontal: spacing.sm,
  },
  pickGrab: {
    width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong,
    alignSelf: "center",
  },
  /* TUTAMAK ALANI — sayfanın sürüklenebildiğini söyleyen tek yer.
     Önce 12 pikseldi (`paddingTop: 8` + `paddingBottom: 4`) ve jest kodda
     çalıştığı hâlde ev sahibi "tutup çekemiyorum" dedi: yakalanacak yer
     yoktu. Başparmağın isabet ettiği en küçük hedef ~44 piksel, o yüzden
     tutamak 5 piksel çizilip çevresindeki boşlukla birlikte 44'e çıkarıldı.
     Çubuk da 36→44 genişledi; ince bir çizgi "tutulacak şey" demiyor.

     İçerikten sürüklemek bilerek YAPILMIYOR: sayfanın içindeki listelerin
     kendi kaydırmasıyla kavga ediyor ve hangi jestin kazandığı öngörülemez
     oluyor. Tutamak sözleşmedir — nereden tutulacağını söyler. */
  /* GÖRÜNEN alan ince, DOKUNULAN alan büyük.
     Önce ikisi aynıydı: hedefi 44 piksele çıkarmak için dolgu büyütülünce
     çubuğun üstünde kaba bir boşluk kaldı. Artık dolgu 10+10 (çubukla
     birlikte ~25 piksel) ve hedef `hitSlop` ile yukarı-aşağı 12'şer piksel
     genişliyor — parmak için ~49, göz için 25. */
  grabZone: { paddingTop: 10, paddingBottom: 10 },
  tabs: {
    flexDirection: "row", backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill, padding: 3,
  },
  tabsOnDark: { backgroundColor: "rgba(255,255,255,0.10)", padding: 4 },
  tab: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: spacing.sm, borderRadius: radius.pill,
  },
  // Secili hap ZEMINI. `ink` (murekkep) DEGIL: o bir on plan rengi ve
  // karanlik temada acik oluyor -- zemin de yazi da acik kaliyordu.
  tabActive: { backgroundColor: colors.brand },
  tabOnDarkActive: { backgroundColor: colors.onDark },
  tabTxt: { ...T.captionSb },
  pickTitle: { ...overline, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  pickMark: { fontSize: 24, lineHeight: 30, width: 34, textAlign: "center" },
  pickSoon: { ...T.caption, color: colors.inkTertiary },
  pickRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, minHeight: 56,
  },
  pickLabel: { ...T.emph, color: colors.ink },
  pickHint: { ...T.caption, color: colors.inkTertiary, marginTop: 1 },
  splitHead: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, marginBottom: spacing.md,
  },
  splitTotal: { ...T.bodySb, color: colors.ink },
  // En sik iki durum: cip degil, kendi ikonu ve alt satiri olan birer SATIR.
  destRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 58,
  },
  destRowOn: { backgroundColor: colors.accentSoft },
  destIcon: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  destIconOn: { backgroundColor: colors.accent },
  destTitle: { ...T.body, color: colors.ink },
  destSub: { ...T.caption, color: colors.inkTertiary, marginTop: 1 },
  kisilerHead: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.xs,
  },
  temizle: { ...T.caption, color: colors.inkTertiary },
  segment: {
    flexDirection: "row", gap: spacing.xs, marginHorizontal: spacing.lg,
    marginBottom: spacing.sm, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill, padding: 3,
  },
  segBtn: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.pill },
  segBtnOn: { backgroundColor: colors.brand },
  segTxt: { ...T.captionSb, color: colors.inkSecondary },
  segTxtOn: { color: colors.onBrand },
  splitShare: { ...T.captionSb, color: colors.inkSecondary, minWidth: 74, textAlign: "right" },
  splitInput: {
    minWidth: 88, textAlign: "right", paddingHorizontal: spacing.sm, paddingVertical: 6,
    borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary,
    fontSize: 15, fontFamily: fontFamily.semibold, color: colors.ink,
  },
  splitFoot: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: colors.accentSoft, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2, marginTop: spacing.sm,
  },
  splitFootErr: { backgroundColor: colors.negativeSoft },
  splitFootTxt: { ...T.captionSb, color: colors.accentDark },
  splitFootTxtErr: { color: colors.negative },
  splitOk: {
    marginHorizontal: spacing.lg, marginTop: spacing.md, minHeight: 50,
    borderRadius: radius.pill, backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  splitOkTxt: { ...T.emph, color: colors.onBrand },
  avatar: { alignItems: "center", justifyContent: "center" },
  tag: { paddingHorizontal: spacing.sm + 2, paddingVertical: 3, borderRadius: radius.pill, alignSelf: "flex-start" },
  tagTxt: { fontSize: 11, lineHeight: 14, fontFamily: fontFamily.medium },
  merchant: { alignSelf: "flex-start", paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm },
  // Renk `merchantTint` ile satir icinde veriliyor; buradaki sabit renk
  // pastel zeminde okunmuyordu.
  merchantTxt: { fontSize: 10, lineHeight: 13, fontFamily: fontFamily.semibold, letterSpacing: 0.4 },
  chip: {
    flexDirection: "row", alignItems: "center", height: 38, paddingHorizontal: spacing.lg,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, flexShrink: 0,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipTxt: { ...T.bodySb, color: colors.inkSecondary },
  chipTxtActive: { color: colors.onBrand },
  primary: {
    backgroundColor: colors.brand, borderRadius: radius.pill, minHeight: 54,
    alignItems: "center", justifyContent: "center", flexDirection: "row",
    paddingHorizontal: spacing.xl,
  },
  primaryMuted: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong,
  },
  primaryTxt: { ...T.emph, color: colors.onBrand },
});
