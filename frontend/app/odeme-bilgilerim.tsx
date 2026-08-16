/** Ödeme bilgilerim — IBAN ve PayPal, **cihazda saklanır.**
 *
 *  Sunucuya hiç gitmiyor. Cihazdan sunucuya geçmek kolay, tersi zordur:
 *  sunucudan silmek duyuru ve güven kaybı demek. Üç kişilik bir evin
 *  ödeşmesi için IBAN'ı veritabanımızda tutmanın gerekçesi yok.
 *
 *  Bedeli: ev arkadaşın senin IBAN'ını görmüyor. O yüzden "paylaş" var —
 *  bir kez paylaşınca açanların cihazına kaydoluyor.
 */
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, Share,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { ScreenHeader, Sheet, Card, useScrollPad } from "@/src/ui";
import {
  getMyPayment, setMyPayment, shareText, formatIban, ibanError,
  markPaymentShared, type PaymentInfo,
} from "@/src/payment";
import { colors, spacing, radius, type as T, overline, fontFamily } from "@/src/theme";

export default function OdemeBilgilerim() {
  const router = useRouter();
  const altPay = useScrollPad();
  const { user } = useAuth();
  const [iban, setIban] = useState("");
  const [paypal, setPaypal] = useState("");
  const [holder, setHolder] = useState("");
  const [kayitli, setKayitli] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getMyPayment().then((p) => {
      setIban(formatIban(p.iban));
      setPaypal(p.paypal || "");
      setHolder(p.holder || user?.name || "");
    });
  }, []);

  const kaydet = useCallback(async () => {
    setErr(null);
    // Hata mesaji artik NEYIN yanlis oldugunu soyluyor: "hatali gorunuyor"
    // kullaniciya duzeltecek bir sey vermiyordu.
    const ibanHata = ibanError(iban);
    if (ibanHata) { setErr(ibanHata); return; }
    const bilgi: PaymentInfo = { iban, paypal, holder };
    await setMyPayment(bilgi);
    setKayitli(true);
    setTimeout(() => setKayitli(false), 2000);
  }, [iban, paypal, holder]);

  const paylas = async () => {
    await kaydet();
    if (ibanError(iban)) return;
    if (!iban.trim() && !paypal.trim()) { setErr("Önce en az bir bilgi girin"); return; }
    const metin = shareText(user?.name || "Ev arkadaşın", user?.user_id || "", {
      iban, paypal, holder,
    });
    try {
      await Share.share({ message: metin });
      // Kasa'daki "bilgimi gönder" düğmesi buradan da küçülmeli; iki yol
      // aynı işi yapıyor, ikisinin ayrı durum tutması anlamsız olurdu.
      await markPaymentShared();
    } catch { /* iptal edildi */ }
  };

  return (
    <View style={styles.root} testID="odeme-bilgilerim-screen">
      <ScrollView contentContainerStyle={[styles.page, altPay]} keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}>
        <ScreenHeader
          overline="PROFİL"
          title="Ödeme Bilgilerim"
          right={
            <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headBtn}
                       testID="odeme-back">
              <Ionicons name="close" size={20} color={colors.onDark} />
            </Pressable>
          }
        >
          <Text style={styles.heroSub}>
            Ev arkadaşların sana ödeme yaparken bunları kullanır.
          </Text>
        </ScreenHeader>

        <Sheet>
          <View style={styles.body}>
            <Card padded>
              <Text style={styles.label}>HESAP SAHİBİ</Text>
              <TextInput
                style={styles.input} value={holder} onChangeText={setHolder}
                placeholder="Ad Soyad" placeholderTextColor={colors.inkTertiary}
                testID="odeme-holder"
              />
              {/* SEPA transferinde IBAN tek başına yetmiyor, ad da isteniyor. */}
              <Text style={styles.hint}>Banka transferinde IBAN'la birlikte isteniyor.</Text>

              <View style={styles.ayirici} />
              <Text style={styles.label}>IBAN</Text>
              <TextInput
                style={[styles.input, styles.mono]}
                value={iban}
                onChangeText={(t) => setIban(formatIban(t))}
                placeholder="DE00 0000 0000 0000 0000 00"
                placeholderTextColor={colors.inkTertiary}
                autoCapitalize="characters"
                testID="odeme-iban"
              />

              <View style={styles.ayirici} />
              <Text style={styles.label}>PAYPAL</Text>
              <View style={styles.ppRow}>
                <View style={styles.ppLogo}>
                  <Ionicons name="logo-paypal" size={16} color={colors.onInfo} />
                </View>
                <Text style={styles.ppPrefix}>paypal.me/</Text>
                <TextInput
                  style={[styles.input, { flex: 1 }]} value={paypal}
                  onChangeText={setPaypal} placeholder="kullaniciadi"
                  placeholderTextColor={colors.inkTertiary} autoCapitalize="none"
                  testID="odeme-paypal"
                />
              </View>
              {/* Uçtan uca gerçekten çalışan tek yol bu: bağlantı tutarla
                  birlikte açılıyor, kullanıcı IBAN yapıştırmak zorunda kalmıyor. */}
              <Text style={styles.hint}>Tek dokunuşla ödeme için en pratik yol.</Text>

              {err && <Text style={styles.err}>{err}</Text>}

              <Pressable style={styles.primary} onPress={kaydet} testID="odeme-save">
                <Ionicons name={kayitli ? "checkmark" : "save-outline"} size={18} color={colors.onBrand} />
                <Text style={styles.primaryTxt}>{kayitli ? "Kaydedildi" : "Kaydet"}</Text>
              </Pressable>
            </Card>

            <Card>
              <Pressable style={styles.shareRow} onPress={paylas} testID="odeme-share"
                         android_ripple={{ color: colors.divider }}>
                <View style={styles.shareIcon}>
                  <Ionicons name="share-social-outline" size={19} color={colors.accentDark} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.shareTitle}>Ev arkadaşlarınla paylaş</Text>
                  <Text style={styles.shareDesc}>
                    Açan kişinin telefonuna kaydolur, bir daha sormasına gerek kalmaz
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.inkTertiary} />
              </Pressable>
            </Card>

            <View style={styles.privacy}>
              <Ionicons name="phone-portrait-outline" size={16} color={colors.inkSecondary} />
              <Text style={styles.privacyTxt}>
                Bu bilgiler <Text style={styles.bold}>yalnızca bu telefonda</Text> saklanıyor,
                sunucuya gönderilmiyor. Uygulamayı silersen kaybolur.
              </Text>
            </View>
          </View>
        </Sheet>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  // Alt boşluk `useScrollPad`'den: gezinme çubuğu payı cihaza göre değişiyor.
  page: { backgroundColor: colors.bg, flexGrow: 1 },
  headBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.darkSurface,
    alignItems: "center", justifyContent: "center",
  },
  heroSub: { ...T.caption, color: colors.onDarkMuted, marginTop: spacing.xs },
  body: { padding: spacing.lg, gap: spacing.lg },
  label: { ...overline },
  input: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    fontSize: 15, fontFamily: fontFamily.regular, color: colors.ink, minHeight: 48,
    marginTop: spacing.xs,
  },
  mono: { fontVariant: ["tabular-nums"], letterSpacing: 0.3 },
  ppRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  ppPrefix: { ...T.caption, color: colors.inkTertiary, marginTop: spacing.xs },
  hint: { ...T.caption, color: colors.inkTertiary, marginTop: spacing.xs, lineHeight: 17 },
  // Alanlar arasinda sac teli + nefes: etiketler bir onceki alanin ipucu
  // yazisina yapisik duruyordu ve ucu tek blok gibi okunuyordu.
  ayirici: {
    height: StyleSheet.hairlineWidth, backgroundColor: colors.divider,
    marginTop: spacing.lg, marginBottom: spacing.lg,
  },
  ppLogo: {
    width: 30, height: 30, borderRadius: 9, backgroundColor: colors.infoSoft,
    alignItems: "center", justifyContent: "center", marginTop: spacing.xs,
  },
  err: { ...T.captionSb, color: colors.negative, marginTop: spacing.md },
  primary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: spacing.lg, minHeight: 50, borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  primaryTxt: { ...T.emph, color: colors.onBrand },
  shareRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 64,
  },
  shareIcon: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: colors.accentSoft,
    alignItems: "center", justifyContent: "center",
  },
  shareTitle: { ...T.emph, color: colors.ink },
  shareDesc: { ...T.caption, color: colors.inkTertiary, marginTop: 1, lineHeight: 17 },
  privacy: {
    flexDirection: "row", gap: spacing.sm, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, padding: spacing.md,
  },
  privacyTxt: { ...T.caption, color: colors.inkSecondary, flex: 1, lineHeight: 18 },
  bold: { fontFamily: fontFamily.semibold },
});
