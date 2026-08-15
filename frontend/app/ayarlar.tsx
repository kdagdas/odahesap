/** Uygulama ayarları — ne bana ne eve, uygulamanın kendisine ait olanlar. */
import { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
} from "react-native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useHousehold } from "@/src/household";
import { api } from "@/src/api";
import { Card, Divider, ScreenHeader, Sheet, Row } from "@/src/ui";
import { colors, spacing, radius, type as T, metrics } from "@/src/theme";

const COUNTRIES = [
  { code: "DE" as const, label: "Almanya", flag: "🇩🇪" },
  { code: "TR" as const, label: "Türkiye", flag: "🇹🇷" },
];
// Para birimi ülkeden BAĞIMSIZ seçilebiliyor: Almanya'da yaşayıp Türkiye'deki
// bir evi yönetmek ya da tersi mümkün.
const CURRENCIES = [
  { code: "EUR" as const, label: "Euro", symbol: "€" },
  { code: "TRY" as const, label: "Türk lirası", symbol: "₺" },
];

export default function Ayarlar() {
  const router = useRouter();
  const { household, isAdmin, refresh } = useHousehold();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patch = async (body: object, key: string) => {
    setBusy(key); setError(null);
    try {
      await api("/households", { method: "PATCH", body: JSON.stringify(body) });
      await refresh();
    } catch (e: any) { setError(e?.message || "Kaydedilemedi"); }
    finally { setBusy(null); }
  };

  const version = Constants.expoConfig?.version ?? "1.0.0";
  const build = (Constants.expoConfig as any)?.android?.versionCode ?? "?";

  return (
    <View style={styles.root} testID="ayarlar-screen">
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          overline="UYGULAMA"
          title="Ayarlar"
          right={
            <Pressable onPress={() => router.back()} hitSlop={12} testID="ayarlar-back" style={styles.headBtn}>
              <Ionicons name="close" size={20} color={colors.onDark} />
            </Pressable>
          }
        />

        <Sheet>
          <View style={styles.scroll}>
            {!isAdmin && (
              <View style={styles.infoBox}>
                <Ionicons name="information-circle" size={16} color={colors.inkSecondary} />
                <Text style={styles.infoTxt}>
                  Ev ayarlarını yalnızca ev yöneticisi değiştirebilir.
                </Text>
              </View>
            )}

            <Card title="Ülke" padded>
              <Text style={styles.hint}>
                Fiş okumada hangi market ve fiş düzeninin bekleneceğini belirler.
              </Text>
              <View style={styles.optRow}>
                {COUNTRIES.map((c) => {
                  const active = (household?.country ?? "DE") === c.code;
                  return (
                    <Pressable
                      key={c.code}
                      style={[styles.opt, active && styles.optActive]}
                      onPress={() => isAdmin && patch({ country: c.code }, `c-${c.code}`)}
                      disabled={!isAdmin || busy !== null}
                      testID={`set-country-${c.code}`}
                    >
                      {busy === `c-${c.code}`
                        ? <ActivityIndicator size="small" color={active ? colors.onBrand : colors.dark} />
                        : <Text style={styles.optSymbol}>{c.flag}</Text>}
                      <Text style={[styles.optTxt, active && styles.optTxtActive]}>{c.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>

            <Card title="Para Birimi" padded>
              <Text style={styles.hint}>
                Bir ev tek para birimi kullanır — farklı birimler toplanamaz.
                Ülkeden bağımsız seçebilirsin. Kur çevrimi yapılmaz, yalnızca
                gösterilen simge değişir.
              </Text>
              <View style={styles.optRow}>
                {CURRENCIES.map((c) => {
                  const active = (household?.currency ?? "EUR") === c.code;
                  return (
                    <Pressable
                      key={c.code}
                      style={[styles.opt, active && styles.optActive]}
                      onPress={() => isAdmin && patch({ currency: c.code }, `k-${c.code}`)}
                      disabled={!isAdmin || busy !== null}
                      testID={`set-currency-${c.code}`}
                    >
                      {busy === `k-${c.code}`
                        ? <ActivityIndicator size="small" color={active ? colors.onBrand : colors.dark} />
                        : <Text style={[styles.optSymbol, active && styles.optTxtActive]}>{c.symbol}</Text>}
                      <Text style={[styles.optTxt, active && styles.optTxtActive]}>{c.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.warnTxt}>
                Geçmiş kayıtlar çevrilmez; yalnızca bundan sonra girilenler ve
                ekrandaki simge değişir.
              </Text>
            </Card>

            {error && <Text style={styles.error} testID="ayarlar-error">{error}</Text>}

            <Card title="Hakkında">
              <Row title="Sürüm" right={<Text style={styles.value}>{version} ({build})</Text>} />
              <Divider inset={spacing.lg} />
              <Row title="Sunucu"
                   right={<Text style={styles.value} numberOfLines={1}>
                     {(process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/^https?:\/\//, "")}
                   </Text>} />
            </Card>
          </View>
        </Sheet>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  page: { backgroundColor: colors.bg, flexGrow: 1 },
  headBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.darkSurface,
    alignItems: "center", justifyContent: "center",
  },
  scroll: { padding: spacing.lg, paddingTop: spacing.sm, gap: metrics.cardGap, paddingBottom: spacing.xxxl },
  hint: { ...T.caption, color: colors.inkSecondary, lineHeight: 18, marginBottom: spacing.md },
  warnTxt: { ...T.caption, color: colors.inkTertiary, lineHeight: 18, marginTop: spacing.md },
  optRow: { flexDirection: "row", gap: spacing.md },
  opt: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: spacing.sm, minHeight: 52, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  optActive: { borderColor: colors.brand, backgroundColor: colors.brand },
  optSymbol: { ...T.emph, color: colors.inkSecondary },
  optTxt: { ...T.bodySb, color: colors.inkSecondary },
  optTxtActive: { color: colors.onBrand },
  infoBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md,
  },
  infoTxt: { flex: 1, ...T.caption, color: colors.inkSecondary, lineHeight: 18 },
  error: { ...T.bodySb, color: colors.negative, textAlign: "center" },
  value: { ...T.caption, color: colors.inkTertiary, maxWidth: 190 },
});
