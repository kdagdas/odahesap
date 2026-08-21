import { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView,
  Animated, useWindowDimensions, Platform, Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import { apiPost } from "@/src/api";
import { setQueue, clearQueue } from "@/src/pendingReviews";
import { shrinkReceiptToBase64 } from "@/src/photo";
import { colors, spacing, radius, type as T, fontFamily } from "@/src/theme";

/**
 * Fis okunurken gosterilen tarama katmani.
 *
 * OCR 10-20 saniye suruyor ve bu suslemenin degil BILGININ isi: donen bir
 * cember "calisiyor" der ama ne kadar kaldigini ya da ne yapildigini
 * soylemez. Yazilar sirayla degisince bekleme kisalmiyor ama BELIRSIZ
 * olmaktan cikiyor -- insanlarin tahammul edemedigi sey sure degil belirsizlik.
 *
 * Yazilar gercek is sirasini anlatiyor ve ilerlemeyi UYDURMUYOR: bir yuzde
 * cubugu koysaydik sayilari uydurmak zorunda kalirdik, cunku model bize ara
 * durum bildirmiyor.
 */
function ScanOverlay({ note }: { note?: string }) {
  const AKIS = [
    "Fiş okunuyor",
    "Ürünler tanınıyor",
    "Fiyatlar çıkarılıyor",
    "Adet ve birimler alınıyor",
    "Kategorilere ayrılıyor",
    "Neredeyse bitti",
  ];
  const [adim, setAdim] = useState(0);
  const { height: h } = useWindowDimensions();
  const line = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Son yazida duruyor: donup basa sarmak "takildi" hissi veriyordu.
    const t = setInterval(() => setAdim((a) => Math.min(a + 1, AKIS.length - 1)), 2600);
    const dongu = Animated.loop(
      Animated.sequence([
        Animated.timing(line, { toValue: 1, duration: 1500, useNativeDriver: true }),
        Animated.timing(line, { toValue: 0, duration: 1500, useNativeDriver: true }),
      ])
    );
    dongu.start();
    return () => { clearInterval(t); dongu.stop(); };
  }, []);

  return (
    <View style={styles.processing} testID="ocr-processing">
      {/* Kendi cercevemi cizmiyorum: kameradaki rehber cercevesi zaten orada
          ve ustune ikinci bir kutu koymak "hangisi?" sorusunu doguruyordu.
          Cizgi tum ekranda gidip geliyor, arkasi seffaf. */}
      <Animated.View
        style={[styles.scanLine, {
          transform: [{
            translateY: line.interpolate({ inputRange: [0, 1], outputRange: [0, h || 600] }),
          }],
        }]}
      />
      {/* Yazilar ekranin ORTASINDA: onceden dikey akista asagi kayip kamera
          dugmesinin altinda kaliyordu. */}
      <View style={styles.scanCenter}>
        <Text style={styles.processingTxt}>{note || AKIS[adim]}</Text>
        <View style={styles.dots}>
          {AKIS.map((_, i) => (
            <View key={i} style={[styles.dot, i <= adim && styles.dotOn]} />
          ))}
        </View>
      </View>
    </View>
  );
}


