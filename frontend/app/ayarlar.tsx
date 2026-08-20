/** Uygulama ayarları — ne bana ne eve, uygulamanın kendisine ait olanlar. */
import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import Constants from "expo-constants";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import { api, apiGet } from "@/src/api";
import { Card, Divider, ScreenHeader, Sheet, Row, SelectRow, SelectOption, useScrollPad } from "@/src/ui";
import {
  colors, spacing, radius, type as T, metrics,
  temaTercihi, seciliTema, temaKaydet, type TemaTercihi,
} from "@/src/theme";

/* Önizleme kutularının renkleri SABİT: her ikisi de gösterilmek zorunda, o
   yüzden aktif temadan okunamazlar. `theme.ts` içindeki iki paletin karşılığı. */
const AYDINLIK_BG = "#F6F8FB";
const AYDINLIK_KOYU = "#0F1B33";
const KARANLIK_BG = "#12161D";
const KARANLIK_KOYU = "#0A1120";

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
  /* KAYITLI tercihten okunuyor, açılıştakinden değil. Önce `temaTercihi`
     yazıyordu ve o açılışta donmuş bir sabit: "Koyu" seçip ekrandan çıkıp
     geri gelen kullanıcı seçimini kaybolmuş buluyordu. Odaklanınca da
     tazeleniyor — ekran arka planda kalmış olabilir. */
  const [tema, setTema] = useState<TemaTercihi>(seciliTema());
  useFocusEffect(useCallback(() => { setTema(seciliTema()); }, []));
  const bekliyor = tema !== temaTercihi;
  const TEMA_ADI: Record<TemaTercihi, string> = {
    acik: "Açık", koyu: "Koyu", sistem: "Sistem",
  };
  // Gezinme cubugu payi -- ic dolgu zaten var, buraya yalnizca cihazin payi.
  const altPay = useScrollPad({ extra: 0 });
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
      <ScrollView contentContainerStyle={[styles.page, altPay]} showsVerticalScrollIndicator={false}>
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
                  <ActivityIndicator size="small" color={colors.ink} />
                </View>
              )}
            </Card>
            {error && <Text style={styles.error} testID="ayarlar-error">{error}</Text>}

            {/* GÖRÜNÜM — üç ÖNİZLEME, üç kelime değil.
                Ayarlar ekranındaki öteki kartlar `SelectRow` kullanıyor ve
                tutarlılık gerçek bir gerekçe. Ama "Açık / Koyu / Sistem"
                kelimeleri kullanıcıya bilmediği hiçbir şey söylemiyor; küçük
                kareler ise BU uygulamanın koyu hâlini gösteriyor. Temanın
                kelimenin resimden zayıf kaldığı tek ayar olması, istisnayı
                haklı çıkarıyor.

                "Sistem" ikiye bölünmüş bir kare: "duruma göre biri ya da
                öteki" cümlesini kelimesiz kuruyor. */}
            <Card title="Görünüm">
              <View style={styles.temaSatir}>
                {([
                  { v: "acik" as const, ad: "Açık" },
                  { v: "koyu" as const, ad: "Koyu" },
                  { v: "sistem" as const, ad: "Sistem" },
                ]).map((o) => {
                  const secili = tema === o.v;
                  return (
                    <Pressable key={o.v} style={styles.temaKutu}
                               onPress={() => { setTema(o.v); temaKaydet(o.v); }}
                               testID={`tema-${o.v}`}>
                      <View style={[styles.onizleme, secili && styles.onizlemeOn]}>
                        {o.v === "sistem" ? (
                          <View style={{ flexDirection: "row", flex: 1 }}>
                            <View style={{ flex: 1, backgroundColor: AYDINLIK_BG }}>
                              <View style={[styles.onizBaslik, { backgroundColor: AYDINLIK_KOYU }]} />
                              <View style={styles.onizGovde}>
                                <View style={[styles.onizCizgi, { backgroundColor: "#FFFFFF", borderColor: "#E9EEF4" }]} />
                                <View style={[styles.onizCizgi, { backgroundColor: "#FFFFFF", borderColor: "#E9EEF4" }]} />
                              </View>
                            </View>
                            <View style={{ flex: 1, backgroundColor: KARANLIK_BG }}>
                              <View style={[styles.onizBaslik, { backgroundColor: KARANLIK_KOYU }]} />
                              <View style={styles.onizGovde}>
                                <View style={[styles.onizCizgi, { backgroundColor: "#161B22", borderColor: "#262C36" }]} />
                                <View style={[styles.onizCizgi, { backgroundColor: "#161B22", borderColor: "#262C36" }]} />
                              </View>
                            </View>
                          </View>
                        ) : (
                          <View style={{ flex: 1, backgroundColor: o.v === "acik" ? AYDINLIK_BG : KARANLIK_BG }}>
                            <View style={[styles.onizBaslik, {
                              backgroundColor: o.v === "acik" ? AYDINLIK_KOYU : KARANLIK_KOYU }]} />
                            <View style={styles.onizGovde}>
                              <View style={[styles.onizCizgi, o.v === "acik"
                                ? { backgroundColor: "#FFFFFF", borderColor: "#E9EEF4" }
                                : { backgroundColor: "#161B22", borderColor: "#262C36" }]} />
                              <View style={[styles.onizCizgi, o.v === "acik"
                                ? { backgroundColor: "#FFFFFF", borderColor: "#E9EEF4" }
                                : { backgroundColor: "#161B22", borderColor: "#262C36" }]} />
                            </View>
                          </View>
                        )}
                      </View>
                      <View style={styles.temaAdSatir}>
                        {secili && (
                          <Ionicons name="checkmark" size={13} color={colors.accentDark} />
                        )}
                        <Text style={[styles.temaAd, secili && styles.temaAdOn]}>{o.ad}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              <Divider inset={spacing.lg} />
              {/* Not seçimin ALTINDA, dokunduktan SONRA çıkan bir uyarı değil.
                  Sonradan çıkan uyarı kullanıcının yaptığı şeyi düzeltiyormuş
                  gibi okunur ("olmadı, şunu da yap"); önceden duran bir not
                  ise sözleşmenin parçasıdır. Cümle iki iş yapıyor: seçimin
                  kaydedildiğini söylüyor ve ne zaman görüneceğini kuruyor. */}
              {/* İki hâl, iki cümle. Renkler zaten seçilen temadaysa söylenecek
                  bir şey yok — "kaydedildi" demek boşuna gürültü. Ama seçim
                  ekrandakinden FARKLIYSA, kullanıcının gördüğü tek kanıt
                  renklerin değişmemiş olması ve bu "kaydedilmedi" diye
                  okunuyor. O yüzden bu hâlde not seçimi ADIYLA tekrar ediyor:
                  "Koyu seçildi" cümlesi, kutudaki tikin söylemediği şeyi
                  söylüyor — kayıt diske düştü. */}
              <View style={[styles.temaNot, bekliyor && styles.temaNotBekleyen]}>
                <Ionicons
                  name={bekliyor ? "checkmark-circle" : "information-circle-outline"}
                  size={14}
                  color={bekliyor ? colors.accentDark : colors.inkTertiary}
                />
                <Text style={[styles.temaNotTxt, bekliyor && styles.temaNotTxtBekleyen]}>
                  {bekliyor
                    ? `${TEMA_ADI[tema]} tema kaydedildi. Uygulamayı kapatıp açtığınızda uygulanacak.`
                    : "Renk değişikliği uygulamayı bir sonraki açışınızda görünür."}
                </Text>
              </View>
            </Card>

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
  temaSatir: {
    flexDirection: "row", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.md,
  },
  temaKutu: { flex: 1 },
  /* Kenarlık seçiliyken KALINLAŞIYOR, renk değiştirmiyor: önizlemenin kendisi
     zaten renkli ve etrafına ikinci bir renk koymak paleti kirletiyordu. */
  onizleme: {
    height: 62, borderRadius: radius.md, overflow: "hidden",
    borderWidth: 1, borderColor: colors.border,
  },
  onizlemeOn: { borderWidth: 2, borderColor: colors.ink },
  onizBaslik: { height: 20 },
  onizGovde: { padding: 5, gap: 4 },
  onizCizgi: { height: 6, borderRadius: 2, borderWidth: 1 },
  temaAdSatir: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 3, marginTop: 6,
  },
  temaAd: { ...T.caption, color: colors.inkSecondary },
  temaAdOn: { ...T.captionSb, color: colors.ink },
  temaNot: {
    flexDirection: "row", alignItems: "flex-start", gap: 6,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  temaNotTxt: { ...T.caption, color: colors.inkTertiary, flex: 1, lineHeight: 17 },
  temaNotBekleyen: {
    backgroundColor: colors.accentSoft, borderRadius: radius.md,
    marginHorizontal: spacing.lg, marginBottom: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  temaNotTxtBekleyen: { color: colors.accentDark },
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
