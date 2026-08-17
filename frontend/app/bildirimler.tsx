/** Bildirim tercihleri — kendi ekranında.
 *
 *  Profil'in içinde beş anahtar yan yana duruyordu ve ekranın yarısını
 *  kaplıyordu; kaydırıp geçilen bir bölgeydi. Sistem ayarlarının ve
 *  bankacılık uygulamalarının çözümü aynı: tek satır, yanında durum
 *  ("4 açık"), ayrıntı kendi sayfasında.
 *
 *  **Katılma istekleri burada YOK ve olmayacak.** Yöneticiye giden "yeni
 *  katılma isteği" görülmezse ev arkadaşı kapıda bekler; katılana giden
 *  "isteğin onaylandı" hayatta bir kez olur. İkisi de bir tercih değil,
 *  akışın çalışması için şart — sunucu da o türü tercihe bakmadan gönderiyor.
 */
import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Switch } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { ScreenHeader, Sheet, Card, Divider, useScrollPad } from "@/src/ui";
import { colors, spacing, type as T } from "@/src/theme";

const SATIRLAR = [
  // Harcama tarafı ÜÇE ayrıldı. Tek anahtarken düzenleme gürültüsünden
  // bunalan biri, kapatmak için yeni harcamaları da kapatmak zorundaydı —
  // yani parasını ilgilendiren şeyleri duymamayı göze alıyordu.
  { key: "new_expense", label: "Yeni harcama", desc: "Ev arkadaşın harcama eklediğinde" },
  { key: "expense_edit", label: "Düzenleme ve silme", desc: "Tutarı ya da kimin bölüştüğü değiştiğinde" },
  { key: "settlement", label: "Ödeme kaydı", desc: "Ödeme işaretlendiğinde veya geri alındığında" },
  { key: "period_closed", label: "Dönem kapatma", desc: "Dönem kapatılıp sıfırlandığında" },
];

export default function Bildirimler() {
  const router = useRouter();
  const altPay = useScrollPad();
  const { user, refresh: refreshAuth } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const prefs = (user?.notif_prefs || {}) as Record<string, boolean>;
  const acik = SATIRLAR.filter((r) => prefs[r.key] !== false).length;

  const setPref = async (key: string, value: boolean) => {
    try {
      await api("/auth/notifications", { method: "PATCH", body: JSON.stringify({ [key]: value }) });
      await refreshAuth();
    } catch (e: any) { setError(e?.message || "Ayar kaydedilemedi"); }
  };

  return (
    <View style={styles.root} testID="bildirimler-screen">
      <ScrollView contentContainerStyle={[styles.page, altPay]} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          overline="PROFİL"
          title="Bildirimler"
          right={
            <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headBtn}
                       testID="bildirimler-back">
              <Ionicons name="close" size={20} color={colors.onDark} />
            </Pressable>
          }
        >
          <Text style={styles.sub}>{acik} / {SATIRLAR.length} açık</Text>
        </ScreenHeader>

        <Sheet>
          <View style={styles.body}>
            <Card>
              {SATIRLAR.map((row, i) => (
                <View key={row.key}>
                  {i > 0 && <Divider inset={spacing.lg} />}
                  <View style={styles.prefRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.prefLabel}>{row.label}</Text>
                      <Text style={styles.prefDesc}>{row.desc}</Text>
                    </View>
                    <Switch value={prefs[row.key] !== false}
                            onValueChange={(v) => setPref(row.key, v)}
                            trackColor={{ false: colors.border, true: colors.accent }}
                            thumbColor={colors.surface} testID={`pref-${row.key}`} />
                  </View>
                </View>
              ))}
            </Card>


            {error && <Text style={styles.err} testID="bildirim-error">{error}</Text>}
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
  sub: { ...T.caption, color: colors.onDarkMuted, marginTop: spacing.xs },
  body: { padding: spacing.lg, gap: spacing.lg },
  prefRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 60,
  },
  prefLabel: { ...T.body, color: colors.ink },
  prefDesc: { ...T.caption, color: colors.inkTertiary, marginTop: 1, lineHeight: 17 },
  err: { ...T.captionSb, color: colors.negative, textAlign: "center" },
});
