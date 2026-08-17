import { useState } from "react";
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, TextInput,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { colors, spacing, radius, type as T, overline, fontFamily } from "@/src/theme";

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
        colors={[colors.darkAlt, colors.dark]}
        start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }}
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
                <Ionicons name="wallet" size={20} color={colors.ink} />
              </View>
              <Text style={styles.brand}>KaSa</Text>
            </View>

            <View style={styles.hero}>
              <View style={styles.badge}>
                <Ionicons name="sparkles" size={13} color={colors.accentOnDark} />
                <Text style={styles.badgeTxt}>Fişi tara, kalem kalem böl</Text>
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
                  <Text style={styles.label}>ADIN</Text>
                  <TextInput
                    style={styles.input}
                    value={name}
                    onChangeText={setName}
                    placeholder="Örn. Kadir"
                    placeholderTextColor={colors.inkTertiary}
                    autoCapitalize="words"
                    testID="name-input"
                  />
                </>
              )}

              <Text style={styles.label}>E-POSTA</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="ornek@mail.com"
                placeholderTextColor={colors.inkTertiary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                testID="email-input"
              />

              <Text style={styles.label}>ŞİFRE</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="En az 6 karakter"
                  placeholderTextColor={colors.inkTertiary}
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
                    color={colors.inkTertiary}
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
  root: { flex: 1, backgroundColor: colors.dark },
  content: { flexGrow: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingTop: spacing.md },
  logoWrap: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: colors.onDark,
    alignItems: "center", justifyContent: "center",
  },
  brand: { color: colors.onDark, fontSize: 22, fontFamily: fontFamily.bold, letterSpacing: -0.3 },
  hero: { gap: spacing.sm },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    backgroundColor: "rgba(16,185,129,0.18)",
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
  },
  badgeTxt: { ...T.captionSb, color: colors.accentOnDark },
  title: { color: colors.onDark, fontSize: 32, lineHeight: 39, fontFamily: fontFamily.bold, letterSpacing: -0.8 },
  subtitle: { ...T.body, color: colors.onDarkMuted },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.xl,
    padding: spacing.xl, gap: spacing.xs,
  },
  tabs: {
    flexDirection: "row", backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill, padding: 4, marginBottom: spacing.sm,
  },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.sm + 2, borderRadius: radius.pill },
  tabActive: { backgroundColor: colors.brand },
  tabTxt: { ...T.bodySb, color: colors.inkSecondary },
  tabTxtActive: { color: colors.onBrand },
  label: { ...overline, marginTop: spacing.md },
  input: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    fontSize: 16, fontFamily: fontFamily.regular, color: colors.ink, minHeight: 52,
    marginTop: spacing.xs,
  },
  passwordRow: { justifyContent: "center" },
  passwordInput: { paddingRight: 48 },
  eyeBtn: { position: "absolute", right: spacing.md, top: spacing.lg, padding: 4 },
  error: { ...T.body, color: colors.negative, marginTop: spacing.sm },
  submitBtn: {
    backgroundColor: colors.brand, borderRadius: radius.pill,
    minHeight: 54, alignItems: "center", justifyContent: "center", marginTop: spacing.lg,
  },
  submitTxt: { ...T.emph, color: colors.onBrand },
  switchTxt: {
    ...T.bodySb, color: colors.accentDark,
    textAlign: "center", paddingVertical: spacing.md,
  },
  finePrint: { ...T.caption, color: colors.onDarkMuted, textAlign: "center" },
});
