import { useRef, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { apiPost } from "@/src/api";
import { setQueue, clearQueue } from "@/src/pendingReviews";
import { colors, spacing, radius, type as T, fontFamily } from "@/src/theme";

export default function Tara() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [processing, setProcessing] = useState(false);
  const [progressTxt, setProgressTxt] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const cam = useRef<CameraView>(null);

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
      for (let i = 0; i < base64Images.length; i++) {
        setProgressTxt(`Fiş ${i + 1} / ${base64Images.length} okunuyor…`);
        try {
          const res = await apiPost("/ocr/receipt", { image_base64: base64Images[i] });
          payloads.push(JSON.stringify(res));
        } catch (e: any) {
          console.log(`OCR failed for image ${i}`, e);
        }
      }
      if (payloads.length === 0) { setError("Hiçbir fiş okunamadı."); return; }
      const [first, ...rest] = payloads;
      setQueue(rest);
      router.push({
        pathname: "/review",
        params: { payload: first, batchTotal: String(payloads.length), batchIndex: "1" },
      });
    } finally { setProcessing(false); setProgressTxt(""); }
  };

  const takePhoto = async () => {
    if (!cam.current) return;
    try {
      const shot = await cam.current.takePictureAsync({ base64: true, quality: 0.6 });
      if (shot?.base64) await sendToOCR(shot.base64);
    } catch (e: any) { setError(e.message || "Fotoğraf çekilemedi"); }
  };

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setError("Galeri izni verilmedi"); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      base64: true, quality: 0.6,
      allowsMultipleSelection: true,
      selectionLimit: 8,
    });
    if (res.canceled) return;
    const b64s = (res.assets || []).map((a) => a.base64).filter(Boolean) as string[];
    await sendBatchToOCR(b64s);
  };

  if (!permission) return <View style={styles.root}><ActivityIndicator color={colors.onDark} /></View>;

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.rootLight} edges={["top", "bottom"]} testID="camera-permission">
        <View style={styles.permCenter}>
          <View style={styles.permIconWrap}>
            <Ionicons name="camera-outline" size={40} color={colors.dark} />
          </View>
          <Text style={styles.permTitle}>Kamera izni gerekli</Text>
          <Text style={styles.permDesc}>Fişleri taramak için kameraya erişim izni ver. İstemezsen galeriden de seçebilirsin.</Text>
          <Pressable style={styles.permBtn} onPress={requestPermission} testID="grant-camera-permission">
            <Text style={styles.permBtnTxt}>İzin ver</Text>
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

      {processing && (
        <View style={styles.processing} testID="ocr-processing">
          <ActivityIndicator size="large" color={colors.onDark} />
          <Text style={styles.processingTxt}>{progressTxt || "Fatura okunuyor…"}</Text>
          <Text style={styles.processingSub}>Almanca fiş desteği ile</Text>
        </View>
      )}
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
          <View style={styles.multiBadge}><Text style={styles.multiBadgeTxt}>×N</Text></View>
        </Pressable>
        <Pressable style={styles.shutter} onPress={takePhoto} disabled={processing} testID="shutter-btn">
          <View style={styles.shutterInner}>
            <Ionicons name="camera" size={28} color={colors.dark} />
          </View>
        </Pressable>
        <Pressable style={styles.sideBtn} onPress={() => router.push("/manual")} testID="manual-from-camera">
          <Ionicons name="create-outline" size={24} color={colors.onDark} style={styles.glyph} />
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

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
    ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(15,27,51,0.88)",
    alignItems: "center", justifyContent: "center", gap: spacing.md,
  },
  processingTxt: { ...T.emph, color: colors.onDark },
  processingSub: { ...T.caption, color: colors.accentOnDark },
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
