/** Arama — ürün · market · kişi · ekran, **bütün geçmişte.**
 *
 *  Uygulamanın her ekranı takvim ayına kilitli. "Sütü en son ne zaman aldık,
 *  kaça?" sorusunun bugüne kadar cevabı yoktu: kullanıcı ayları tek tek
 *  gezmek zorundaydı ve 49 ürün 400 olduğunda bu imkânsızlaşıyor. Bu ekranın
 *  varlık sebebi **ayı aşması** — bu yüzden her satır bir zaman aralığı
 *  taşıyor ("Mart – Ağustos"), tek bir ay değil.
 *
 *  Ekranlar da aranıyor (`uygulamaHaritasi`): "iban" yazan biri Ödeme
 *  bilgilerim'e gidiyor. Ağaç yeterince derinleşince hiçbir gruplama
 *  herkesin zihnine uymaz; arama taksonomi tartışmasını bitirir.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator,
  Keyboard,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { apiGet } from "@/src/api";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, Sheet, Card, Row, Divider, Overline, Avatar, IconPill,
  MerchantBadge, Money, useScrollPad, useGeriDon, ayAdi,
} from "@/src/ui";
import { uygulamaAra, type UygulamaKaydi } from "@/src/uygulamaHaritasi";
import { colors, spacing, radius, type as T, metrics } from "@/src/theme";

type Urun = {
  key: string; name: string; total: number; count: number;
  market_count: number; qty?: number | null; unit?: string | null;
  first_month?: string | null; last_month?: string | null;
  sira?: number;
};
type Market = {
  key: string; name: string; total: number; receipts: number;
  first_month?: string | null; last_month?: string | null;
  sira?: number;
};
type Kisi = { user_id: string; name: string };
type Sonuc = { products: Urun[]; merchants: Market[]; members: Kisi[] };

const SON_ARAMALAR = "kasa.arama.son";
const SON_SINIR = 6;

/** `2026-03` + `2026-08` → "Mart – Ağustos". Aynı aysa tek ad. */
const araligi = (ilk?: string | null, son?: string | null) => {
  if (!ilk || !son) return "";
  const a = ayAdi(ilk).split(" ")[0];
  const b = ayAdi(son).split(" ")[0];
  if (ilk === son) return ayAdi(son);
  // Yıl ancak farklıysa yazılıyor: "Mart – Ağustos" okunur, "Mart 2026 –
  // Ağustos 2026" satırı şişirip hiçbir şey eklemiyor.
  return ilk.slice(0, 4) === son.slice(0, 4) ? `${a} – ${b}` : `${ayAdi(ilk)} – ${ayAdi(son)}`;
};