export default function Tara() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [processing, setProcessing] = useState(false);
  const [progressTxt, setProgressTxt] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const cam = useRef<CameraView>(null);

  /* İZİN EKRANA GİRİNCE SORULUYOR — düğmeye basmayı beklemeden.
     Bu sekmenin tek işi kamera; buraya gelmek zaten "fiş tarayacağım" demek.
     Açıklama ekranı diyaloğun ARKASINDA duruyor, yani reddeden kişi neden
     istendiğini yine okuyor ve tekrar deneyebiliyor.

     Uygulama açılışı başına BİR KEZ (`useRef`): sekmeler ayakta kaldığı için
     her odaklanmada sormak, Kasa↔Fiş arasında gidip gelen birine dakikada
     dört diyalog gösterirdi.

     Android iki hak veriyor; ikinci retten sonra `canAskAgain` false oluyor
     ve `requestPermission()` SESSİZCE hiçbir şey yapmıyor -- düğme ölü
     kalıyordu. O durumda tek yol sistem ayarları, aşağıda ona geçiliyor. */
  const izinSoruldu = useRef(false);
  useEffect(() => {
    if (!permission || permission.granted || !permission.canAskAgain) return;
    if (izinSoruldu.current) return;
    izinSoruldu.current = true;
    requestPermission();
  }, [permission, requestPermission]);

  const sendToOCR = async (base64: string) => {
    setProcessing(true); setError(null);
    clearQueue();
    try {
      const res = await apiPost("/ocr/receipt", { image_base64: base64 });
      router.push({ pathname: "/review", params: { payload: JSON.stringify(res) } });
    } catch (e: any) { setError(e.message || "Fiş okunamadı. Manuel olarak eklemeyi deneyin."); }
    finally { setProcessing(false); setProgressTxt(""); }
  };

  const sendBatchToOCR = async (base64Images: string[]) => {
    if (base64Images.length === 0) return;
    if (base64Images.length === 1) return sendToOCR(base64Images[0]);
    setProcessing(true); setError(null);
    clearQueue();
    const payloads: string[] = [];
    try {
      const hatalar: string[] = [];
      for (let i = 0; i < base64Images.length; i++) {
        setProgressTxt(`Fiş ${i + 1} / ${base64Images.length}`);
        try {
          const res = await apiPost("/ocr/receipt", { image_base64: base64Images[i] });
          payloads.push(JSON.stringify(res));
        } catch (e: any) {
          // Sessizce yutulurdu: kullanici iki fis secip bir tane gorunce
          // sebebini bilemiyordu. En sik sebep Gemini ucretsiz katmaninin
          // dakikalik kotasi (429) ve bunu SOYLEMEK gerekiyor.
          hatalar.push(`${i + 1}. fiş: ${e?.message || "okunamadı"}`);
        }
      }
      if (payloads.length === 0) {
        setError(hatalar.join("\n") || "Hiçbir fiş okunamadı.");
        return;
      }
      if (hatalar.length) setError(hatalar.join("\n"));
      const [first, ...rest] = payloads;
      setQueue(rest);
      router.push({
        pathname: "/review",
        params: { payload: first, batchTotal: String(payloads.length), batchIndex: "1" },
      });
    } finally { setProcessing(false); setProgressTxt(""); }
  };

  /**
   * Çekilen fişi telefonun galerisine kaydeder.
   *
   * Fiş görüntüsünü sunucuda saklamıyoruz — 512 MB'lık ücretsiz alanı
   * birkaç bin fiş doldurur. Ama "bu 40 € neydi" tartışmasında fişin
   * durması değerli, o yüzden kullanıcının kendi galerisine bırakıyoruz.
   * İzin verilmezse sessizce geçiyoruz: tarama asıl iş, kaydetme ikramiye.
   */
  const saveToGallery = async (uri?: string) => {
    if (!uri) return;
    try {
      /* ANDROID 13+ : HİÇBİR İZİN İSTENMİYOR, çünkü gerekmiyor.
         `expo-media-library`nin kendi kaynağında yazılı: `hasWritePermissions()`
         TIRAMISU ve üstünde sabit `false` dönüyor, yani `saveToLibraryAsync`
         izin aramıyor; kayıt `MediaStore.insert` ile yapılıyor ve kapsamlı
         depolamada uygulamanın kendi eklediği dosya için izin gerekmiyor.

         Eskiden burada `requestPermissionsAsync()` çağrılıyordu — parametresiz,
         yani OKUMA izni (`READ_MEDIA_IMAGES`). İki ayrı zarar veriyordu:

         1. Android 14+ bunu üç seçenekli soruyor ve "Sınırlı izin ver"
            denince sistem kullanıcıyı FOTO SEÇİCİYE götürüyor. Kamerayla fiş
            tarayan biri, tarama biter bitmez kendini galeride buluyordu.
         2. Kalıcı reddedilince (`USER_FIXED`) fişler SESSİZCE galeriye
            kaydedilmez oldu. Cihazda ölçüldü: son kaydedilen kopya 15 Ağustos.
            Hata yok, kayıt da yok — bu projenin tekrar eden "hata vermeyen
            hata" sınıfı.

         Android 12 ve altında kaydetmek `WRITE_EXTERNAL_STORAGE` istiyor ve o
         izin `app.json` içinde bilerek engelli. Orada kaydetme yapılmıyor:
         kaydetme ikramiye, tarama asıl iş. */
      if (Platform.OS === "android") {
        if (Number(Platform.Version) >= 33) await MediaLibrary.saveToLibraryAsync(uri);
        return;
      }
      // iOS: yalnızca EKLEME izni. `writeOnly` "Yalnızca fotoğraf ekle"
      // diyaloğunu açıyor -- kütüphaneyi okuma izni istemiyor.
      const perm = await MediaLibrary.getPermissionsAsync(true);
      const granted = perm.granted
        ? true
        : (await MediaLibrary.requestPermissionsAsync(true)).granted;
      if (granted) await MediaLibrary.saveToLibraryAsync(uri);
    } catch (e) { console.log("galeriye kaydedilemedi", e); }
  };

  const takePhoto = async () => {
    if (!cam.current) return;
    try {
      // `base64: true` ARTIK ISTENMIYOR: tam cozunurlukte base64 uretmek
      // telefonda 3 MB'lik bir dizge kurmak demekti ve bu is ag hic
      // baslamadan once yapiliyordu. Once dosya aliniyor, galeriye TAM
      // cozunurlukte kaydediliyor, sunucuya giden kopya kucultuluyor.
      const shot = await cam.current.takePictureAsync({ quality: 1 });
      await saveToGallery(shot?.uri);
      if (!shot?.uri) return;
      const b64 = await shrinkReceiptToBase64(shot.uri, shot.width, shot.height);
      if (b64) await sendToOCR(b64);
    } catch (e: any) { setError(e.message || "Fotoğraf çekilemedi"); }
  };

  const pickImage = async () => {
    /* İZİN KAPISI KALDIRILDI — olmayan bir kapıya kilit takılmıştı.
       `ImagePickerModule.kt` içinde `launchImageLibraryAsync` hiçbir izin
       kontrolü yapmıyor: sistemin foto seçicisini (`PickVisualMedia`) açıyor
       ve o seçici izinsiz çalışıyor, zaten amacı bu — kullanıcı ne seçerse
       yalnızca onu veriyor.

       Kapının bedeli somuttu: `READ_MEDIA_IMAGES` kalıcı reddedilmiş bir
       cihazda "Galeriden seç" düğmesi hiçbir şey yapmıyor, yalnızca "Galeri
       izni verilmedi" yazıyordu. Kullanıcı izni geri açsa bile bu ekrana
       gelmesinin sebebi zaten kamerayı istememesiydi. */
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
      allowsMultipleSelection: true,
      selectionLimit: COKLU_SECIM_SINIRI,
    });
    if (res.canceled) return;
    // Sirayla kucultuluyor: sekiz fisin base64'unu ayni anda bellekte tutmak
    // zayif telefonlarda uygulamayi dusurur.
    const b64s: string[] = [];
    for (const a of res.assets || []) {
      if (!a.uri) continue;
      const b64 = await shrinkReceiptToBase64(a.uri, a.width, a.height);
      if (b64) b64s.push(b64);
    }
    await sendBatchToOCR(b64s);
  };

  if (!permission) return <View style={styles.root}><ActivityIndicator color={colors.onDark} /></View>;

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.rootLight} edges={["top", "bottom"]} testID="camera-permission">
        <View style={styles.permCenter}>
          <View style={styles.permIconWrap}>
            <Ionicons name="camera-outline" size={40} color={colors.ink} />
          </View>
          <Text style={styles.permTitle}>Kamera izni gerekli</Text>
          <Text style={styles.permDesc}>
            {permission.canAskAgain
              ? "Fişleri taramak için kameraya erişim izni ver. İstemezsen galeriden de seçebilirsin."
              : "Kamera izni kapalı. Android bunu bir daha soramıyor; ayarlardan açman gerekiyor. İstemezsen galeriden de seçebilirsin."}
          </Text>
          {/* Aynı düğme, iki farklı iş. `canAskAgain` false iken
              `requestPermission()` sessizce hiçbir şey yapmıyordu: kullanıcı
              basıyor, ekran değişmiyor, uygulama bozuk görünüyordu. */}
          <Pressable style={styles.permBtn} testID="grant-camera-permission"
                     onPress={() => {
                       if (permission.canAskAgain) requestPermission();
                       else Linking.openSettings();
                     }}>
            <Text style={styles.permBtnTxt}>
              {permission.canAskAgain ? "İzin ver" : "Ayarları aç"}
            </Text>
          </Pressable>
          <Pressable style={styles.altBtn} onPress={pickImage} testID="pick-image-fallback">
            <Ionicons name="images-outline" size={18} color={colors.accentDark} />
            <Text style={styles.altBtnTxt}>Galeriden seç</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root} testID="tara-screen">
      <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" />

      <View style={styles.frame} pointerEvents="none">
        <View style={styles.frameBox}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
        <View style={styles.frameHint}>
          <Ionicons name="scan-outline" size={16} color={colors.onDark} />
          <Text style={styles.frameHintTxt}>Fişi çerçeveye yerleştir</Text>
        </View>
      </View>

      {processing && <ScanOverlay note={progressTxt || undefined} />}
      {error && (
        <ScrollView style={styles.errorWrap} contentContainerStyle={styles.errorInner}>
          <Text style={styles.errorTxt} testID="ocr-error">{error}</Text>
        </ScrollView>
      )}

      {/* Fiş dikey ve uzun; önizlemeyi bir bant ile kesmek yerine her denetim
          kendi okunurluğunu taşıyor: koyu yarı saydam daire (tanımlı bir şekil,
          leke değil) + glif gölgesi. Böylece parlak bir fişin üstünde de
          beyaz ikonlar seçiliyor ve kamera tam boy kalıyor. */}
      <SafeAreaView style={styles.controls} edges={["bottom"]}>
        <Pressable style={styles.sideBtn} onPress={pickImage} testID="open-gallery-btn">
          <Ionicons name="images-outline" size={24} color={colors.onDark} style={styles.glyph} />
          {/* Rozet "birden fazla seçebilirsin" diyor. Önce burada düz metin
              olarak `×N` yazılıydı: doldurulmamış bir şablon, ekranda cebir
              gibi duruyordu ve hiçbir şey öğretmiyordu. Sayının kendisi hem
              aynı işi görüyor hem sınırı söylüyor. */}
          <View style={styles.multiBadge}>
            <Text style={styles.multiBadgeTxt}>×{COKLU_SECIM_SINIRI}</Text>
          </View>
        </Pressable>
        <Pressable style={styles.shutter} onPress={takePhoto} disabled={processing} testID="shutter-btn">
          <View style={styles.shutterInner}>
            <Ionicons name="camera" size={28} color={colors.ink} />
          </View>
        </Pressable>
        <Pressable style={styles.sideBtn} onPress={() => router.push("/manual")} testID="manual-from-camera">
          <Ionicons name="create-outline" size={24} color={colors.onDark} style={styles.glyph} />
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

