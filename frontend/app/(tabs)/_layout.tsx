import { Tabs } from "expo-router";
import { View, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, font } from "@/src/theme";

type IconArg = { color: string; focused: boolean };

// Five tabs, so "Fiş Tara" sits in the true centre — with four it was the
// third of four and looked off to the right. Route file names are unchanged
// (panel / denge) because four other screens navigate to them by path; only
// the visible titles moved to Anasayfa / Kasa.
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  // Raise tab bar clearly above the phone's home indicator / gesture bar
  const bottomPadding = Math.max(insets.bottom, 12) + 12;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.onSurfaceTertiary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.divider,
          height: 60 + bottomPadding,
          paddingBottom: bottomPadding,
          paddingTop: 10,
          ...Platform.select({
            ios: { shadowColor: "#0F2A2E", shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.06, shadowRadius: 6 },
            android: { elevation: 8 },
          }),
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: font.weights.semibold as any, marginTop: 2 },
        tabBarItemStyle: { paddingVertical: 4 },
      }}
    >
      <Tabs.Screen
        name="panel"
        options={{
          title: "Anasayfa",
          tabBarIcon: ({ color, focused }: IconArg) => (
            <Ionicons name={focused ? "home" : "home-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="harcamalar"
        options={{
          title: "Harcamalar",
          tabBarIcon: ({ color, focused }: IconArg) => (
            <Ionicons name={focused ? "receipt" : "receipt-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="tara"
        options={{
          title: "Fiş Tara",
          tabBarIcon: ({ focused }: IconArg) => (
            <View style={styles.centerIconWrap}>
              <View style={[styles.centerIcon, focused && styles.centerIconFocused]}>
                <Ionicons name="scan" size={26} color={focused ? colors.onBrand : colors.brand} />
              </View>
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="denge"
        options={{
          title: "Kasa",
          tabBarIcon: ({ color, focused }: IconArg) => (
            <Ionicons name={focused ? "wallet" : "wallet-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profil"
        options={{
          title: "Profil",
          tabBarIcon: ({ color, focused }: IconArg) => (
            <Ionicons name={focused ? "person-circle" : "person-circle-outline"} size={23} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  centerIconWrap: { alignItems: "center", justifyContent: "center" },
  centerIcon: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.brandSoft,
    // The circle is twice the height of the other icons, so at the default
    // position its lower edge grazed the "Fiş Tara" label. Lift the whole
    // thing — circle and glyph together — clear of the text.
    marginTop: -20,
    marginBottom: 6,
  },
  centerIconFocused: {
    backgroundColor: colors.brand,
    shadowColor: colors.brand, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 8, elevation: 6,
  },
});
