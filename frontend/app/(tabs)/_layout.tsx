import { Tabs } from "expo-router";
import { View, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, font, spacing } from "@/src/theme";

type IconArg = { color: string; focused: boolean };

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
        tabBarLabelStyle: { fontSize: 11, fontWeight: font.weights.semibold as any, marginTop: 2 },
        tabBarItemStyle: { paddingVertical: 4 },
      }}
    >
      <Tabs.Screen
        name="panel"
        options={{
          title: "Panel",
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
          tabBarIcon: ({ color, focused }: IconArg) => (
            <View style={styles.centerIconWrap}>
              <View style={[styles.centerIcon, focused && styles.centerIconFocused]}>
                <Ionicons name="scan" size={22} color={focused ? colors.onBrand : colors.brand} />
              </View>
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="denge"
        options={{
          title: "Denge",
          tabBarIcon: ({ color, focused }: IconArg) => (
            <Ionicons name={focused ? "swap-horizontal" : "swap-horizontal-outline"} size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  centerIconWrap: { alignItems: "center", justifyContent: "center" },
  centerIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.brandSoft,
  },
  centerIconFocused: { backgroundColor: colors.brand },
});
