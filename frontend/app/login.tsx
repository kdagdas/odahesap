import { useState } from "react";
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, TextInput,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { colors, spacing, radius, font } from "@/src/theme";

type Mode = "login" | "register";

export default function LoginScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRegister = mode === "register";

  const onSubmit = async () => {
    setError(null);
    if (!email.trim() || !email.includes("@")) {
      setError("Geçerli bir e-posta girin");
      return;
    }
    if (password.length < 6) {
      setError("Şifre en az 6 karakter olmalı");
      return;
    }
    if (isRegister && !name.trim()) {
      setError("Adını girin");
      return;
    }
    setBusy(true);
    try {
      if (isRegister) await register(email, password, name);
      else await login(email, password);
    } catch (e: any) {
      setError(e?.message || "Bağlantı kurulamadı. İnternetini kontrol et.");
    } finally {
      setBusy(false);
    }
  };

  const switchMode = () => {
    setMode(isRegister ? "login" : "register");
    setError(null);
  };

  return (
    <View style={styles.root} testID="login-screen">
      <LinearGradient
        colors={["#0EA5A5", "#0B8180", "#0F2A2E"]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.header}>
              <View style={styles.logoWrap}>
                <Ionicons name="home" size={22} color={colors.brand} />
              </View>
              <Text style={styles.brand}>OdaHesap</Text>
            </View>

            <View style={styles.hero}>
              <View style={styles.badge}>
                <Ionicons name="sparkles" size={14} color={colors.brandSoft} />
                <Text style={styles.badgeTxt}>Türkçe · Almanca fiş desteği</Text>
              </View>
              <Text style={styles.title}>Ev harcamaları{"\n"}artık dert değil.</Text>
              <Text style={styles.subtitle}>
                Fişleri tara, harcamaları böl, dönem sonunda tek tuşla denkleştir.
              </Text>
            </View>

            <View style={styles.card}>
              <View style={styles.tabs}>
                <Pressable
                  style={[styles.tab, !isRegister && styles.tabActive]}
                  onPress={() => { setMode("login"); setError(null); }}
                  testID="tab-login"
                >
                  <Text style={[styles.tabTxt, !isRegister && styles.tabTxtActive]}>Giriş yap</Text>
                </Pressable>
                <Pressable
                  style={[styles.tab, isRegister && styles.tabActive]}
                  onPress={() => { setMode("register"); setError(null); }}
                  testID="tab-register"
                >
                  <Text style={[styles.tabTxt, isRegister && styles.tabTxtActive]}>Kayıt ol</Text>
                </Pressable>
              </View>

              {isRegister && (
                <>
                  <Text style={styles.label}>Adın</Text>
                  <TextInput
                    style={styles.input}
                    value={name}
                    onChangeText={setName}
                    placeholder="Örn. Kadir"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    autoCapitalize="words"
                    testID="name-input"
                  />
                </>
              )}

              <Text style={styles.label}>E-posta</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="ornek@mail.com"
                placeholderTextColor={colors.onSurfaceTertiary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                testID="email-input"
              />

              <Text style={styles.label}>Şifre</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="En az 6 karakter"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="password-input"
                />
                <Pressable
                  style={styles.eyeBtn}
                  onPress={() => setShowPassword((s) => !s)}
                  testID="toggle-password"
                  hitSlop={8}
                >
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={20}
                    color={colors.onSurfaceTertiary}
                  />
                </Pressable>
              </View>

              {error && <Text style={styles.error} testID="login-error">{error}</Text>}

              <Pressable
                onPress={onSubmit}
                disabled={busy}
                style={({ pressed }) => [styles.submitBtn, (pressed || busy) && { opacity: 0.85 }]}
                testID="submit-auth-button"
              >
                {busy ? (
                  <ActivityIndicator color={colors.onBrand} />
                ) : (
                  <Text style={styles.submitTxt}>
                    {isRegister ? "Hesap oluştur" : "Giriş yap"}
                  </Text>
                )}
              </Pressable>

              <Pressable onPress={switchMode} testID="switch-auth-mode">
                <Text style={styles.switchTxt}>
                  {isRegister
                    ? "Zaten hesabın var mı? Giriş yap"
                    : "Hesabın yok mu? Kayıt ol"}
                </Text>
              </Pressable>
            </View>

            <Text style={styles.finePrint}>
              Devam ederek ev arkadaşlarınla veri paylaşmayı kabul edersin.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingTop: spacing.md },
  logoWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  brand: { color: "#fff", fontSize: 22, fontWeight: font.weights.bold, letterSpacing: -0.3 },
  hero: { gap: spacing.sm },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.16)",
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
  },
  badgeTxt: { color: "#E6FFFA", fontSize: font.sizes.sm, fontWeight: font.weights.semibold },
  title: { color: "#fff", fontSize: 32, lineHeight: 38, fontWeight: font.weights.bold, letterSpacing: -0.8 },
  subtitle: { color: "rgba(255,255,255,0.85)", fontSize: font.sizes.base, lineHeight: 20 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.lg, gap: spacing.sm,
  },
  tabs: {
    flexDirection: "row", backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill, padding: 4, marginBottom: spacing.sm,
  },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.pill },
  tabActive: { backgroundColor: colors.brand },
  tabTxt: { fontSize: font.sizes.base, fontWeight: font.weights.semibold, color: colors.onSurfaceSecondary },
  tabTxtActive: { color: colors.onBrand },
  label: {
    fontSize: font.sizes.sm, fontWeight: font.weights.semibold, color: colors.onSurfaceSecondary,
    textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.sm,
  },
  input: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    fontSize: font.sizes.lg, color: colors.onSurface, minHeight: 52,
  },
  passwordRow: { justifyContent: "center" },
  passwordInput: { paddingRight: 48 },
  eyeBtn: { position: "absolute", right: spacing.md, padding: 4 },
  error: { color: colors.error, fontSize: font.sizes.base, marginTop: spacing.sm },
  submitBtn: {
    backgroundColor: colors.brand, borderRadius: radius.pill,
    minHeight: 54, alignItems: "center", justifyContent: "center", marginTop: spacing.lg,
  },
  submitTxt: { color: colors.onBrand, fontSize: font.sizes.lg, fontWeight: font.weights.semibold },
  switchTxt: {
    color: colors.brand, fontSize: font.sizes.base, fontWeight: font.weights.semibold,
    textAlign: "center", paddingVertical: spacing.md,
  },
  finePrint: { color: "rgba(255,255,255,0.65)", fontSize: font.sizes.sm, textAlign: "center" },
});
