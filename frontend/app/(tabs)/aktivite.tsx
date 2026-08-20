/** Aktivite — ben yokken evde ne oldu.
 *
 *  Bildirim gelip kaçırıldığında geriye bakacak bir yer yoktu. Telefonu
 *  kapalı olan ya da bildirimleri kapatmış biri olan bitenden habersiz
 *  kalıyordu. Kayıt push'tan bağımsız tutuluyor: push kaybolur, kayıt kalır.
 *
 *  Liste bir DUYURU PANOSUYDU: birikiyordu, silinemiyordu ve satıra dokunmak
 *  hiçbir şey yapmıyordu. Üçü de aynı kusurun yüzleriydi — kayıt bir olayı
 *  anlatıyor ama olayın kendisine götürmüyordu. Artık her satır bir kapı
 *  (`bildirimYolu`), sola kaydırınca siliniyor, okunmuşlar topluca
 *  temizlenebiliyor.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiGet, apiPost, apiDelete } from "@/src/api";
import {
  Card, Divider, Overline, ScreenHeader, Sheet, IconPill, useScrollPad, yenileme,
  KaydirSil, GeriAlSeridi, KaydirmaIpucu, useKaydirmaIpucu,
} from "@/src/ui";
import { bildirimYolu } from "@/src/bildirimYolu";
import { colors, spacing, type as T, metrics } from "@/src/theme";

type Notification = {
  notification_id: string;
  title: string;
  body: string;
  kind: string;
  read: boolean;
  created_at: string;
  /** Sunucunun yazdığı bağlam — satırın nereye gittiğini bu belirliyor. */
  data?: Record<string, unknown> | null;
};

