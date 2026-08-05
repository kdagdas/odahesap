import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiPost } from "@/src/api";
import { useHousehold } from "@/src/household";
import { useAuth } from "@/src/auth";
import { ScreenHeader, Sheet, Card, Divider, IconPill } from "@/src/ui";
import { colors, spacing, radius, type as T, overline, fontFamily } from "@/src/theme";

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
      <View style={styles.root} testID="pending-approval-screen">
        <ScreenHeader overline="KATILMA İSTEĞİ" title="Onay Bekleniyor" />
        <Sheet>
          <View style={styles.pendingWrap}>
            <View style={styles.pendingIcon}>
              <Ionicons name="hourglass-outline" size={38} color={colors.dark} />
            </View>
            <Text style={styles.pendingTitle}>Onay bekleniyor…</Text>
            <Text style={styles.pendingDesc}>
              "<Text style={{ fontFamily: fontFamily.bold }}>{pendingHousehold.name}</Text>" evine katılma isteğin gönderildi.
              Ev üyelerinden birinin onaylaması gerekiyor.
            </Text>
            <ActivityIndicator color={colors.dark} style={{ marginTop: spacing.lg }} />
            <Pressable
              style={styles.pendingCancelBtn}
              onPress={async () => { await apiPost("/households/leave", {}); await refresh(); }}
              testID="cancel-pending-btn"
            >
              <Text style={styles.pendingCancelTxt}>İsteği iptal et</Text>
            </Pressable>
            <Pressable style={styles.logout} onPress={logout} testID="onboarding-logout">
              <Text style={styles.logoutTxt}>Çıkış yap</Text>
            </Pressable>
          </View>
        </Sheet>
      </View>
    );
  }

  return (
    <View style={styles.root} testID="onboarding-screen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScreenHeader overline={`MERHABA, ${(user?.name?.split(" ")[0] || "").toLocaleUpperCase("tr-TR")}`} title="Ev Seç veya Oluştur">
          <Text style={styles.heroSub}>
            Oda arkadaşlarınla harcamaları paylaşmak için bir ev bağla.
          </Text>
        </ScreenHeader>

        <Sheet>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {mode === "menu" && (
              <Card>
                <Pressable
                  style={styles.optRow}
                  onPress={() => { setMode("create"); setError(null); }}
                  testID="create-household-cta"
                  android_ripple={{ color: colors.divider }}
                >
                  <IconPill name="home" color={colors.accentDark} tint={colors.accentSoft} size={44} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optTitle}>Yeni ev oluştur</Text>
                    <Text style={styles.optDesc}>Kendi evini kur, arkadaşlarını 6 haneli davet koduyla davet et.</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.inkTertiary} />
                </Pressable>
                <Divider inset={spacing.lg} />
                <Pressable
                  style={styles.optRow}
                  onPress={() => { setMode("join"); setError(null); }}
                  testID="join-household-cta"
                  android_ripple={{ color: colors.divider }}
                >
                  <IconPill name="key" color={colors.onInfo} tint={colors.infoSoft} size={44} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optTitle}>Eve katıl</Text>
                    <Text style={styles.optDesc}>Ev sahibinden aldığın 6 haneli davet kodunu gir.</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.inkTertiary} />
                </Pressable>
              </Card>
            )}

            {mode === "create" && (
              <View style={styles.form}>
                <Text style={styles.label}>EV ADI</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="Örn. Berlin Öğrenci Evi"
                  placeholderTextColor={colors.inkTertiary}
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
                <Text style={styles.label}>DAVET KODU (6 HANE)</Text>
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  value={code}
                  onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
                  keyboardType="number-pad"
                  placeholder="000000"
                  maxLength={6}
                  placeholderTextColor={colors.inkTertiary}
                  testID="invite-code-input"
                />
                <View style={styles.info}>
                  <Ionicons name="information-circle" size={16} color={colors.accentDark} />
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
        </Sheet>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  heroSub: { ...T.body, color: colors.onDarkMuted, marginTop: spacing.xs },
  content: { padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxxl, gap: spacing.lg },
  optRow: {
    flexDirection: "row", gap: spacing.md, alignItems: "center",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.lg,
  },
  optTitle: { ...T.emph, color: colors.ink, marginBottom: 2 },
  optDesc: { ...T.caption, color: colors.inkSecondary, lineHeight: 18 },
  form: { gap: spacing.md },
  label: { ...overline },
  input: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    fontSize: 16, fontFamily: fontFamily.regular, color: colors.ink, minHeight: 52,
  },
  codeInput: {
    fontSize: 30, letterSpacing: 12, textAlign: "center",
    fontFamily: fontFamily.bold, color: colors.dark, minHeight: 66,
  },
  info: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.accentSoft, padding: spacing.md, borderRadius: radius.md,
  },
  infoTxt: { flex: 1, ...T.caption, color: colors.accentDark, lineHeight: 18 },
  primary: {
    backgroundColor: colors.brand, borderRadius: radius.pill, minHeight: 54,
    alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, marginTop: spacing.sm,
  },
  primaryTxt: { ...T.emph, color: colors.onBrand },
  link: { ...T.body, color: colors.accentDark, textAlign: "center", paddingVertical: spacing.md },
  error: { ...T.body, color: colors.negative },
  logout: { alignItems: "center", marginTop: spacing.xl, paddingVertical: spacing.md },
  logoutTxt: { ...T.body, color: colors.inkTertiary },
  pendingWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  pendingIcon: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.md,
  },
  pendingTitle: { ...T.screen, color: colors.ink },
  pendingDesc: { ...T.body, color: colors.inkSecondary, textAlign: "center", lineHeight: 22 },
  pendingCancelBtn: {
    marginTop: spacing.xl, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.pill,
  },
  pendingCancelTxt: { ...T.bodySb, color: colors.inkSecondary },
});
