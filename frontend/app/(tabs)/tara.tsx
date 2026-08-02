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
import { colors, spacing, radius, font } from "@/src/theme";

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

  if (!permission) return <View style={styles.root}><ActivityIndicator color={colors.brand} /></View>;

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.rootLight} edges={["top", "bottom"]} testID="camera-permission">
        <View style={styles.permCenter}>
          <View style={styles.permIconWrap}>
            <Ionicons name="camera-outline" size={44} color={colors.brand} />
          </View>
          <Text style={styles.permTitle}>Kamera izni gerekli</Text>
          <Text style={styles.permDesc}>Fişleri taramak için kameraya erişim izni ver. İstemezsen galeriden de seçebilirsin.</Text>
          <Pressable style={styles.permBtn} onPress={requestPermission} testID="grant-camera-permission">
            <Text style={styles.permBtnTxt}>İzin ver</Text>
          </Pressable>
          <Pressable style={styles.altBtn} onPress={pickImage} testID="pick-image-fallback">
            <Ionicons name="images-outline" size={18} color={colors.brand} />
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
          <Ionicons name="scan-outline" size={16} color="#fff" />
          <Text style={styles.frameHintTxt}>Fişi çerçeveye yerleştir</Text>
        </View>
      </View>

      {processing && (
        <View style={styles.processing} testID="ocr-processing">
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.processingTxt}>{progressTxt || "Fatura okunuyor…"}</Text>
          <Text style={styles.processingSub}>Almanca fiş desteği ile</Text>
        </View>
      )}
      {error && (
        <ScrollView style={styles.errorWrap} contentContainerStyle={styles.errorInner}>
          <Text style={styles.errorTxt} testID="ocr-error">{error}</Text>
        </ScrollView>
      )}

      <SafeAreaView style={styles.controls} edges={["bottom"]}>
        <Pressable style={styles.sideBtn} onPress={pickImage} testID="open-gallery-btn">
          <Ionicons name="images-outline" size={24} color="#fff" />
          <View style={styles.multiBadge}><Text style={styles.multiBadgeTxt}>×N</Text></View>
        </Pressable>
        <Pressable style={styles.shutter} onPress={takePhoto} disabled={processing} testID="shutter-btn">
          <View style={styles.shutterInner}>
            <Ionicons name="camera" size={28} color="#fff" />
          </View>
        </Pressable>
        <Pressable style={styles.sideBtn} onPress={() => router.push("/manual")} testID="manual-from-camera">
          <Ionicons name="create-outline" size={24} color="#fff" />
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const CORNER = 24;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  rootLight: { flex: 1, backgroundColor: colors.surface },
  frame: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  frameBox: { width: "78%", aspectRatio: 0.55, position: "relative" },
  corner: { position: "absolute", width: CORNER, height: CORNER, borderColor: "#fff" },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 12 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 12 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 12 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 12 },
  frameHint: {
    position: "absolute", bottom: 160, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
  },
  frameHintTxt: { color: "#fff", fontSize: font.sizes.base, fontWeight: font.weights.semibold },
  processing: {
    ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(15,42,46,0.85)",
    alignItems: "center", justifyContent: "center", gap: spacing.md,
  },
  processingTxt: { color: "#fff", fontSize: font.sizes.lg, fontWeight: font.weights.semibold },
  processingSub: { color: colors.brandSoft, fontSize: font.sizes.base },
  errorWrap: { position: "absolute", top: 60, left: 16, right: 16 },
  errorInner: { backgroundColor: colors.error, padding: spacing.md, borderRadius: radius.md },
  errorTxt: { color: "#fff", fontWeight: font.weights.semibold, textAlign: "center" },
  controls: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    flexDirection: "row", alignItems: "center", justifyContent: "space-around",
    paddingHorizontal: spacing.xl, paddingBottom: spacing.md, paddingTop: spacing.lg,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sideBtn: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center", justifyContent: "center",
  },
  multiBadge: {
    position: "absolute", top: -6, right: -6, backgroundColor: colors.brand,
    borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 2, minWidth: 22, alignItems: "center",
  },
  multiBadgeTxt: { color: "#fff", fontSize: 10, fontWeight: font.weights.bold },
  shutter: {
    width: 84, height: 84, borderRadius: 42, borderWidth: 4, borderColor: "#fff",
    alignItems: "center", justifyContent: "center", padding: 4,
  },
  shutterInner: { flex: 1, alignSelf: "stretch", borderRadius: 36, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  permCenter: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  permIconWrap: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  permTitle: { fontSize: font.sizes.xl, fontWeight: font.weights.bold, color: colors.onSurface },
  permDesc: { fontSize: font.sizes.base, color: colors.onSurfaceSecondary, textAlign: "center", marginBottom: spacing.md, lineHeight: 20 },
  permBtn: { backgroundColor: colors.brand, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.pill, minHeight: 48 },
  permBtnTxt: { color: colors.onBrand, fontWeight: font.weights.semibold, fontSize: font.sizes.lg },
  altBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  altBtnTxt: { color: colors.brand, fontWeight: font.weights.semibold },
});
