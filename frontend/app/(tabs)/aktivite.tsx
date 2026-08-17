/** Aktivite — ben yokken evde ne oldu.
 *
 *  Bildirim gelip kaçırıldığında geriye bakacak bir yer yoktu. Telefonu
 *  kapalı olan ya da bildirimleri kapatmış biri olan bitenden habersiz
 *  kalıyordu. Kayıt push'tan bağımsız tutuluyor: push kaybolur, kayıt kalır.
 */
import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiGet, apiPost } from "@/src/api";
import { Card, Divider, ScreenHeader, Sheet, IconPill, useScrollPad } from "@/src/ui";
import { colors, spacing, type as T, metrics } from "@/src/theme";

type Notification = {
  notification_id: string;
  title: string;
  body: string;
  kind: string;
  read: boolean;
  created_at: string;
};

// Bildirim türüne göre simge — hangi tür olduğunu okumadan anlamak için.
const KIND_ICON: Record<string, { icon: string; color: string; tint: string }> = {
  new_expense:   { icon: "receipt-outline",   color: colors.dark,       tint: colors.surfaceSecondary },
  join_request:  { icon: "person-add-outline", color: colors.onInfo,    tint: colors.infoSoft },
  period_closed: { icon: "checkmark-done",     color: colors.accentDark, tint: colors.accentSoft },
};

const relative = (iso: string) => {
  const dk = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (dk < 1) return "az önce";
  if (dk < 60) return `${dk} dk önce`;
  const saat = Math.floor(dk / 60);
  if (saat < 24) return `${saat} saat önce`;
  const gun = Math.floor(saat / 24);
  if (gun === 1) return "dün";
  if (gun < 30) return `${gun} gün önce`;
  return new Date(iso).toLocaleDateString("tr-TR");
};

export default function Aktivite() {
  // Gezinme cubugu payi -- ic dolgu zaten var, buraya yalnizca cihazin payi.
  const altPay = useScrollPad({ tabs: true, extra: 0 });
  const router = useRouter();
  const [rows, setRows] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ notifications: Notification[] }>("/notifications");
      setRows(res.notifications || []);
      // Açıldığı anda okundu sayılıyor: bu ekranın işi zaten "hepsini gör".
      await apiPost("/notifications/read", {});
    } catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.root} testID="aktivite-screen">
      <ScrollView
        contentContainerStyle={[styles.page, altPay]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing}
                          onRefresh={() => { setRefreshing(true); load(); }}
                          tintColor={colors.ink} />
        }
      >
        <ScreenHeader
          overline="EVDE NELER OLDU"
          title="Aktivite"
          right={
            <Pressable onPress={() => router.back()} hitSlop={12}
                       testID="aktivite-back" style={styles.headBtn}>
              <Ionicons name="close" size={20} color={colors.onDark} />
            </Pressable>
          }
        />

        <Sheet>
          <View style={styles.scroll}>
            {loading ? (
              <ActivityIndicator color={colors.ink} style={{ marginTop: spacing.xxl }} />
            ) : rows.length === 0 ? (
              <View style={styles.empty}>
                <View style={styles.emptyRing}>
                  <Ionicons name="notifications-outline" size={30} color={colors.inkTertiary} />
                </View>
                <Text style={styles.emptyTxt}>Henüz bir hareket yok.</Text>
              </View>
            ) : (
              <Card>
                {rows.map((n, i) => {
                  const k = KIND_ICON[n.kind] || KIND_ICON.new_expense;
                  return (
                    <View key={n.notification_id}>
                      {i > 0 && <Divider />}
                      <View style={[styles.row, !n.read && styles.rowUnread]}>
                        <IconPill name={k.icon} color={k.color} tint={k.tint} size={metrics.icon} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.title}>{n.title}</Text>
                          <Text style={styles.body}>{n.body}</Text>
                        </View>
                        <Text style={styles.time}>{relative(n.created_at)}</Text>
                      </View>
                    </View>
                  );
                })}
              </Card>
            )}
          </View>
        </Sheet>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  page: { backgroundColor: colors.bg, flexGrow: 1 },
  headBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.darkSurface,
    alignItems: "center", justifyContent: "center",
  },
  scroll: { padding: spacing.lg, paddingTop: spacing.sm, gap: metrics.cardGap, paddingBottom: spacing.xxxl },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  // Okunmamışlar soldan ince yeşil şeritle işaretli — ayrı bir renk zemini
  // koymak listeyi alacalı gösteriyordu.
  rowUnread: { borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: spacing.lg - 3 },
  title: { ...T.bodySb, color: colors.ink },
  body: { ...T.caption, color: colors.inkSecondary, marginTop: 1, lineHeight: 18 },
  time: { ...T.caption, color: colors.inkTertiary, flexShrink: 0 },
  empty: { alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.md },
  emptyRing: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, alignItems: "center", justifyContent: "center",
  },
  emptyTxt: { ...T.body, color: colors.inkSecondary },
});
