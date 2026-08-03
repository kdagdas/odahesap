/**
 * "Sunucu uyanıyor" şeridi.
 *
 * Ücretsiz sunucu 15 dk boştaysa uyuyor ve ilk istek ~50 sn sürüyor. Boş bir
 * çember yerine ne olduğunu yazmak, aynı bekleme süresini "bozuk" hissinden
 * çıkarıyor. Yalnızca istek gerçekten uzarsa görünür (3 sn eşiği), yani
 * normal kullanımda hiç çıkmaz.
 */
import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { onServerWaking } from "./api";
import { colors, font, radius, spacing } from "./theme";

export function WakingBanner() {
  const [waking, setWaking] = useState(false);
  const [longWait, setLongWait] = useState(false);
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(-80)).current;

  useEffect(() => onServerWaking(setWaking), []);

  useEffect(() => {
    Animated.timing(slide, {
      toValue: waking ? 0 : -80,
      duration: 220,
      useNativeDriver: true,
    }).start();

    if (!waking) {
      setLongWait(false);
      return;
    }
    // After ~12s it is clearly a cold boot, not a slow network — say so.
    const t = setTimeout(() => setLongWait(true), 12000);
    return () => clearTimeout(t);
  }, [waking, slide]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, { top: insets.top + 6, transform: [{ translateY: slide }] }]}
      testID="waking-banner"
    >
      <View style={styles.pill}>
        <ActivityIndicator size="small" color={colors.onBrandSoft} />
        <Text style={styles.txt}>
          {longWait
            ? "Sunucu uyanıyor, biraz daha sürebilir…"
            : "Sunucuya bağlanılıyor…"}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 100 },
  pill: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.brandSoft, borderRadius: radius.pill,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    shadowColor: "#0F2A2E", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 8, elevation: 4,
  },
  txt: { color: colors.onBrandSoft, fontSize: font.sizes.sm, fontWeight: font.weights.semibold },
});
