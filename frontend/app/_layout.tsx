import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import {
  LogBox, View, ActivityIndicator, StyleSheet, Platform, UIManager,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as Linking from "expo-linking";
import { Alert } from "react-native";
import { savePaymentFor, parseShareUrl } from "@/src/payment";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider, useAuth } from "@/src/auth";
import { HouseholdProvider, useHousehold } from "@/src/household";
import { WakingBanner } from "@/src/WakingBanner";
import { colors } from "@/src/theme";

LogBox.ignoreAllLogs(true);
// Android'de LayoutAnimation acikca acilmali; yoksa liste degisimleri
// ziplayarak gerceklesir (bkz. `animateNextLayout`).
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
SplashScreen.preventAutoHideAsync();

function Gate() {
  const { user, loading: authLoading } = useAuth();
  const { household, pendingHousehold, loading: hhLoading } = useHousehold();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (authLoading || (user && hhLoading)) return;
    // Tip ELLE yazılıyor: `segments[0]` union bir rota adı olarak
    // çıkarılıyor ve derleyici aşağıdaki `first === ""` karşılaştırmasını
    // "hiç tutmaz" diye işaretliyordu. Oysa kök rotada dizi BOŞ ve
    // `segments[0]` çalışma anında `undefined` — karşılaştırma tam da o
    // durumu yakalıyor.
    const first: string = segments[0] || "";
    if (!user) {
      if (first !== "login") router.replace("/login");
      return;
    }
    if (!household) {
      // whether pending or not, keep them on onboarding
      if (first !== "onboarding") router.replace("/onboarding");
      return;
    }
    if (first === "login" || first === "onboarding" || first === "") {
      router.replace("/(tabs)/panel");
    }
  }, [user, household, pendingHousehold, authLoading, hhLoading, segments, router]);

  if (authLoading || (user && hhLoading)) {
    return (
      <View style={styles.splash} testID="app-loading">
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />;
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  useEffect(() => { if (loaded || error) SplashScreen.hideAsync(); }, [loaded, error]);

  /**
   * Paylasilan odeme bilgisini kaydeder.
   *
   * Bilgi sunucuya hic ugramiyor: WhatsApp mesajindaki baglantiyi acan kisinin
   * KENDI cihazina yaziliyor. IBAN'i sunucuda tutmama kararinin bedeli bu bir
   * kerelik paylasim, kazanci ise kimsenin finansal verisinin bizde olmamasi.
   */
  useEffect(() => {
    const isle = (url?: string | null) => {
      if (!url) return;
      try {
        // Ayristirma `payment.ts` icinde: bagimlilik tek yonlu olsun ve
        // biciminin iki surumu (yeni `https://…/o#…`, eski `odahesap://odeme?…`)
        // tek yerde bilinsin.
        const gelen = parseShareUrl(url);
        if (!gelen) return;
        savePaymentFor(gelen.userId, gelen.info);
        Alert.alert(
          "Ödeme bilgisi kaydedildi",
          `${gelen.name || "Ev arkadaşın"} kişisine ödeme yaparken kullanılacak. ` +
          "Bu bilgi yalnızca bu telefonda saklanıyor.",
        );
      } catch { /* bozuk baglanti sessizce yok sayilir */ }
    };
    Linking.getInitialURL().then(isle);
    const sub = Linking.addEventListener("url", (e) => isle(e.url));
    return () => sub.remove();
  }, []);

  // Kancalardan SONRA: erken dönüş kancaların önüne geçerse React'in kanca
  // sayısı render'dan render'a değişir ve uygulama açılışta çöker.
  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <HouseholdProvider>
            <Gate />
            {/* Sits above every screen so the cold-start notice is visible
                wherever the user happens to be when it fires. */}
            <WakingBanner />
          </HouseholdProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
});
