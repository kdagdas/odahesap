import { Tabs } from "expo-router";
import { View, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tabBarHeight } from "@/src/ui";
import { colors, fontFamily } from "@/src/theme";

type IconArg = { color: string; focused: boolean };

// Five tabs, so "Fiş Tara" sits in the true centre. Slots go to what gets
// used daily: the shopping list took the one the expense history had, since
// that history is browsed occasionally and is one tap away from the home
// screen's "Tümü" link. Route file names are unchanged (panel / denge)
// because other screens navigate to them by path; only the titles moved.
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  // Raise tab bar clearly above the phone's home indicator / gesture bar.
  // The total height comes from `tabBarHeight` in src/ui so the screens that
  // must clear the bar cannot drift away from the bar that draws it.
  const bottomPadding = Math.max(insets.bottom, 12) + 12;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.dark,
        tabBarInactiveTintColor: colors.inkTertiary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: tabBarHeight(insets.bottom),
          paddingBottom: bottomPadding,
          paddingTop: 10,
          ...Platform.select({
            ios: { shadowColor: colors.dark, shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.06, shadowRadius: 6 },
            android: { elevation: 8 },
          }),
        },
        // Tablette etiket ikonun ALTINA değil YANINA kayıyordu: React
        // Navigation, sekme kutusu genişleyince `beside-icon` düzenine
        // geçiyor. Telefonda sekme dar olduğu için hiç tetiklenmiyordu.
        // Ortadaki dairesel ikon `marginTop: -22` ile yukarı kaldırıldığı
        // için yatay düzende hizası da bozuluyordu — tek satır, iki belirti.
        tabBarLabelPosition: "below-icon",
        tabBarLabelStyle: { fontSize: 10, fontFamily: fontFamily.semibold, marginTop: 2 },
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
        name="liste"
        options={{
          title: "Alınacaklar",
          tabBarIcon: ({ color, focused }: IconArg) => (
            <Ionicons name={focused ? "cart" : "cart-outline"} size={22} color={color} />
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
                <Ionicons name="scan" size={26} color={colors.onBrand} />
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
    width: 50, height: 50, borderRadius: 25,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.dark,
    // The circle is twice the height of the other icons, so at the default
    // position its lower edge grazed the "Fiş Tara" label. Lift the whole
    // thing — circle and glyph together — clear of the text.
    marginTop: -22,
    marginBottom: 6,
    shadowColor: colors.dark, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28, shadowRadius: 10, elevation: 6,
  },
  centerIconFocused: { backgroundColor: colors.accent },
});
