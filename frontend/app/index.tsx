import { View, ActivityIndicator, StyleSheet } from "react-native";
import { colors } from "@/src/theme";

/** Redirect stub — the Gate in _layout.tsx does the actual routing. */
export default function Index() {
  return (
    <View style={styles.container} testID="index-loading">
      <ActivityIndicator size="large" color={colors.brand} />
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
});
