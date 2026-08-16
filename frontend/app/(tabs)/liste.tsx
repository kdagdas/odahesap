/** Alınacaklar — Ev (herkes görür) ve Kendim (sadece sen). */
import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams } from "expo-router";

import { apiGet, apiPost, apiDelete, api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, Sheet, Card, Row, Divider, Avatar, IconPill, Overline, TabSwitch,
} from "@/src/ui";
import { colors, spacing, radius, type as T, metrics } from "@/src/theme";

type Scope = "household" | "self";
type Item = {
  item_id: string; text: string; scope: Scope; added_by: string;
  done: boolean; done_by?: string | null;
};

export default function Liste() {
  const { user } = useAuth();
  const { members } = useHousehold();
  const [scope, setScope] = useState<Scope>("household");
  // Anasayfa'daki "Alinacaklar" karti EV listesini gosteriyor; "Tumu" dendiginde
  // de eve gitmeli. Sekmeler bir kez degistirildikten sonra durum korundugu
  // icin kullanici Kendim'de birakmissa oraya dusuyordu -- gordugu listeyle
  // gittigi liste ayni olmuyordu.
  const { scope: istenen } = useLocalSearchParams<{ scope?: string }>();
  useFocusEffect(
    useCallback(() => {
      if (istenen === "household" || istenen === "self") setScope(istenen as Scope);
    }, [istenen])
  );
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

  const member = (id?: string | null) => members.find((m) => m.user_id === id);
  const first = (id?: string | null) => member(id)?.name?.split(" ")[0] || "";

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    setAdding(true); setError(null);
    // İyimser ekleme: liste yazarken her maddede ağı beklemek uygulamayı
    // bozuk hissettiriyordu.
    const temp: Item = {
      item_id: `tmp_${Date.now()}`, text, scope,
      added_by: user?.user_id || "", done: false,
    };
    setItems((cur) => [temp, ...cur]);
    setDraft("");
    try { await apiPost("/shopping", { text, scope }); await load(); }
    catch (e: any) {
      setItems((cur) => cur.filter((i) => i.item_id !== temp.item_id));
      setDraft(text);
      setError(e?.message || "Eklenemedi");
    } finally { setAdding(false); }
  };

  const toggle = async (item: Item) => {
    const next = !item.done;
    setItems((cur) => cur.map((i) => (i.item_id === item.item_id ? { ...i, done: next } : i)));
    try {
      await api(`/shopping/${item.item_id}`, { method: "PATCH", body: JSON.stringify({ done: next }) });
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
    <View style={styles.root} testID="liste-screen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}
                            tintColor={colors.dark} progressBackgroundColor={colors.surface} />
          }
        >
          <ScreenHeader
            overline="ALINACAKLAR"
            title={pending.length > 0 ? `${pending.length} Ürün Bekliyor` : "Liste Temiz"}
          >
            <TabSwitch
              value={scope}
              onChange={(v) => { setScope(v); setLoading(true); }}
              onDark
              options={[
                { value: "household" as const, label: "Ev", icon: "home" },
                { value: "self" as const, label: "Kendim", icon: "person" },
              ]}
              testID="liste-tab"
            />
          </ScreenHeader>

          <Sheet>
            <View style={[styles.addRow, styles.mx]}>
              <TextInput
                style={styles.addInput}
                value={draft}
                onChangeText={setDraft}
                placeholder={scope === "household" ? "Eve ne lazım?" : "Sana ne lazım?"}
                placeholderTextColor={colors.inkTertiary}
                onSubmitEditing={add}
                returnKeyType="done"
                blurOnSubmit={false}
                testID="liste-input"
              />
              <Pressable style={[styles.addBtn, (!draft.trim() || adding) && { opacity: 0.4 }]}
                         onPress={add} disabled={!draft.trim() || adding} testID="liste-add-btn">
                <Ionicons name="add" size={24} color={colors.onBrand} />
              </Pressable>
            </View>

            {error && <Text style={[styles.err, styles.mx]} testID="liste-error">{error}</Text>}

            {loading ? (
              <ActivityIndicator color={colors.dark} style={{ marginTop: spacing.xxl }} />
            ) : items.length === 0 ? (
              <Card style={[styles.mx, { marginTop: spacing.lg }]} testID="liste-empty">
                <Row
                  minHeight={80}
                  leading={<IconPill name="cart-outline" color={colors.accent}
                                     tint={colors.accentSoft} />}
                  title="Liste boş"
                  subtitle={scope === "household"
                    ? "Eve lazım olanı yaz, markete giden görsün"
                    : "Bu listeyi senden başka kimse göremez"}
                />
              </Card>
            ) : (
              <View style={{ gap: metrics.cardGap, marginTop: spacing.lg }}>
                {pending.length > 0 && (
                  <Card style={styles.mx}>
                    {pending.map((it, i) => (
                      <View key={it.item_id}>
                        <Row
                          minHeight={52}
                          onPress={() => toggle(it)}
                          testID={`liste-item-${it.item_id}`}
                          leading={<View style={styles.check} />}
                          title={<Text style={styles.itemTxt}>{it.text}</Text>}
                          right={
                            <View style={styles.itemRight}>
                              {scope === "household" && (
                                <Avatar name={first(it.added_by)} size={24}
                                        avatarId={(member(it.added_by) as any)?.avatar_id}
                                        userId={it.added_by}
                                        photoVersion={(member(it.added_by) as any)?.photo_version} />
                              )}
                              <Pressable onPress={() => remove(it)} hitSlop={12}
                                         testID={`liste-del-${it.item_id}`}>
                                <Ionicons name="close" size={18} color={colors.inkTertiary} />
                              </Pressable>
                            </View>
                          }
                        />
                        {i < pending.length - 1 && <Divider inset={58} />}
                      </View>
                    ))}
                  </Card>
                )}

                {done.length > 0 && (
                  <View style={{ gap: spacing.sm }}>
                    <View style={[styles.doneHead, styles.mx]}>
                      <Overline>ALINDI ({done.length})</Overline>
                      <Pressable onPress={clearDone} hitSlop={10} testID="liste-clear-done">
                        <Text style={styles.clear}>Temizle</Text>
                      </Pressable>
                    </View>
                    <Card style={styles.mx}>
                      {done.map((it, i) => (
                        <View key={it.item_id}>
                          <Row
                            minHeight={52}
                            onPress={() => toggle(it)}
                            testID={`liste-item-${it.item_id}`}
                            leading={<IconPill name="checkmark" color={colors.onBrand}
                                               tint={colors.accent} size={22} />}
                            title={<Text style={styles.itemDone}>{it.text}</Text>}
                            right={scope === "household" && it.done_by ? (
                              <Text style={styles.itemWho}>{first(it.done_by)} aldı</Text>
                            ) : undefined}
                          />
                          {i < done.length - 1 && <Divider inset={58} />}
                        </View>
                      ))}
                    </Card>
                  </View>
                )}
              </View>
            )}
          </Sheet>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  scroll: { paddingBottom: 130, backgroundColor: colors.bg, flexGrow: 1 },
  mx: { marginHorizontal: spacing.lg },
  addRow: { flexDirection: "row", gap: spacing.sm },
  addInput: {
    flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.pill, paddingHorizontal: spacing.lg, minHeight: 52,
    ...T.body, color: colors.ink,
  },
  addBtn: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  check: { width: 21, height: 21, borderRadius: 11, borderWidth: 1.5, borderColor: colors.borderStrong },
  itemTxt: { ...T.body, color: colors.ink },
  itemDone: { ...T.body, color: colors.inkTertiary, textDecorationLine: "line-through" },
  itemRight: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  itemWho: { ...T.caption, color: colors.inkTertiary },
  doneHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  clear: { ...T.captionSb, color: colors.accent },
  err: { ...T.caption, color: colors.negative, marginTop: spacing.sm },
});