// Bildirim türüne göre simge — hangi tür olduğunu okumadan anlamak için.
// Satırlar artık birer kapı olduğu için eksik türler de dolduruldu: ödeme
// bildirimine fiş simgesi koymak, dokunulunca gidilen yerle çelişiyordu.
const KIND_ICON: Record<string, { icon: string; color: string; tint: string }> = {
  new_expense:   { icon: "receipt-outline",    color: colors.inkSecondary, tint: colors.surfaceSecondary },
  expense_edit:  { icon: "create-outline",     color: colors.inkSecondary, tint: colors.surfaceSecondary },
  settlement:    { icon: "swap-horizontal",    color: colors.accentDark,  tint: colors.accentSoft },
  recurring:     { icon: "repeat",             color: colors.inkSecondary, tint: colors.surfaceSecondary },
  member_left:   { icon: "person-remove-outline", color: colors.onInfo,   tint: colors.infoSoft },
  join_request:  { icon: "person-add-outline", color: colors.onInfo,      tint: colors.infoSoft },
  period_closed: { icon: "checkmark-done",     color: colors.accentDark,  tint: colors.accentSoft },
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

  /* Silme İYİMSER: satır hemen gidiyor, ağ arkadan yetişiyor. Bildirim
     KİŞİYE ait bir kayıt — aynı olay için herkesin kendi satırı var — yani
     silmek paylaşılan hiçbir şeyi bozmuyor ve onay sormaya değmiyor.
     (Alınacaklar'da tersi geçerli olurdu: orada ev arkadaşının yazdığı bir
     madde siliniyor.) */
  /* Alınacaklar'daki jestin AYNISI — tam kaydırma siler, geri alma şeridi
     beş saniye açık kalır. İki ekranda aynı jestin farklı davranması,
     kullanıcının "kaydırmak ne yapar" bilgisini ekrana bağımlı kılardı ve o
     bilgi bir daha güvenilir olmazdı.

     Silme sunucuya GECİKMELİ gidiyor: geri alma yeniden yaratmak zorunda
     kalsaydı bildirimin kimliği ve okunma durumu değişirdi. */
  const geriAlSayaci = useRef<any>(null);
  const [silinen, setSilinen] = useState<Notification | null>(null);

  const gercektenSil = async (n: Notification) => {
    try { await apiDelete(`/notifications/${n.notification_id}`); } catch { load(); }
  };

  const sil = (n: Notification) => {
    setRows((cur) => cur.filter((r) => r.notification_id !== n.notification_id));
    if (geriAlSayaci.current) {
      clearTimeout(geriAlSayaci.current);
      if (silinen) gercektenSil(silinen);
    }
    setSilinen(n);
    geriAlSayaci.current = setTimeout(() => {
      geriAlSayaci.current = null;
      setSilinen(null);
      gercektenSil(n);
    }, 5000);
  };

  const geriAl = () => {
    if (geriAlSayaci.current) { clearTimeout(geriAlSayaci.current); geriAlSayaci.current = null; }
    const geri = silinen;
    setSilinen(null);
    if (!geri) return;
    // Sıra bozulmasın diye listenin kendi sıralaması yeniden uygulanıyor:
    // bildirimler yeniden eskiye ve geri gelen satır ortaya dönmeli.
    setRows((cur) => (cur.some((r) => r.notification_id === geri.notification_id)
      ? cur
      : [...cur, geri].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))));
  };

  useEffect(() => () => {
    if (geriAlSayaci.current) { clearTimeout(geriAlSayaci.current); }
  }, []);

  /* Topluca temizleme yalnızca OKUNMUŞLARI siliyor. Bu ekran açılışta hepsini
     okundu işaretlediği için pratikte "ekranda gördüğün her şey" demek; ama
     düğmeye basılana kadar gelen yeni bir bildirim hayatta kalıyor. */
  const temizle = async () => {
    const kalan = rows.filter((r) => !r.read);
    setRows(kalan);
    try { await apiPost("/notifications/clear-read", {}); } catch { load(); }
  };

  const ipucuOyna = useKaydirmaIpucu("aktivite", rows.length > 0);

  return (
    <View style={styles.root} testID="aktivite-screen">
      <ScrollView
        contentContainerStyle={[styles.page, altPay]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl {...yenileme(refreshing, () => { setRefreshing(true); load(); })} />
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
              <View style={{ gap: spacing.sm }}>
                <View style={styles.head}>
                  <Overline>{rows.length} BİLDİRİM</Overline>
                  <Pressable onPress={temizle} hitSlop={10} testID="aktivite-clear">
                    <Text style={styles.clear}>Temizle</Text>
                  </Pressable>
                </View>

                <Card>
                  {rows.map((n, i) => {
                    const k = KIND_ICON[n.kind] || KIND_ICON.new_expense;
                    /* Satır nereye gidiyor? Cevabı `null` ise satır DOKUNULAMAZ
                       ve okunu da yok — hiçbir yere götürmeyen bir ok yalan
                       söyler. Geri tuşu Aktivite'ye dönsün diye `geri` veriliyor. */
                    const hedef = bildirimYolu(n.kind, n.data, "/aktivite");
                    const govde = (
                      <View style={[styles.row, !n.read && styles.rowUnread]}>
                        <IconPill name={k.icon} color={k.color} tint={k.tint} size={metrics.icon} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.title}>{n.title}</Text>
                          <Text style={styles.body}>{n.body}</Text>
                        </View>
                        <Text style={styles.time}>{relative(n.created_at)}</Text>
                        {hedef ? (
                          <Ionicons name="chevron-forward" size={16}
                                    color={colors.onSurfaceTertiary}
                                    style={{ marginLeft: spacing.xs }} />
                        ) : null}
                      </View>
                    );
                    return (
                      <View key={n.notification_id}>
                        {i > 0 && <Divider />}
                        <KaydirmaIpucu oyna={i === 0 && ipucuOyna}>
                          <KaydirSil onSil={() => sil(n)}
                                     testID={`aktivite-del-${n.notification_id}`}>
                            {hedef ? (
                              <Pressable onPress={() => router.push(hedef as any)}
                                         android_ripple={{ color: colors.divider }}
                                         testID={`aktivite-item-${n.notification_id}`}>
                                {govde}
                              </Pressable>
                            ) : (
                              <View testID={`aktivite-item-${n.notification_id}`}>{govde}</View>
                            )}
                          </KaydirSil>
                        </KaydirmaIpucu>
                      </View>
                    );
                  })}
                </Card>

                {/* Kendiliğinden silinme SESSİZ olmasın: kullanıcı bir gün
                    geriye bakıp "buradaki kayıtlar nereye gitti" demesin. */}
                <Text style={styles.dipnot}>
                  Okunmuş bildirimler 30 gün sonra kendiliğinden siliniyor.
                </Text>
              </View>
            )}
          </View>
        </Sheet>
      </ScrollView>
      <GeriAlSeridi
        gorunur={!!silinen}
        metin="Bildirim silindi"
        onGeriAl={geriAl}
        testID="aktivite-geri-al"
      />
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
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  clear: { ...T.captionSb, color: colors.accent },
  dipnot: {
    ...T.caption, color: colors.inkTertiary, textAlign: "center",
    marginTop: spacing.sm,
  },
  empty: { alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.md },
  emptyRing: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, alignItems: "center", justifyContent: "center",
  },
  emptyTxt: { ...T.body, color: colors.inkSecondary },
});
