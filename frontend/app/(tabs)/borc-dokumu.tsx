/** Borç dökümü — bakiyenin AY AY nereden geldiği.
 *
 *  ### Neden kişi bazlı değil
 *
 *  Köprüdeki herhangi bir satıra dokunulduğunda buraya gelinir ama sayfa
 *  "Salih'e olan borcun" demez, **senin bakiyeni** dökümler. Sebebi
 *  sadeleştirme: `simplify_debts` her seferinde kimin kime ödeyeceğini
 *  yeniden hesaplıyor, yani "Temmuz'dan Salih'e 18 €" diye bir şey yok —
 *  Ağustos'un harcamaları girince o borç Ayşe'ye ödenecek hale gelebilir.
 *  Kişi bazlı döküm kurgu olurdu.
 *
 *  ### Ay bazlı döküm ise kurgu DEĞİL
 *
 *  Her ayın satırı *o ay bakiyenin ne kadar değiştiği*. Dayandığı kimlik
 *  uygulamanın omurgası: **ödediğin − sana düşen = bakiyen**. Aylık farkların
 *  toplamı bugünkü bakiyeyi verir, yani FIFO gerekmiyor.
 *
 *  Dil buna göre kuruldu: "Haziran'dan kalan 48 €" kurgudur — hangi euro'nun
 *  kaldığı bilinemez. **"Haziran'da 48 € borçlandın"** olgudur.
 */
import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { apiGet } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, Sheet, Card, Divider, Money, formatEUR, ayAdi, useScrollPad,
} from "@/src/ui";
import { colors, spacing, radius, type as T, overline, fontFamily, metrics } from "@/src/theme";

type Hareket = { tur: string; tutar: number; artiran: boolean };
/** Hareket türlerinin ekrandaki adı. Sunucu yalnızca anahtar gönderiyor. */
const TUR_ADI: Record<string, string> = {
  pay: "Ev alışverişlerindeki payın",
  ev_odedigin: "Senin ödediğin ev alışverişleri",
  baskasi_icin: "Başkası için aldıkların",
  senin_icin: "Senin için alınanlar",
  odemelerin: "Ödediklerin",
  sana_odenen: "Sana ödenenler",
};
type EkstreAy = {
  month: string; share: number; paid: number; delta: number; lines?: Hareket[];
};
type Ekstre = { months: EkstreAy[]; carried: number; current_month: string };
type Harcama = {
  expense_id: string; merchant?: string | null; total: number;
  my_share?: number; expense_date?: string; added_by: string;
  split_with?: Record<string, number> | null;
};

