/** Alınacaklar — iki sekme: Ev (herkes görür) ve Kendim (sadece sen). */
import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiGet, apiPost, apiDelete, api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import { Avatar } from "@/src/ui";
import { colors, spacing, radius, font } from "@/src/theme";

type Scope = "household" | "self";
type Item = {
  item_id: string;
  text: string;
  scope: Scope;
  added_by: string;
  done: boolean;
  done_by?: string | null;
};

export default function Liste() {
  const { user } = useAuth();
  const { members } = useHousehold();
  const [scope, setScope] = useState<Scope>("household");
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ items: Item[] }>(`/shopping?scope=${scope}`);
      setItems(res.items || []);
      setError(null);
    } catch (e: any) { setError(e?.message || "Liste yüklenemedi"); }
    finally { setLoading(false); setRefreshing(false); }
  }, [scope]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const memberName = (id?: string | null) =>
    members.find((m) => m.user_id === id)?.name?.split(" ")[0] || "";

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    setAdding(true); setError(null);
    // Optimistic: typing a list is a rapid-fire activity, waiting on the
    // network between each item makes it feel broken.
    const temp: Item = {
      item_id: `tmp_${Date.now()}`, text, scope,
      added_by: user?.user_id || "", done: false,
    };
    setItems((cur) => [temp, ...cur]);
    setDraft("");
    try {
      await apiPost("/shopping", { text, scope });
      await load();
    } catch (e: any) {
      setItems((cur) => cur.filter((i) => i.item_id !== temp.item_id));
      setDraft(text);
      setError(e?.message || "Eklenemedi");
    } finally { setAdding(false); }
  };

  const toggle = async (item: Item) => {
    const next = !item.done;
    setItems((cur) => cur.map((i) => (i.item_id === item.item_id ? { ...i, done: next } : i)));
    try {
      await api(`/shopping/${item.item_id}`, {
        method: "PATCH", body: JSON.stringify({ done: next }),
      });
      await load();
    } catch {
      setItems((cur) => cur.map((i) => (i.item_id === item.item_id ? { ...i, done: !next } : i)));
    }
  };

  const remove = async (item: Item) => {
    setItems((cur) => cur.filter((i) => i.item_id !== item.item_id));
    try { await apiDelete(`/shopping/${item.item_id}`); } catch { await load(); }
  };

  const clearDone = async () => {
    try { await apiPost(`/shopping/clear-done?scope=${scope}`, {}); await load(); }
    catch (e: any) { setError(e?.message || "Temizlenemedi"); }
  };

  const pending = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="liste-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Alınacaklar</Text>
        <Text style={styles.subtitle}>
          {pending.length > 0 ? `${pending.length} ürün bekliyor` : "Liste temiz"}
        </Text>
      </View>

      <View style={styles.tabs}>
        {([
          { key: "household", label: "Ev", icon: "home" },
          { key: "self", label: "Kendim", icon: "person" },
        ] as const).map((t) => (
          <Pressable
            key={t.key}
            style={[styles.tab, scope === t.key && styles.tabActive]}
            onPress={() => { setScope(t.key); setLoading(true); }}
            testID={`liste-tab-${t.key}`}
          >
            <Ionicons
              name={t.icon}
              size={15}
              color={scope === t.key ? colors.onBrand : colors.onSurfaceSecondary}
            />
            <Text style={[styles.tabTxt, scope === t.key && styles.tabTxtActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.addRow}>
          <TextInput
            style={styles.addInput}
            value={draft}
            onChangeText={setDraft}
            placeholder={scope === "household" ? "Eve ne lazım?" : "Sana ne lazım?"}
            placeholderTextColor={colors.onSurfaceTertiary}
            onSubmitEditing={add}
            returnKeyType="done"
            blurOnSubmit={false}
            testID="liste-input"
          />
          <Pressable
            style={[styles.addBtn, (!draft.trim() || adding) && { opacity: 0.5 }]}
            onPress={add}
            disabled={!draft.trim() || adding}
            testID="liste-add-btn"
          >
            <Ionicons name="add" size={24} color={colors.onBrand} />
          </Pressable>
        </View>

        {error && <Text style={styles.error} testID="liste-error">{error}</Text>}

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />
          }
        >
          {loading ? (
            <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
          ) : items.length === 0 ? (
            <View style={styles.empty} testID="liste-empty">
              <View style={styles.emptyIcon}>
                <Ionicons name="cart-outline" size={32} color={colors.brand} />
              </View>
              <Text style={styles.emptyTitle}>Liste boş</Text>
              <Text style={styles.emptyDesc}>
                {scope === "household"
                  ? "Eve lazım olanı yaz, markete giden görsün."
                  : "Kendine lazım olanları buraya yaz. Bu listeyi kimse göremez."}
              </Text>
            </View>
          ) : (
            <>
              {pending.map((item) => (
                <Pressable
                  key={item.item_id}
                  style={styles.row}
                  onPress={() => toggle(item)}
                  testID={`liste-item-${item.item_id}`}
                >
                  <View style={styles.checkbox} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTxt}>{item.text}</Text>
                    {scope === "household" && item.added_by !== user?.user_id && (
                      <Text style={styles.itemMeta}>{memberName(item.added_by)} ekledi</Text>
                    )}
                  </View>
                  {scope === "household" && (
                    <Avatar name={memberName(item.added_by) || "?"} size={24}
                            avatarId={(members.find((m) => m.user_id === item.added_by) as any)?.avatar_id} />
                  )}
                  <Pressable onPress={() => remove(item)} hitSlop={10} testID={`liste-del-${item.item_id}`}>
                    <Ionicons name="close" size={18} color={colors.onSurfaceTertiary} />
                  </Pressable>
                </Pressable>
              ))}

              {done.length > 0 && (
                <View style={styles.doneHead}>
                  <Text style={styles.doneTitle}>Alındı ({done.length})</Text>
                  <Pressable onPress={clearDone} testID="liste-clear-done">
                    <Text style={styles.clearTxt}>Temizle</Text>
                  </Pressable>
                </View>
              )}
              {done.map((item) => (
                <Pressable
                  key={item.item_id}
                  style={[styles.row, styles.rowDone]}
                  onPress={() => toggle(item)}
                  testID={`liste-item-${item.item_id}`}
                >
                  <View style={[styles.checkbox, styles.checkboxDone]}>
                    <Ionicons name="checkmark" size={14} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.itemTxt, styles.itemTxtDone]}>{item.text}</Text>
                    {scope === "household" && item.done_by && (
                      <Text style={styles.itemMeta}>{memberName(item.done_by)} aldı</Text>
                    )}
                  </View>
                </Pressable>
              ))}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceAlt },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  title: { fontSize: 26, fontWeight: font.weights.bold, color: colors.onSurface, letterSpacing: -0.3 },
  subtitle: { fontSize: font.sizes.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  tabs: {
    flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill,
    padding: 4, marginHorizontal: spacing.lg, marginTop: spacing.md,
  },
  tab: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: spacing.sm, borderRadius: radius.pill,
  },
  tabActive: { backgroundColor: colors.brand },
  tabTxt: { fontSize: font.sizes.base, fontWeight: font.weights.semibold, color: colors.onSurfaceSecondary },
  tabTxtActive: { color: colors.onBrand },
  addRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  addInput: {
    flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    fontSize: font.sizes.lg, color: colors.onSurface, minHeight: 48,
  },
  addBtn: {
    width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  scroll: { padding: spacing.lg, gap: spacing.sm, paddingBottom: 140 },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  rowDone: { backgroundColor: colors.surfaceSecondary, borderColor: colors.divider },
  checkbox: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center",
  },
  checkboxDone: { backgroundColor: colors.mint, borderColor: colors.mint },
  itemTxt: { fontSize: font.sizes.lg, color: colors.onSurface },
  itemTxtDone: { textDecorationLine: "line-through", color: colors.onSurfaceTertiary },
  itemMeta: { fontSize: font.sizes.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  doneHead: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: spacing.lg, marginBottom: spacing.xs, paddingHorizontal: spacing.xs,
  },
  doneTitle: {
    fontSize: font.sizes.sm, fontWeight: font.weights.semibold, color: colors.onSurfaceSecondary,
    textTransform: "uppercase", letterSpacing: 0.5,
  },
  clearTxt: { color: colors.brand, fontSize: font.sizes.sm, fontWeight: font.weights.semibold },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.brandSoft,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.sm,
  },
  emptyTitle: { fontSize: font.sizes.lg, fontWeight: font.weights.semibold, color: colors.onSurface },
  emptyDesc: { fontSize: font.sizes.base, color: colors.onSurfaceSecondary, textAlign: "center", lineHeight: 20 },
  error: { color: colors.error, fontSize: font.sizes.sm, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
});
