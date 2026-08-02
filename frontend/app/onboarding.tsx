import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiPost } from "@/src/api";
import { useHousehold } from "@/src/household";
import { useAuth } from "@/src/auth";
import { colors, spacing, radius, font } from "@/src/theme";

type Mode = "menu" | "create" | "join";

export default function Onboarding() {
  const { user, logout } = useAuth();
  const { refresh, pendingHousehold } = useHousehold();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("menu");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already pending, show waiting state
  useEffect(() => {
    if (pendingHousehold) setMode("menu");
  }, [pendingHousehold]);

  // Auto-refresh every 6s while pending so approval shows quickly
  useEffect(() => {
    if (!pendingHousehold) return;
    const id = setInterval(() => { refresh(); }, 6000);
    return () => clearInterval(id);
  }, [pendingHousehold, refresh]);

  const onCreate = async () => {
    if (!name.trim()) { setError("Ev adı gerekli"); return; }
    setBusy(true); setError(null);
    try {
      await apiPost("/households", { name: name.trim() });
      await refresh();
      router.replace("/(tabs)/panel");
    } catch (e: any) { setError(e.message || "Bir hata oluştu"); }
    finally { setBusy(false); }
  };

  const onJoin = async () => {
    if (code.trim().length !== 6) { setError("6 haneli kod giriniz"); return; }
    setBusy(true); setError(null);
    try {
      await apiPost("/households/join", { invite_code: code.trim() });
      await refresh();
    } catch (e: any) { setError(e.message || "Katılım başarısız"); }
    finally { setBusy(false); }
  };

  if (pendingHousehold) {
    return (
      <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="pending-approval-screen">
        <View style={styles.pendingWrap}>
          <View style={styles.pendingIcon}>
            <Ionicons name="hourglass-outline" size={44} color={colors.brand} />
          </View>
          <Text style={styles.pendingTitle}>Onay bekleniyor…</Text>
          <Text style={styles.pendingDesc}>
            "<Text style={{ fontWeight: font.weights.bold }}>{pendingHousehold.name}</Text>" evine katılma isteğin gönderildi.
            Ev üyelerinden birinin onaylaması gerekiyor.
          </Text>
          <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.lg }} />
          <Pressable style={styles.pendingCancelBtn} onPress={async () => { await apiPost("/households/leave", {}); await refresh(); }} testID="cancel-pending-btn">
            <Text style={styles.pendingCancelTxt}>İsteği iptal et</Text>
          </Pressable>
          <Pressable style={styles.logout} onPress={logout} testID="onboarding-logout">
            <Text style={styles.logoutTxt}>Çıkış yap</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="onboarding-screen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.hi}>Merhaba, {user?.name?.split(" ")[0]}!</Text>
          <Text style={styles.title}>Ev seç veya oluştur</Text>
          <Text style={styles.subtitle}>Oda arkadaşlarınla harcamaları paylaşmak için bir ev bağla.</Text>

          {mode === "menu" && (
            <View style={styles.menu}>
              <Pressable style={styles.card} onPress={() => { setMode("create"); setError(null); }} testID="create-household-cta">
                <View style={[styles.cardIconWrap, { backgroundColor: colors.brandSoft }]}>
                  <Ionicons name="home" size={26} color={colors.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>Yeni ev oluştur</Text>
                  <Text style={styles.cardDesc}>Kendi evini kur, arkadaşlarını 6 haneli davet koduyla davet et.</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
              </Pressable>
              <Pressable style={styles.card} onPress={() => { setMode("join"); setError(null); }} testID="join-household-cta">
                <View style={[styles.cardIconWrap, { backgroundColor: "#DBEAFE" }]}>
                  <Ionicons name="key" size={24} color={colors.sky} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>Eve katıl</Text>
                  <Text style={styles.cardDesc}>Ev sahibinden aldığın 6 haneli davet kodunu gir.</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
              </Pressable>
            </View>
          )}

          {mode === "create" && (
            <View style={styles.form}>
              <Text style={styles.label}>Ev adı</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Örn. Berlin Öğrenci Evi"
                placeholderTextColor={colors.onSurfaceTertiary}
                testID="household-name-input"
              />
              {error && <Text style={styles.error}>{error}</Text>}
              <Pressable style={[styles.primary, busy && { opacity: 0.6 }]} onPress={onCreate} disabled={busy} testID="submit-create-household">
                {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.primaryTxt}>Evi oluştur</Text>}
              </Pressable>
              <Pressable onPress={() => setMode("menu")} testID="back-to-menu-from-create"><Text style={styles.link}>Geri</Text></Pressable>
            </View>
          )}

          {mode === "join" && (
            <View style={styles.form}>
              <Text style={styles.label}>Davet kodu (6 hane)</Text>
              <TextInput
                style={[styles.input, styles.codeInput]}
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
                keyboardType="number-pad"
                placeholder="000000"
                maxLength={6}
                placeholderTextColor={colors.borderStrong}
                testID="invite-code-input"
              />
              <View style={styles.info}>
                <Ionicons name="information-circle" size={16} color={colors.brand} />
                <Text style={styles.infoTxt}>Ev sahibinin onayından sonra harcamaları görebileceksin.</Text>
              </View>
              {error && <Text style={styles.error}>{error}</Text>}
              <Pressable style={[styles.primary, busy && { opacity: 0.6 }]} onPress={onJoin} disabled={busy} testID="submit-join-household">
                {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.primaryTxt}>Katılma isteği gönder</Text>}
              </Pressable>
              <Pressable onPress={() => setMode("menu")} testID="back-to-menu-from-join"><Text style={styles.link}>Geri</Text></Pressable>
            </View>
          )}

          <Pressable style={styles.logout} onPress={logout} testID="onboarding-logout">
            <Text style={styles.logoutTxt}>Çıkış yap</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.lg },
  hi: { fontSize: font.sizes.base, color: colors.onSurfaceSecondary, marginTop: spacing.sm },
  title: { fontSize: 28, fontWeight: font.weights.bold, color: colors.onSurface, letterSpacing: -0.3 },
  subtitle: { fontSize: font.sizes.lg, color: colors.onSurfaceSecondary, lineHeight: 22 },
  menu: { gap: spacing.md, marginTop: spacing.md },
  card: {
    flexDirection: "row", gap: spacing.md, alignItems: "center",
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.lg, borderWidth: 1, borderColor: colors.border,
  },
  cardIconWrap: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: font.sizes.lg, fontWeight: font.weights.semibold, color: colors.onSurface, marginBottom: 2 },
  cardDesc: { fontSize: font.sizes.base, color: colors.onSurfaceSecondary, lineHeight: 19 },
  form: { gap: spacing.md, marginTop: spacing.md },
  label: { fontSize: font.sizes.sm, fontWeight: font.weights.semibold, color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  input: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    fontSize: font.sizes.lg, color: colors.onSurface, minHeight: 52,
  },
  codeInput: { fontSize: 30, letterSpacing: 12, textAlign: "center", fontWeight: font.weights.bold, color: colors.brand },
  info: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brandSoft, padding: spacing.md, borderRadius: radius.md },
  infoTxt: { flex: 1, fontSize: font.sizes.sm, color: colors.onBrandSoft, lineHeight: 18 },
  primary: {
    backgroundColor: colors.brand, borderRadius: radius.pill, minHeight: 52,
    alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, marginTop: spacing.sm,
  },
  primaryTxt: { color: colors.onBrand, fontSize: font.sizes.lg, fontWeight: font.weights.semibold },
  link: { color: colors.brand, fontSize: font.sizes.base, textAlign: "center", paddingVertical: spacing.md },
  error: { color: colors.error, fontSize: font.sizes.base },
  logout: { alignItems: "center", marginTop: spacing.xl, paddingVertical: spacing.md },
  logoutTxt: { color: colors.onSurfaceTertiary, fontSize: font.sizes.base },
  pendingWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  pendingIcon: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  pendingTitle: { fontSize: 24, fontWeight: font.weights.bold, color: colors.onSurface, letterSpacing: -0.3 },
  pendingDesc: { fontSize: font.sizes.base, color: colors.onSurfaceSecondary, textAlign: "center", lineHeight: 22 },
  pendingCancelBtn: { marginTop: spacing.xl, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.pill },
  pendingCancelTxt: { color: colors.onSurfaceSecondary, fontWeight: font.weights.semibold },
});
