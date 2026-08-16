import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, ActivityIndicator,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiGet, apiDelete } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, HeaderSplit, Sheet, Card, Divider, Avatar, CategoryIcon,
  MerchantBadge, Tag, Money, splitBadge, formatEUR, formatDateTR, formatQty,
  HeaderPills, HeaderPill, useScrollPad,
} from "@/src/ui";
import { colors, spacing, radius, type as T, overline, metrics } from "@/src/theme";

type Item = { name: string; price: number; quantity?: number; unit?: string; category: string };
type Expense = {
  expense_id: string; added_by: string; target_type: string; target_user_id?: string;
  split_mode?: string; split_with?: Record<string, number> | null;
  total: number; merchant?: string; category?: string; source: string;
  created_at: string; expense_date?: string;
  items?: Item[]; notes?: string;
};
type Period = { period_id: string; started_at: string; closed_at: string | null; status: string };

/**
 * Dönem etiketi — bir ARALIK. Kasa'daki ile aynı biçim; yalnızca başlangıç
 * ayını yazmak, aynı ay içinde açılıp kapanan iki dönemi ayırt edilemez
 * yapıyordu.
 */
const gunAy = (iso: string) =>
  new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });

const periodLabel = (p: Period) =>
  `${gunAy(p.started_at)} – ${p.closed_at ? gunAy(p.closed_at) : "bugün"}`;

const periodHint = (p: Period, idx: number, total: number) =>
  `Dönem #${total - idx}${p.status === "active" ? " · sürüyor" : ""}`;

