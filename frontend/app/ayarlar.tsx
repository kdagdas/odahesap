/** Uygulama ayarları — ne bana ne eve, uygulamanın kendisine ait olanlar. */
import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import { api } from "@/src/api";
import { Card, Divider, ScreenHeader, Sheet, Row, SelectRow } from "@/src/ui";
import { colors, spacing, radius, type as T, metrics } from "@/src/theme";

// Liste büyüyecek; bu yüzden yan yana düğme değil açılır liste.
const COUNTRIES = [
  { value: "DE" as const, label: "Almanya", hint: "Kassenbon · REWE, ALDI, LIDL…" },
  { value: "TR" as const, label: "Türkiye", hint: "Fiş · BİM, A101, ŞOK…" },
];
const CURRENCIES = [
  { value: "EUR" as const, label: "Euro (€)" },
  { value: "TRY" as const, label: "Türk lirası (₺)" },
];

export default function Ayarlar() {
  const router = useRouter();
  const { user } = useAuth();
  const { household, isAdmin, refresh } = useHousehold();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Para birimi evin kuralını değiştiriyor; ad değiştirmekle aynı yetki
  // seviyesinde olamaz. Yalnızca evi kuran kişi.
  const isFounder = !!household && household.created_by === user?.user_id;

  const patch = async (body: object) => {
    setBusy(true); setError(null);
    try {
      await api("/households", { method: "PATCH", body: JSON.stringify(body) });
      await refresh();
    } catch (e: any) { setError(e?.message || "Kaydedilemedi"); }
    finally { setBusy(false); }
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

            <Card title="Ev Kuralları">
              <SelectRow
                label="Ülke"
                value={(household?.country ?? "DE") as "DE" | "TR"}
                options={COUNTRIES}
                disabled={!isAdmin || busy}
                onSelect={(v) => patch({ country: v })}
                testID="select-country"
              />
              <Divider inset={spacing.lg} />
              <SelectRow
                label="Para birimi"
                value={(household?.currency ?? "EUR") as "EUR" | "TRY"}
                options={CURRENCIES}
                disabled={!isFounder || busy}
                onSelect={(v) => patch({ currency: v })}
                testID="select-currency"
              />
              <View style={styles.noteBox}>
                <Text style={styles.note}>
                  Ülke yalnızca fiş okumada hangi market ve fiş düzeninin
                  bekleneceğini belirler; kayıtlı hiçbir tutara dokunmaz.
                </Text>
                <Text style={styles.note}>
                  <Text style={styles.noteStrong}>Para birimi başka.</Text> Kur çevrimi
                  yapılmaz — değiştirmek "40 €" yazan kaydı "40 ₺" diye göstermek
                  demektir. Bu yüzden yalnızca <Text style={styles.noteStrong}>evi kuran
                  kişi</Text> ve yalnızca <Text style={styles.noteStrong}>evde henüz
                  harcama yokken</Text> değiştirebilir. Başka bir para birimi
                  kullanacaksanız yeni bir ev kurun.
                </Text>
              </View>
              {busy && (
                <View style={{ alignItems: "center", paddingBottom: spacing.md }}>
                  <ActivityIndicator size="small" color={colors.dark} />
                </View>
              )}
            </Card>

            {error && <Text style={styles.error} testID="ayarlar-error">{error}</Text>}

            <Card title="Hakkında">
              <Row title="Sürüm" right={<Text style={styles.value}>{version} ({build})</Text>} />
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
  noteBox: {
    gap: spacing.sm, paddingHorizontal: spacing.lg,
    paddingTop: spacing.md, paddingBottom: spacing.lg,
  },
  note: { ...T.caption, color: colors.inkTertiary, lineHeight: 18 },
  noteStrong: { color: colors.inkSecondary },
  infoBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md,
  },
  infoTxt: { flex: 1, ...T.caption, color: colors.inkSecondary, lineHeight: 18 },
  error: { ...T.bodySb, color: colors.negative, textAlign: "center" },
  value: { ...T.caption, color: colors.inkTertiary },
});