export default function BorcDokumu() {
  const router = useRouter();
  const { user } = useAuth();
  const { members } = useHousehold();
  const isim = (id: string) => (id === user?.user_id ? "Sen"
    : (members.find((m) => m.user_id === id)?.name || "?").split(" ")[0]);
  const altPay = useScrollPad({ tabs: true });
  const [ekstre, setEkstre] = useState<Ekstre | null>(null);
  const [net, setNet] = useState(0);
  const [loading, setLoading] = useState(true);
  /** Bulunduğun ay açık gelir, geçmiş aylar tek satıra kapanır. */
  const [acik, setAcik] = useState<string | null>(null);
  /** Ay → o ayın harcamaları. Açıldığında bir kez çekiliyor. */
  const [harcamalar, setHarcamalar] = useState<Record<string, Harcama[]>>({});

  const ayiAc = useCallback(async (ay: string) => {
    if (harcamalar[ay]) return;
    try {
      const r = await apiGet<{ expenses: Harcama[] }>(`/expenses?month=${ay}`);
      // Eskiden yeniye: kadro değişimi başlığı kronolojik okunmalı.
      const dizi = [...(r.expenses || [])].sort((a, b) =>
        (a.expense_date || "").localeCompare(b.expense_date || ""));
      setHarcamalar((h) => ({ ...h, [ay]: dizi }));
    } catch (e) { console.log(e); }
  }, [harcamalar]);

  const load = useCallback(async () => {
    try {
      const bal = await apiGet<any>("/balances");
      const st: Ekstre | null = bal.statement || null;
      setEkstre(st);
      setNet(bal.net?.[user?.user_id || ""] ?? 0);
      if (st) { setAcik(st.current_month); ayiAc(st.current_month); }
    } catch (e) { console.log(e); }
    finally { setLoading(false); }
  }, [user?.user_id, ayiAc]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const alacakli = net > 0.005;
  const borc = Math.abs(net);
  // Eskiden yeniye: hikâye kronolojik okunuyor, toplam en altta çıkıyor.
  const aylar = [...(ekstre?.months || [])].sort((a, b) => a.month.localeCompare(b.month));

  return (
    <View style={styles.root} testID="borc-dokumu-screen">
      <ScrollView contentContainerStyle={[styles.page, altPay]} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          overline={alacakli ? "ALACAĞIN" : "BORCUN"}
          title="Nereden Geliyor"
          right={
            <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headBtn}
                       testID="dokum-back">
              <Ionicons name="close" size={20} color={colors.onDark} />
            </Pressable>
          }
        >
          <View style={styles.heroRow}>
            <Text style={styles.heroLabel}>
              {aylar.length > 1 ? `${aylar.length} aydır ödeşilmedi` : "Bu ay"}
            </Text>
            <Text style={[styles.heroValue,
                          { color: alacakli ? colors.accentOnDark : colors.negativeOnDark }]}>
              {formatEUR(borc)}
            </Text>
          </View>
        </ScreenHeader>

        <Sheet>
          {loading ? (
            <ActivityIndicator color={colors.ink} style={{ marginTop: spacing.xxl }} />
          ) : aylar.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="checkmark-circle-outline" size={38} color={colors.inkTertiary} />
              <Text style={styles.emptyTitle}>Dökülecek bir şey yok</Text>
              <Text style={styles.emptyDesc}>Ödeşilmemiş bir hareket bulunmuyor.</Text>
            </View>
          ) : (
            <Card style={styles.mx}>
              {aylar.map((a, i) => {
                const bu = a.month === ekstre?.current_month;
                const acikMi = acik === a.month;
                // Borçluda `delta` pozitifse borç arttı; alacaklıda ters.
                const artis = alacakli ? -a.delta : a.delta;
                return (
                  <View key={a.month}>
                    {i > 0 && <Divider inset={spacing.lg} />}
                    <Pressable style={styles.ayRow} onPress={() => { const y = acikMi ? null : a.month; setAcik(y); if (y) ayiAc(y); }}
                               testID={`dokum-ay-${a.month}`}>
                      <Text style={[styles.ayAd, bu && styles.ayAdBu]}>
                        {ayAdi(a.month).split(" ")[0]}
                      </Text>
                      {/* Yesil = borcu DUSUREN ay. O ay odediklerin
                          borclandiklarindan fazlaysa satir eksiye donuyor. */}
                      <Text style={[styles.ayDelta, artis < 0 && styles.ayDeltaEksi]}>
                        {artis >= 0 ? "+" : "−"}{formatEUR(Math.abs(artis))}
                      </Text>
                      <Ionicons name={acikMi ? "chevron-down" : "chevron-forward"}
                                size={15} color={colors.onSurfaceTertiary} />
                    </Pressable>

                    {acikMi && (
                      <View style={styles.detay}>
                        {/* Kart hareketi gibi: her satırın bir SEBEBİ var.
                            "Ödediklerin" tek satırken içinde birbirinden çok
                            farklı üç şey vardı — ev alışverişinde fatura
                            ödediklerin, biri İÇİN aldıkların, kaydettiğin
                            ödemeler. Toplanınca "bu para nereye gitti"
                            cevapsız kalıyordu.

                            İşaret kuralı tek: artı borcu artırır, eksi
                            azaltır. "Kemal için aldıkların −12,00" satırı en
                            çok merak edilen soruyu kapatıyor — o parayı
                            ayrıca almana gerek yok, düşüm burada oldu. */}
                        {(a.lines || []).map((l) => (
                          <View key={l.tur} style={styles.detayRow}>
                            <Text style={styles.detayLabel}>{TUR_ADI[l.tur] || l.tur}</Text>
                            <Text style={[styles.detayVal, !l.artiran && styles.detayEksi]}>
                              {l.artiran ? "" : "−"}{formatEUR(l.tutar)}
                            </Text>
                          </View>
                        ))}

                        {/* O ayın fişleri. Bölüşme kadrosu değiştiği yerde
                            başlık düşüyor — dönem sınırının taşıdığı bilgi
                            zaten her harcamanın `split_with` listesinde
                            donmuş durumda, ayrı bir kayda gerek yok. */}
                        {(harcamalar[a.month] || []).map((h, hi, dizi) => {
                          const oncekiKadro = hi > 0
                            ? Object.keys(dizi[hi - 1].split_with || {}).length : -1;
                          const kadro = Object.keys(h.split_with || {}).length;
                          return (
                            <View key={h.expense_id}>
                              {kadro !== oncekiKadro && kadro > 0 && (
                                <Text style={styles.kadroBaslik}>
                                  {kadro} KİŞİ BÖLÜŞTÜ
                                </Text>
                              )}
                              <Pressable style={styles.fisRow}
                                         onPress={() => router.push(
                                           `/expense-edit?id=${h.expense_id}`)}>
                                <View style={{ flex: 1, minWidth: 0 }}>
                                  <Text style={styles.fisAd} numberOfLines={1}>
                                    {h.merchant || "Harcama"}
                                  </Text>
                                  <Text style={styles.fisAlt} numberOfLines={1}>
                                    {(h.expense_date || "").slice(8, 10)}
                                    {" "}{ayAdi(a.month).split(" ")[0]}
                                    {" · "}{isim(h.added_by)} ödedi
                                  </Text>
                                </View>
                                <View style={{ alignItems: "flex-end" }}>
                                  {/* Senin payin BUYUK, fisin tamami kucuk.
                                      Karistirilan tam olarak bu ikisiydi. */}
                                  <Money value={h.my_share ?? 0} style={styles.fisPay} />
                                  {Math.abs((h.my_share ?? 0) - h.total) > 0.005 && (
                                    <Text style={styles.fisTam}>
                                      {formatEUR(h.total)} içinde
                                    </Text>
                                  )}
                                </View>
                                <Ionicons name="chevron-forward" size={14}
                                          color={colors.onSurfaceTertiary} />
                              </Pressable>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })}

              <Divider inset={0} />
              <View style={styles.toplamRow}>
                <Text style={styles.toplamLabel}>
                  {alacakli ? "Sana ödenecek" : "Ödenecek"}
                </Text>
                <Money value={borc} style={styles.toplamVal} />
              </View>
            </Card>
          )}

          {/* Bir sonraki kat: ay satirina dokununca o ayin fisleri, oradan
              kalemler. Sunucuda yeni bir uc gerekiyor; henuz yok. */}
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
  heroRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.md, marginTop: spacing.md },
  heroLabel: { ...T.caption, color: colors.onDarkMuted, flex: 1 },
  heroValue: {
    fontSize: 27, lineHeight: 34, fontFamily: fontFamily.semibold, letterSpacing: -0.9,
  },
  mx: { marginHorizontal: spacing.lg },
  ayRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 48,
  },
  ayAd: { ...T.body, color: colors.ink, flex: 1 },
  ayAdBu: { fontFamily: fontFamily.semibold },
  ayDelta: { ...T.bodySb, fontSize: 15, color: colors.ink },
  ayDeltaEksi: { color: colors.accentDark },
  detay: {
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    marginLeft: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.divider,
  },
  detayRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 5, paddingLeft: spacing.md,
  },
  detayLabel: { ...T.caption, color: colors.inkSecondary, flex: 1 },
  detayVal: { ...T.caption, fontFamily: fontFamily.medium, color: colors.ink },
  detayEksi: { color: colors.accentDark },
  toplamRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  toplamLabel: { ...T.body, color: colors.inkSecondary, flex: 1 },
  toplamVal: { ...T.emph, fontSize: 17, color: colors.ink },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xl },
  kadroBaslik: {
    ...overline, fontSize: 10, color: colors.inkTertiary,
    marginTop: spacing.md, marginBottom: 2, paddingLeft: spacing.md,
  },
  fisRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingVertical: 7, paddingLeft: spacing.md,
  },
  fisAd: { ...T.caption, fontFamily: fontFamily.medium, color: colors.ink },
  fisAlt: { ...T.caption, fontSize: 11, color: colors.inkTertiary },
  fisPay: { ...T.caption, fontFamily: fontFamily.semibold, color: colors.ink },
  fisTam: { ...T.caption, fontSize: 10, color: colors.inkTertiary },
  emptyTitle: { ...T.emph, color: colors.ink },
  emptyDesc: { ...T.caption, color: colors.inkTertiary, textAlign: "center" },
});