// Was a tab; the shopping list earns that slot because it is used daily while
// this history is opened occasionally. Reached from "Tümü" on the home screen.
export default function Harcamalar() {
  // Gezinme cubugu payi -- ic dolgu zaten var, buraya yalnizca cihazin payi.
  const altPay = useScrollPad({ tabs: true, extra: 0 });
  const { user } = useAuth();
  const router = useRouter();
  const { members, activePeriod } = useHousehold();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string | undefined>(undefined);
  const [memberFilter, setMemberFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const pers = await apiGet("/periods");
      setPeriods(pers.periods || []);
      const pid = selectedPeriod || activePeriod?.period_id;
      const q = new URLSearchParams();
      if (pid) q.set("period_id", pid);
      if (memberFilter) q.set("member_id", memberFilter);
      const exp = await apiGet(`/expenses?${q.toString()}`);
      setExpenses(exp.expenses || []);
    } catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [selectedPeriod, memberFilter, activePeriod]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onDelete = async (id: string) => {
    try { await apiDelete(`/expenses/${id}`); load(); } catch (e) { console.log(e); }
  };

  const activePeriodId = activePeriod?.period_id;
  const currentPeriodId = selectedPeriod || activePeriodId;
  const listedTotal = expenses.reduce((s, e) => s + (e.total || 0), 0);

  return (
    <View style={styles.root} testID="harcamalar-screen">
      {/* Başlık kaydırma alanının içinde: aşağı inerken beyaz yüzey koyu alanı
          örtüp yerini alıyor. Sabit kalan koyu bant listeden yer çalıyordu. */}
      <ScrollView
        contentContainerStyle={[styles.page, altPay]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.dark} />
        }
      >
        <ScreenHeader
          overline="GEÇMİŞ"
          title="Harcamalar"
          right={
            <Pressable onPress={() => router.back()} hitSlop={12} testID="harcamalar-back" style={styles.headBtn}>
              <Ionicons name="close" size={20} color={colors.onDark} />
            </Pressable>
          }
        >
          <HeaderSplit
            items={[
              { label: "Süzülen toplam", value: formatEUR(listedTotal) },
              { label: "Kayıt", value: `${expenses.length} harcama` },
            ]}
          />
          {/* Süzgeç bağlamdır: başlık ve toplamlarla aynı yerde durur. */}
          <HeaderPills>
            <HeaderPill
              value={memberFilter ?? ""}
              options={[
                { value: "", label: "Herkes", icon: "people", hint: `${members.length} kişi` },
                ...members.map((m) => ({
                  value: m.user_id, label: m.name.split(" ")[0],
                  icon: "person", hint: m.name,
                })),
              ]}
              onSelect={(v) => setMemberFilter(v || undefined)}
              testID="filter-member"
            />
            <HeaderPill
              value={selectedPeriod || activePeriodId || ""}
              options={periods.map((p, i) => ({
                value: p.period_id,
                label: periodLabel(p),
                hint: periodHint(p, i, periods.length),
                icon: p.status === "active" ? "flash" : "archive-outline",
                iconAccent: p.status === "active",
              }))}
              onSelect={(v) => setSelectedPeriod(v === activePeriodId ? undefined : v)}
              testID="filter-period"
            />
          </HeaderPills>
        </ScreenHeader>

        <Sheet>
          <View style={styles.scroll}>

          {currentPeriodId !== activePeriodId && (
            <View style={styles.archivedBanner} testID="archived-banner">
              <Ionicons name="archive-outline" size={16} color={colors.accentDark} />
              <Text style={styles.archivedTxt}>Kapatılmış dönem görüntüleniyor</Text>
            </View>
          )}

          {loading ? (
            <ActivityIndicator color={colors.dark} style={{ marginTop: spacing.xl }} />
          ) : expenses.length === 0 ? (
            <View style={styles.empty} testID="expenses-empty">
              <View style={styles.emptyRing}>
                <Ionicons name="file-tray-outline" size={30} color={colors.inkTertiary} />
              </View>
              <Text style={styles.emptyTitle}>Bu dönemde harcama yok</Text>
            </View>
          ) : (
            <Card title="Tüm Harcamalar">
              {expenses.map((e, idx) => {
                const author = members.find((m) => m.user_id === e.added_by);
                const targetChip = splitBadge(e, members, user?.user_id);
                const expanded = expandedId === e.expense_id;
                return (
                  <View key={e.expense_id}>
                    {idx > 0 && <Divider />}
                    <Pressable
                      onPress={() => setExpandedId(expanded ? null : e.expense_id)}
                      testID={`expense-item-${e.expense_id}`}
                      android_ripple={{ color: colors.divider }}
                    >
                      <View style={styles.expRow}>
                        <Avatar
                          name={author?.name || "?"}
                          avatarId={(author as any)?.avatar_id}
                          userId={author?.user_id}
                          photoVersion={(author as any)?.photo_version}
                        />
                        <View style={{ flex: 1, gap: 3 }}>
                          <View style={styles.titleRow}>
                            {/* Who paid goes in the title; the merchant lives in the
                                coloured badge. They used to both show the merchant. */}
                            <Text style={styles.expTitle} numberOfLines={1}>
                              {author?.name || "Bilinmeyen"}
                            </Text>
                            {e.merchant
                              ? <MerchantBadge name={e.merchant} />
                              : <Text style={styles.expSubtle}>
                                  {e.category || (e.source === "receipt" ? "Fiş" : "Manuel")}
                                </Text>}
                          </View>
                          <View style={styles.metaRow}>
                            <Tag label={targetChip.txt} tint={targetChip.bg} color={targetChip.color} />
                            {e.expense_date && (
                              <Text style={styles.expSubtle}>· {formatDateTR(e.expense_date)}</Text>
                            )}
                          </View>
                        </View>
                        <Money value={e.total} />
                      </View>
                    </Pressable>

                    {expanded && (
                      <View style={styles.expDetails}>
                        {(e.items || []).map((it, i) => (
                          <View key={i} style={styles.itemRow}>
                            <CategoryIcon category={it.category} size={30} />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.itemName} numberOfLines={1}>{it.name}</Text>
                              {(it.quantity || 1) !== 1 && (
                                <Text style={styles.itemQty}>{formatQty(it.quantity, it.unit)} × {formatEUR(it.price)}</Text>
                              )}
                            </View>
                            <Text style={styles.itemPrice}>{formatEUR((it.quantity || 1) * it.price)}</Text>
                          </View>
                        ))}
                        {e.notes && <Text style={styles.notes}>💬 {e.notes}</Text>}
                        {e.added_by === user?.user_id && (
                          <View style={styles.ownerActions}>
                            <Pressable
                              style={styles.editBtn}
                              onPress={() => router.push({ pathname: "/expense-edit", params: { expenseId: e.expense_id } })}
                              testID={`edit-expense-${e.expense_id}`}
                            >
                              <Ionicons name="create-outline" size={14} color={colors.dark} />
                              <Text style={styles.editTxt}>Düzenle</Text>
                            </Pressable>
                            <Pressable style={styles.deleteBtn} onPress={() => onDelete(e.expense_id)} testID={`delete-expense-${e.expense_id}`}>
                              <Ionicons name="trash-outline" size={14} color={colors.negative} />
                              <Text style={styles.deleteTxt}>Sil</Text>
                            </Pressable>
                          </View>
                        )}
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
  page: { backgroundColor: colors.bg, flexGrow: 1 },
  scroll: { padding: spacing.lg, paddingTop: spacing.sm, gap: metrics.cardGap, paddingBottom: spacing.xxxl },
  groupLabel: { ...overline, marginTop: spacing.xs },
  chipRow: { gap: spacing.sm, alignItems: "center", paddingRight: spacing.lg },
  archivedBanner: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.accentSoft,
    borderRadius: radius.md, padding: spacing.md,
  },
  archivedTxt: { ...T.bodySb, color: colors.accentDark },
  empty: { alignItems: "center", paddingVertical: spacing.xxxl, gap: spacing.md },
  emptyRing: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, alignItems: "center", justifyContent: "center",
  },
  emptyTitle: { ...T.body, color: colors.inkSecondary },
  expRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  expTitle: { ...T.bodySb, color: colors.ink },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  expSubtle: { ...T.caption, color: colors.inkTertiary },
  expDetails: {
    backgroundColor: colors.surfaceAlt, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md,
  },
  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  itemName: { ...T.body, color: colors.ink },
  itemQty: { ...T.caption, color: colors.inkTertiary, marginTop: 1 },
  itemPrice: { ...T.bodySb, color: colors.ink, fontVariant: ["tabular-nums"] },
  notes: { ...T.caption, color: colors.inkSecondary, fontStyle: "italic" },
  ownerActions: { flexDirection: "row", gap: spacing.sm },
  editBtn: {
    flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md,
    paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  editTxt: { ...T.captionSb, color: colors.dark },
  deleteBtn: {
    flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start",
    paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill,
    backgroundColor: colors.negativeSoft,
  },
  deleteTxt: { ...T.captionSb, color: colors.negative },
});