export default function Arama() {
  const altPay = useScrollPad({ tabs: true, extra: 0 });
  const router = useRouter();
  const geriDon = useGeriDon();
  const { members } = useHousehold();
  const [q, setQ] = useState("");
  const [sonuc, setSonuc] = useState<Sonuc | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [gecmis, setGecmis] = useState<string[]>([]);
  const girdi = useRef<TextInput>(null);

  useEffect(() => {
    AsyncStorage.getItem(SON_ARAMALAR)
      .then((v) => { if (v) setGecmis(JSON.parse(v)); })
      .catch(() => {});
    // Ekran arama için açıldı; klavyeyi beklemek bir dokunuş fazla.
    const t = setTimeout(() => girdi.current?.focus(), 350);
    return () => clearTimeout(t);
  }, []);

  const gecmiseYaz = useCallback((kelime: string) => {
    const k = kelime.trim();
    if (k.length < 2) return;
    setGecmis((cur) => {
      const yeni = [k, ...cur.filter((x) => x.toLowerCase() !== k.toLowerCase())]
        .slice(0, SON_SINIR);
      AsyncStorage.setItem(SON_ARAMALAR, JSON.stringify(yeni)).catch(() => {});
      return yeni;
    });
  }, []);

  /* ANLIK sonuç, "Ara" düğmesi YOK.
     Arama bir avlanma işi: insan yazıyor, gelen sonuca bakıyor, kelimeyi
     düzeltiyor. Düğme her denemeyi bir taahhüde çevirir ve insanlar iki
     denemeden sonra vazgeçer. 250 ms bekleme, her harfte istek atmamak için
     — yazarken ağın altında kalan bir liste titrer gibi görünüyor. */
  useEffect(() => {
    const kelime = q.trim();
    if (kelime.length < 2) { setSonuc(null); setYukleniyor(false); return; }
    setYukleniyor(true);
    const t = setTimeout(async () => {
      try {
        const r = await apiGet<Sonuc>(`/search?q=${encodeURIComponent(kelime)}`);
        setSonuc(r);
      } catch { setSonuc(null); }
      finally { setYukleniyor(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const ekranlar: UygulamaKaydi[] = uygulamaAra(q);
  const bosSonuc = !!sonuc && !yukleniyor
    && sonuc.products.length === 0 && sonuc.merchants.length === 0
    && sonuc.members.length === 0 && ekranlar.length === 0;

  /* Sunucu bir harflik yazım hatasını affediyor ama bunu SESSİZCE yapmıyor.
     Tam eşleşen tek bir sonuç bile varsa uyarı yok — üstteki satır zaten
     aradığı şey. Uyarı yalnızca ekrandaki HER ŞEY yaklaşıksa çıkıyor:
     o zaman kullanıcının gördüğü liste, yazdığı kelimenin listesi değil ve
     bunu söylememek onu yanlış ürünü doğru sanmaya bırakır. */
  const yaklasik = !!sonuc
    && (sonuc.products.length > 0 || sonuc.merchants.length > 0)
    && [...sonuc.products, ...sonuc.merchants].every((x) => x.sira === 5);

  const uye = (id: string) => members.find((m) => m.user_id === id);

  const git = (yol: string) => { gecmiseYaz(q); Keyboard.dismiss(); router.push(yol as any); };

  return (
    <View style={styles.root} testID="arama-screen">
      <ScrollView contentContainerStyle={[styles.page, altPay]}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled">
        <ScreenHeader
          overline="ARA"
          title="Ne arıyorsun?"
          right={
            <Pressable onPress={geriDon} hitSlop={12} style={styles.headBtn}
                       testID="arama-back">
              <Ionicons name="close" size={20} color={colors.onDark} />
            </Pressable>
          }
        >
          <View style={styles.kutu}>
            <Ionicons name="search" size={16} color={colors.onDarkMuted} />
            <TextInput
              ref={girdi}
              style={styles.girdi}
              value={q}
              onChangeText={setQ}
              placeholder="Süt, REWE, Kemal, IBAN…"
              placeholderTextColor={colors.onDarkMuted}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              onSubmitEditing={() => gecmiseYaz(q)}
              testID="arama-input"
            />
            {q.length > 0 && (
              <Pressable onPress={() => setQ("")} hitSlop={10} testID="arama-temizle">
                <Ionicons name="close-circle" size={17} color={colors.onDarkMuted} />
              </Pressable>
            )}
          </View>
        </ScreenHeader>

        <Sheet>
          <View style={styles.govde}>
            {/* HENÜZ YAZILMADI. Boş bir ekran bırakmak aramanın en sık terk
                edildiği andır; son aramalar hem bir kısayol hem de "burada ne
                aranır" dersidir. İlk kullanımda o da yok — o zaman tek satır
                ipucu kalıyor, uydurma içerik değil. */}
            {q.trim().length < 2 ? (
              gecmis.length > 0 ? (
                <View style={{ gap: spacing.sm }}>
                  <View style={styles.baslikSatir}>
                    <Overline>SON ARAMALAR</Overline>
                    <Pressable hitSlop={10} testID="arama-gecmis-sil"
                               onPress={() => {
                                 setGecmis([]);
                                 AsyncStorage.removeItem(SON_ARAMALAR).catch(() => {});
                               }}>
                      <Text style={styles.temizle}>Temizle</Text>
                    </Pressable>
                  </View>
                  <View style={styles.haplar}>
                    {gecmis.map((g) => (
                      <Pressable key={g} style={styles.hap} onPress={() => setQ(g)}
                                 testID={`arama-gecmis-${g}`}>
                        <Ionicons name="time-outline" size={13} color={colors.inkSecondary} />
                        <Text style={styles.hapTxt}>{g}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : (
                <Text style={styles.ipucu}>
                  Ürün, market, ev arkadaşı ya da uygulamanın bir ekranını ara.
                </Text>
              )
            ) : yukleniyor && !sonuc ? (
              <ActivityIndicator color={colors.ink} style={{ marginTop: spacing.xl }} />
            ) : bosSonuc ? (
              <View style={styles.bos}>
                <View style={styles.bosHalka}>
                  <Ionicons name="search-outline" size={28} color={colors.inkTertiary} />
                </View>
                <Text style={styles.bosTxt}>“{q.trim()}” için bir şey bulunamadı.</Text>
              </View>
            ) : (
              <View style={{ gap: metrics.cardGap }}>
                {yaklasik && (
                  <View style={styles.yaklasik}>
                    <Ionicons name="information-circle-outline" size={15}
                              color={colors.inkTertiary} />
                    <Text style={styles.yaklasikTxt}>
                      “{q.trim()}” tam olarak bulunamadı; yakın sonuçlar.
                    </Text>
                  </View>
                )}
                {/* ÜRÜNLER — ekranın asıl kazancı. Alt satır zaman aralığını
                    taşıyor; bunu başka hiçbir ekran veremiyor. */}
                {!!sonuc?.products.length && (
                  <View style={{ gap: spacing.sm }}>
                    <Overline>ÜRÜNLER</Overline>
                    <Card>
                      {sonuc.products.map((p, i) => (
                        <View key={p.key}>
                          {i > 0 && <Divider />}
                          <Row
                            leading={<IconPill name="basket-outline" color={colors.inkSecondary}
                                               tint={colors.surfaceSecondary} />}
                            title={p.name}
                            subtitle={[
                              p.qty && p.unit ? `${p.qty} ${p.unit}` : `${p.count} kez`,
                              p.market_count > 1 ? `${p.market_count} markette` : null,
                              araligi(p.first_month, p.last_month),
                            ].filter(Boolean).join(" · ")}
                            right={<Money value={p.total} />}
                            chevron
                            onPress={() => git(
                              `/urun?key=${encodeURIComponent(p.key)}&ad=${encodeURIComponent(p.name)}&geri=/arama`)}
                            testID={`arama-urun-${p.key}`}
                          />
                        </View>
                      ))}
                    </Card>
                  </View>
                )}

                {!!sonuc?.merchants.length && (
                  <View style={{ gap: spacing.sm }}>
                    <Overline>MARKETLER</Overline>
                    <Card>
                      {sonuc.merchants.map((m, i) => (
                        <View key={m.key}>
                          {i > 0 && <Divider />}
                          <Row
                            leading={<MerchantBadge name={m.name} />}
                            title={m.name}
                            subtitle={[
                              `${m.receipts} fiş`,
                              araligi(m.first_month, m.last_month),
                            ].filter(Boolean).join(" · ")}
                            right={<Money value={m.total} />}
                            chevron
                            /* Market sayfası AY bazlı; ürün sayfası gibi tüm
                               zamanı gösteremiyor. En son göründüğü aya
                               açılıyor — "en son ne aldık" en olası niyet ve
                               sayfanın kendi ay seçicisi var. */
                            onPress={() => git(
                              `/(tabs)/market?key=${encodeURIComponent(m.key)}`
                              + `&ad=${encodeURIComponent(m.name)}`
                              + `&ay=${m.last_month || ""}&geri=/arama`)}
                            testID={`arama-market-${m.key}`}
                          />
                        </View>
                      ))}
                    </Card>
                  </View>
                )}

                {!!sonuc?.members.length && (
                  <View style={{ gap: spacing.sm }}>
                    <Overline>KİŞİLER</Overline>
                    <Card>
                      {sonuc.members.map((k, i) => (
                        <View key={k.user_id}>
                          {i > 0 && <Divider />}
                          <Row
                            leading={<Avatar name={k.name}
                                             avatarId={(uye(k.user_id) as any)?.avatar_id}
                                             userId={k.user_id}
                                             photoVersion={(uye(k.user_id) as any)?.photo_version} />}
                            title={k.name}
                            subtitle="Bu ayki harcama dökümü"
                            chevron
                            onPress={() => git(
                              `/(tabs)/member-detail?memberId=${k.user_id}&geri=/arama`)}
                            testID={`arama-kisi-${k.user_id}`}
                          />
                        </View>
                      ))}
                    </Card>
                  </View>
                )}

                {/* UYGULAMA en SONDA. Veri aramak sık, ekran aramak nadir;
                    ama "iban" yazıldığında yukarıdaki bölümler zaten boş
                    kalacağı için bu tek görünen olacak. Sıralama mantığı
                    yazmaya gerek yok — boşluk işi kendi hallediyor. */}
                {ekranlar.length > 0 && (
                  <View style={{ gap: spacing.sm }}>
                    <Overline>UYGULAMA</Overline>
                    <Card>
                      {ekranlar.map((e, i) => (
                        <View key={e.rota}>
                          {i > 0 && <Divider />}
                          <Row
                            leading={<IconPill name={e.icon} color={colors.onInfo}
                                               tint={colors.infoSoft} />}
                            title={e.ad}
                            subtitle={e.alt}
                            chevron
                            onPress={() => git(e.rota)}
                            testID={`arama-ekran-${e.rota}`}
                          />
                        </View>
                      ))}
                    </Card>
                  </View>
                )}
              </View>
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
  kutu: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.darkSurface, borderRadius: radius.pill,
    paddingHorizontal: spacing.lg, height: 44, marginTop: spacing.md,
  },
  girdi: { flex: 1, ...T.body, color: colors.onDark, padding: 0 },
  govde: { padding: spacing.lg, gap: metrics.cardGap },
  baslikSatir: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  temizle: { ...T.captionSb, color: colors.accent },
  haplar: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  hap: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 7,
  },
  hapTxt: { ...T.caption, color: colors.ink },
  ipucu: { ...T.caption, color: colors.inkTertiary, textAlign: "center", marginTop: spacing.xl, lineHeight: 19 },
  bos: { alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.md },
  bosHalka: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, alignItems: "center", justifyContent: "center",
  },
  yaklasik: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  yaklasikTxt: { ...T.caption, color: colors.inkTertiary, flex: 1 },
  bosTxt: { ...T.body, color: colors.inkSecondary, textAlign: "center" },
});
