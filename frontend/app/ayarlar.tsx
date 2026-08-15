/** Uygulama ayarları — ne bana ne eve, uygulamanın kendisine ait olanlar. */
import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import { api, apiGet } from "@/src/api";
import { Card, Divider, ScreenHeader, Sheet, Row, SelectRow, SelectOption } from "@/src/ui";
import { colors, spacing, type as T, metrics } from "@/src/theme";

/**
 * Listeler bilerek uzun: gelmemiş seçenekler de görünüyor ama seçilemiyor.
 * Boş bir listede "yalnızca iki ülke var" hissi doğuyordu; sönük satırlar
 * neyin planlandığını söylüyor ve liste büyüdüğünde ekran değişmiyor.
 */
const COUNTRIES: SelectOption<string>[] = [
  { value: "DE", label: "Almanya", mark: "🇩🇪", hint: "Kassenbon · REWE, ALDI, LIDL" },
  { value: "TR", label: "Türkiye", mark: "🇹🇷", hint: "Fiş · BİM, A101, ŞOK" },
  { value: "AT", label: "Avusturya", mark: "🇦🇹", soon: true },
  { value: "NL", label: "Hollanda", mark: "🇳🇱", soon: true },
  { value: "FR", label: "Fransa", mark: "🇫🇷", soon: true },
  { value: "GB", label: "Birleşik Krallık", mark: "🇬🇧", soon: true },
  { value: "US", label: "ABD", mark: "🇺🇸", soon: true },
];

const CURRENCIES: SelectOption<string>[] = [
  { value: "EUR", label: "Euro", mark: "€" },
  { value: "TRY", label: "Türk lirası", mark: "₺" },
  { value: "USD", label: "ABD doları", mark: "$", soon: true },
  { value: "GBP", label: "Sterlin", mark: "£", soon: true },
  { value: "CHF", label: "İsviçre frangı", mark: "₣", soon: true },
];

// Dil ülkeden bağımsız ve KİŞİSEL: Almanya'daki bir evde biri Türkçe, biri
// Almanca kullanabilmeli. Bu yüzden ev ayarı değil, cihaz ayarı.
const LANGUAGES: SelectOption<string>[] = [
  { value: "tr", label: "Türkçe", mark: "🇹🇷" },
  { value: "en", label: "English", mark: "🇬🇧", soon: true },
  { value: "de", label: "Deutsch", mark: "🇩🇪", soon: true },
];

// Kısa tutuluyor: uzun açıklama kartın altında koca bir metin bloğu olarak
// duruyordu. Ayrıntı isteyen kilide dokunuyor, gerisi kısa kalıyor.
const LOCK_REASON =
  "Ülke ve para birimi yalnızca hiç harcama yapılmamış evlerde değiştirilebilir.\n\n" +
  "Farklı bir para birimi için yeni bir ev kurun.";

export default function Ayarlar() {
  const router = useRouter();
  const { user } = useAuth();
  const { household, refresh } = useHousehold();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expenseCount, setExpenseCount] = useState<number | null>(null);

  useEffect(() => {
    apiGet<{ expenses: unknown[] }>("/expenses")
      .then((r) => setExpenseCount((r.expenses || []).length))
      .catch(() => setExpenseCount(0));
  }, []);

  // Ev kuralları: yalnızca evi kuran kişi, yalnızca hiç harcama yokken.
  // Sunucu da aynı kuralı uyguluyor; buradaki kilit sadece görsel.
  const isFounder = !!household && household.created_by === user?.user_id;
  const canChangeRules = isFounder && expenseCount === 0;

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
            <Card title="Ev Kuralları">
              <SelectRow
                label="Ülke"
                value={household?.country ?? "DE"}
                options={COUNTRIES}
                locked={!canChangeRules}
                lockReason={LOCK_REASON}
                onSelect={(v) => patch({ country: v })}
                testID="select-country"
              />
              <Divider inset={spacing.lg} />
              <SelectRow
                label="Para birimi"
                value={household?.currency ?? "EUR"}
                options={CURRENCIES}
                locked={!canChangeRules}
                lockReason={LOCK_REASON}
                onSelect={(v) => patch({ currency: v })}
                testID="select-currency"
              />
              {busy && (
                <View style={{ alignItems: "center", padding: spacing.md }}>
                  <ActivityIndicator size="small" color={colors.dark} />
                </View>
              )}
            </Card>
            {error && <Text style={styles.error} testID="ayarlar-error">{error}</Text>}

            <Card title="Dil">
              <SelectRow
                label="Uygulama dili"
                value="tr"
                options={LANGUAGES}
                onSelect={() => {}}
                testID="select-language"
              />
            </Card>

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
  note: {
    ...T.caption, color: colors.inkTertiary, lineHeight: 18,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg,
  },
  error: { ...T.bodySb, color: colors.negative, textAlign: "center" },
  value: { ...T.caption, color: colors.inkTertiary },
});