/**
 * Galeriden bir seferde kaç fiş seçilebilir.
 *
 * Rozet ile `selectionLimit` AYNI sabitten besleniyor. Ayrı yazılsalardı biri
 * değiştiğinde öteki yalan söylerdi — ve rozetin tek işi zaten bu sayıyı
 * söylemek.
 */
const COKLU_SECIM_SINIRI = 8;

const CORNER = 24;
// Shutter (84) + padding above and below. The guide frame reserves this much
// room at the bottom so the two never share space.
const CONTROLS_HEIGHT = 150;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  rootLight: { flex: 1, backgroundColor: colors.surface },
  // Centre the guide inside the space *above* the button row — centring it in
  // the whole screen pushed the lower corners down among the buttons.
  frame: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: CONTROLS_HEIGHT,
    paddingTop: spacing.xl,
    gap: spacing.lg,
  },
  frameBox: { width: "74%", aspectRatio: 0.62, position: "relative" },
  corner: { position: "absolute", width: CORNER, height: CORNER, borderColor: colors.onDark },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 12 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 12 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 12 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 12 },
  // Sits under the box in normal flow now, so it can never land on the buttons.
  frameHint: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill,
  },
  frameHintTxt: { ...T.bodySb, color: colors.onDark },
  processing: {
    ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(15,27,51,0.82)",
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  processingTxt: { ...T.emph, color: colors.onDark },
  scanLine: {
    position: "absolute", left: 0, right: 0, top: 0, height: 2,
    backgroundColor: colors.accentOnDark,
  },
  scanCenter: { alignItems: "center", gap: spacing.md },
  dots: { flexDirection: "row", gap: 6 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.25)" },
  dotOn: { backgroundColor: colors.accentOnDark },
  errorWrap: { position: "absolute", top: 60, left: 16, right: 16 },
  errorInner: { backgroundColor: colors.negative, padding: spacing.md, borderRadius: radius.md },
  errorTxt: { ...T.bodySb, color: colors.onDark, textAlign: "center" },
  controls: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    flexDirection: "row", alignItems: "center", justifyContent: "space-around",
    paddingHorizontal: spacing.xl, paddingBottom: spacing.md, paddingTop: spacing.lg,
  },
  sideBtn: {
    width: 52, height: 52, borderRadius: 26,
    // Beyaz yerine koyu: parlak bir fişin üstünde beyaz halka kayboluyor,
    // koyu halka her zeminde buton olarak okunuyor.
    backgroundColor: "rgba(15,27,51,0.55)",
    borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.35)",
    alignItems: "center", justifyContent: "center",
  },
  // Ionicons bir metin glifi olduğu için gölge stilleri ona uygulanabiliyor.
  glyph: { textShadowColor: "rgba(0,0,0,0.65)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 },
  multiBadge: {
    position: "absolute", top: -6, right: -6, backgroundColor: colors.accent,
    borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 2, minWidth: 22, alignItems: "center",
  },
  multiBadgeTxt: { color: colors.onDark, fontSize: 10, lineHeight: 14, fontFamily: fontFamily.bold },
  shutter: {
    width: 84, height: 84, borderRadius: 42, borderWidth: 4, borderColor: colors.onDark,
    alignItems: "center", justifyContent: "center", padding: 4,
    // Beyaz halka beyaz fişin üstünde eriyordu.
    shadowColor: colors.black, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5, shadowRadius: 8, elevation: 8,
  },
  shutterInner: {
    flex: 1, alignSelf: "stretch", borderRadius: 36, backgroundColor: colors.onDark,
    alignItems: "center", justifyContent: "center",
  },
  permCenter: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  permIconWrap: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.sm,
  },
  permTitle: { ...T.title, color: colors.ink },
  permDesc: { ...T.body, color: colors.inkSecondary, textAlign: "center", marginBottom: spacing.md },
  permBtn: {
    backgroundColor: colors.brand, paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md, borderRadius: radius.pill, minHeight: 52,
    alignItems: "center", justifyContent: "center",
  },
  permBtnTxt: { ...T.emph, color: colors.onBrand },
  altBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  altBtnTxt: { ...T.bodySb, color: colors.accentDark },
});
