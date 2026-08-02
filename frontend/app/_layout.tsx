import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox, View, ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider, useAuth } from "@/src/auth";
import { HouseholdProvider, useHousehold } from "@/src/household";
import { colors } from "@/src/theme";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

function Gate() {
  const { user, loading: authLoading } = useAuth();
  const { household, pendingHousehold, loading: hhLoading } = useHousehold();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (authLoading || (user && hhLoading)) return;
    const first = segments[0] || "";
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
  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <HouseholdProvider>
            <Gate />
          </HouseholdProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
});
