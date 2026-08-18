/** Member detail drill-down: what a given roommate spent for the household in a period. */
import { useCallback, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiGet } from "@/src/api";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, HeaderSplit, Sheet, Card, Divider, Avatar, CategoryIcon,
  MerchantBadge, Tag, Money, splitBadge, formatEUR, formatDateTR, formatQty,
  useScrollPad, useGeriDon,
} from "@/src/ui";
import { colors, spacing, type as T, metrics } from "@/src/theme";

type Item = { name: string; price: number; quantity?: number; unit?: string; category: string };
type Expense = {
  expense_id: string; added_by: string; target_type: string; target_user_id?: string;
  split_mode?: string; split_with?: Record<string, number> | null;
  total: number; merchant?: string; category?: string; source: string;
  expense_date?: string; created_at: string; items?: Item[]; notes?: string;
};

export default function MemberDetail() {
  // Gezinme cubugu payi -- ic dolgu zaten var, buraya yalnizca cihazin payi.
  const altPay = useScrollPad({ tabs: true, extra: 0 });
  const { memberId, periodId } = useLocalSearchParams<{ memberId: string; periodId?: string }>();
  const router = useRouter();
  /* Geri, geldiği yere. Sekme gezgininde `back()` Anasayfa'ya düşüyor. */
  const geriDon = useGeriDon();
  const { members } = useHousehold();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [householdTotal, setHouseholdTotal] = useState(0);
  const [roommateTotal, setRoommateTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      if (periodId) q.set("period_id", periodId as string);
      const res = await apiGet<any>(`/members/${memberId}/expenses?${q.toString()}`);
      setExpenses(res.expenses || []);
      setHouseholdTotal(res.household_total || 0);
      setRoommateTotal(res.roommate_total || 0);
    } catch (e) { console.log(e); }
    finally { setLoading(false); }
  }, [memberId, periodId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const member = members.find((m) => m.user_id === memberId);

  return (
    <View style={styles.root} testID="member-detail-screen">
      {/* Başlık kaydırma alanının içinde — aşağı inerken beyaz yüzey örtüyor. */}
      <ScrollView contentContainerStyle={[styles.page, altPay]} showsVerticalScrollIndicator={false}>
      <ScreenHeader
        size="l"
        overline="EV ARKADAŞI"
        title={member?.name || "—"}
        right={
          <Pressable onPress={geriDon} testID="member-detail-back" hitSlop={12} style={styles.headBtn}>
            <Ionicons name="close" size={20} color={colors.onDark} />
          </Pressable>
        }
      >
        <View style={styles.heroAvatar}>
          <Avatar
            name={member?.name || "?"} size={56}
            avatarId={(member as any)?.avatar_id}
            userId={member?.user_id}
            photoVersion={(member as any)?.photo_version}
          />
          <Text style={styles.heroCaption}>Bu dönemdeki katkısı ve harcamaları</Text>
        </View>
        <HeaderSplit
          items={[
            { label: "Ev için", value: formatEUR(householdTotal), accent: true },
            { label: "Kişisel", value: formatEUR(roommateTotal) },
          ]}
        />
      </ScreenHeader>

      <Sheet>
        <View style={styles.scroll}>
          {loading ? (
            <ActivityIndicator color={colors.ink} style={{ marginTop: spacing.xl }} />
          ) : expenses.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyRing}>
                <Ionicons name="file-tray-outline" size={30} color={colors.inkTertiary} />
              </View>
              <Text style={styles.emptyTxt}>Bu dönemde bir harcaması yok.</Text>
            </View>
          ) : (
            <Card title="Harcama Detayı">
              {expenses.map((e, idx) => {
                const targetChip = splitBadge(e, members, undefined, "Kendisi");
                return (
                  <View key={e.expense_id} testID={`md-exp-${e.expense_id}`}>
                    {idx > 0 && <Divider inset={spacing.lg} />}
                    <View style={styles.expRow}>
                      <View style={{ flex: 1, gap: 3 }}>
                        <View style={styles.titleRow}>
                          {e.merchant
                            ? <MerchantBadge name={e.merchant} />
                            : <Text style={styles.expTitle} numberOfLines={1}>
                                {e.category || (e.source === "receipt" ? "Fiş" : "Manuel")}
                              </Text>}
                          <Tag label={targetChip.txt} tint={targetChip.bg} color={targetChip.color} />
                        </View>
                        {e.expense_date && (
                          <Text style={styles.expSubtle}>{formatDateTR(e.expense_date)}</Text>
                        )}
                      </View>
                      <Money value={e.total} />
                    </View>

                    {(e.items || []).length > 0 && (
                      <View style={styles.itemList}>
                        {(e.items || []).map((it, i) => (
                          <View key={i} style={styles.itemRow}>
                            <CategoryIcon category={it.category} size={30} />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.itemName} numberOfLines={1}>{it.name}</Text>
                              {(it.quantity || 1) !== 1 && (
                                <Text style={styles.itemQty}>{formatQty(it.quantity, it.unit)} × {formatEUR(it.price)}</Text>
                              )}
                            </View>
                            <Text style={styles.itemTotal}>{formatEUR((it.quantity || 1) * it.price)}</Text>
                          </View>
                        ))}
                        {e.notes ? <Text style={styles.notes}>💬 {e.notes}</Text> : null}
                      </View>
                    )}
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
  headBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.darkSurface,
    alignItems: "center", justifyContent: "center",
  },
  heroAvatar: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  heroCaption: { ...T.caption, color: colors.onDarkMuted, flex: 1 },
  page: { backgroundColor: colors.bg, flexGrow: 1 },
  scroll: { padding: spacing.lg, paddingTop: spacing.sm, gap: metrics.cardGap, paddingBottom: spacing.xxxl },
  empty: { alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.md },
  emptyRing: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, alignItems: "center", justifyContent: "center",
  },
  emptyTxt: { ...T.body, color: colors.inkSecondary },
  expRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  expTitle: { ...T.bodySb, color: colors.ink },
  expSubtle: { ...T.caption, color: colors.inkTertiary },
  itemList: {
    backgroundColor: colors.surfaceAlt, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md,
  },
  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  itemName: { ...T.body, color: colors.ink },
  itemQty: { ...T.caption, color: colors.inkTertiary, marginTop: 1 },
  itemTotal: { ...T.bodySb, color: colors.ink, fontVariant: ["tabular-nums"] },
  notes: { ...T.caption, color: colors.inkSecondary, fontStyle: "italic" },
});
