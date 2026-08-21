/** Alınacaklar — Ev (herkes görür) ve Kendim (sadece sen). */
import { useCallback, useEffect, useRef, useState } from "react";
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
  animateNextLayout, useScrollPad, useBasaSar, yenileme, formatEUR,
  KaydirSil, GeriAlSeridi, KaydirmaIpucu, useKaydirmaIpucu,
} from "@/src/ui";
import { colors, spacing, radius, type as T, metrics } from "@/src/theme";

type Scope = "household" | "self";

/** `2026-08-18` → "bugün" · "dün" · "3 gün önce" · "18 Ağustos".
 *  Yakın günler ADLARIYLA: "2 gün önce" bir tarihten daha hızlı okunuyor. */
const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
               "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
function gunFarki(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  const bugun = new Date();
  const fark = Math.round(
    (new Date(bugun.getFullYear(), bugun.getMonth(), bugun.getDate()).getTime()
      - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  if (fark <= 0) return "bugün";
  if (fark === 1) return "dün";
  if (fark < 7) return `${fark} gün önce`;
  return `${d.getDate()} ${AYLAR[d.getMonth()]}`;
}

type Item = {
  item_id: string; text: string; scope: Scope; added_by: string;
  done: boolean; done_by?: string | null;
  /** Evin KENDİ geçmişinden fiyat ipucu — yalnızca bu madde daha önce
   *  alındıysa gelir. Sunucu görünürlük süzgecinden geçiriyor: başkasının
   *  kişisel harcamasından gelen bir fiyat, o harcamanın varlığını
   *  sızdırırdı. */
  last_price?: number | null;
  last_merchant?: string | null;
};
/** En son alışveriş — kapsama göre (Ev sekmesinde evin, Kendim'de senin). */
type SonAlisveris = { day: string; merchant?: string | null } | null;
/** Öneri kaynağı satırın rengini belirliyor — hangisinin nereden geldiği
 *  görünmeli: "geçmiş" evin kendi verisi, "temel" hiç alınmamış ama her evde
 *  lazım olan, "esanlamli" yazdığından BAŞKA bir ada götüren. */
type Oneri = { name: string; source: "gecmis" | "temel" | "esanlamli" };

export default function Liste() {
  // Sekme cubugunun ve telefonun gezinme cubugunun kapladigi yer.
  // Elle yazilan 120/130 sabitleri cubuk yuksekligiyle birlikte
  // degismiyordu; olcu artik tek yerden geliyor.
  const altPay = useScrollPad({ tabs: true });
  const scrollRef = useRef<ScrollView>(null);
  useBasaSar(scrollRef);
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
  const [sonAlisveris, setSonAlisveris] = useState<SonAlisveris>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ items: Item[]; last_shopping: SonAlisveris }>(
        `/shopping?scope=${scope}`);
      setItems(res.items || []);
      setSonAlisveris(res.last_shopping ?? null);
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
    animateNextLayout();
    const next = !item.done;
    setItems((cur) => cur.map((i) => (i.item_id === item.item_id ? { ...i, done: next } : i)));
    try {
      await api(`/shopping/${item.item_id}`, { method: "PATCH", body: JSON.stringify({ done: next }) });
      await load();
    } catch {
      setItems((cur) => cur.map((i) => (i.item_id === item.item_id ? { ...i, done: !next } : i)));
    }
  };

  /* SİLME SUNUCUYA GECİKMELİ GİDİYOR — geri almanın gerçekten geri alması
     için. Hemen silip geri alırken yeniden yaratsaydık satırın kimliği
     değişirdi; başkasının ekranında satır kaybolup yeniden belirirdi ve
     "kim sildi" sorusu ortada kalırdı. Beş saniye boyunca kayıt YERİNDE
     duruyor, yalnızca bu ekranda gizli.

     Uygulama bu arada kapanırsa kayıt silinmemiş oluyor. Bu bilinçli:
     silinmemiş bir alınacak, sessizce kaybolmuş bir alınacaktan iyidir. */
  const geriAlSayaci = useRef<any>(null);
  const [silinen, setSilinen] = useState<Item | null>(null);

  const gercektenSil = async (item: Item) => {
    try { await apiDelete(`/shopping/${item.item_id}`); } catch { await load(); }
  };

  /* Silinen satırın YERİ de saklanıyor. Önce geri alınca listenin sonuna
     ekleniyordu: yazdıkça en üste çıkan bir listede, geri alınan madde en
     alta düşüyordu. Geri alma "eski hâline döndür" demek; başka bir yere
     koymak yeni bir işlem yapmaktır. */
  const silinenSira = useRef<number>(-1);

  const remove = (item: Item) => {
    animateNextLayout();
    silinenSira.current = items.findIndex((i) => i.item_id === item.item_id);
    setItems((cur) => cur.filter((i) => i.item_id !== item.item_id));
    // Üst üste silmede önceki, beklemeden gerçekleşiyor: şerit tek satırlık
    // ve iki silmeyi birden geri alma sözü veremeyiz.
    if (geriAlSayaci.current) {
      clearTimeout(geriAlSayaci.current);
      if (silinen) gercektenSil(silinen);
    }
    setSilinen(item);
    geriAlSayaci.current = setTimeout(() => {
      geriAlSayaci.current = null;
      setSilinen(null);
      gercektenSil(item);
    }, 5000);
  };

  /* YAZMA YARDIMCISI — çip şeridi.
     Aşağı açılan bir panel DEĞİL: girdi alanının hemen altında liste var ve
     onu örtmek, kullanıcıyı zaten ne yazdığını göremez hale getirirdi. Çip
     şeridi listeyi bir satır aşağı itiyor, örtmüyor. Kalıp da yeni değil —
     elle giriş ekranındaki market çipleriyle aynı.

     Önerinin asıl kazancı kolaylık değil VERİ KALİTESİ: madde genel adla
     kaydedilince `/shopping/match` fişle isabetli eşleşiyor. Listede "dmts"
     yazıyorsa hiçbir fiş tutmaz. */
  const [oneriler, setOneriler] = useState<Oneri[]>([]);
  const [yaziyor, setYaziyor] = useState(false);
  useEffect(() => {
    if (!yaziyor) { setOneriler([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await apiGet<{ suggestions: Oneri[] }>(
          `/shopping/suggest?q=${encodeURIComponent(draft.trim())}&limit=6`);
        setOneriler(r.suggestions || []);
      } catch { setOneriler([]); }
    }, draft.trim() ? 180 : 0);
    return () => clearTimeout(t);
  }, [draft, yaziyor]);

  const geriAl = () => {
    if (geriAlSayaci.current) { clearTimeout(geriAlSayaci.current); geriAlSayaci.current = null; }
    const geri = silinen;
    setSilinen(null);
    if (!geri) return;
    animateNextLayout();
    setItems((cur) => {
      if (cur.some((i) => i.item_id === geri.item_id)) return cur;
      const yeni = [...cur];
      const yer = silinenSira.current;
      yeni.splice(yer >= 0 && yer <= yeni.length ? yer : yeni.length, 0, geri);
      return yeni;
    });
  };

  useEffect(() => () => {
    // Ekrandan çıkılırsa bekleyen silme hemen uygulanıyor; yarım kalmış bir
    // niyet bırakmak, kullanıcının "sildim" dediği şeyi geri getirir.
    if (geriAlSayaci.current) { clearTimeout(geriAlSayaci.current); }
  }, []);

  const clearDone = async () => {
    try { await apiPost(`/shopping/clear-done?scope=${scope}`, {}); await load(); }
    catch (e: any) { setError(e?.message || "Temizlenemedi"); }
  };

  const pending = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  /* Kaydırma ipucu artık HER AÇILIŞTA bir kez — gerekçesi `useKaydirmaIpucu`
     içinde. Eskiden burada cihazda saklanan bir kerelik bir kurulum vardı;
     ipucunun kendisi Aktivite'ye de gerekince ikisi `ui.tsx`'te birleşti. */
  const ipucuSatir = useKaydirmaIpucu("liste", pending[0]?.item_id);

  return (
    <View style={styles.root} testID="liste-screen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.scroll, altPay]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl {...yenileme(refreshing, () => { setRefreshing(true); load(); })} />
          }
        >
          <ScreenHeader
            overline="ALINACAKLAR"
            title={pending.length > 0 ? `${pending.length} Ürün Bekliyor` : "Liste Temiz"}
          >
            {/* SON ALIŞVERİŞ — paylaşılan listenin gerçek sorusu:
                "biri gitti mi, aldı da işaretlemedi mi?"

                Kapsama uyuyor ve GÖRÜNÜRLÜK süzgecinden geçiyor. Ev sahibinin
                sözü: "harcamalarımda ben onu görememiş olsam yalan gibi
                gelir." Görünmeyen bir harcamaya dayanarak "bugün alışveriş
                yapıldı" demek, doğrulanamayan bir cümledir.

                Küçük ve gri: bu ekranın kahramanı liste, tarih değil. */}
            {sonAlisveris && (
              <View style={styles.sonSatir}>
                <Ionicons name="cart-outline" size={12} color={colors.onDarkMuted} />
                <Text style={styles.sonTxt} numberOfLines={1}>
                  Son alışveriş <Text style={styles.sonVurgu}>{gunFarki(sonAlisveris.day)}</Text>
                  {sonAlisveris.merchant ? ` · ${sonAlisveris.merchant}` : ""}
                </Text>
              </View>
            )}
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
                onFocus={() => setYaziyor(true)}
                onBlur={() => setTimeout(() => setYaziyor(false), 150)}
                returnKeyType="done"
                blurOnSubmit={false}
                testID="liste-input"
              />
              <Pressable style={[styles.addBtn, (!draft.trim() || adding) && { opacity: 0.4 }]}
                         onPress={add} disabled={!draft.trim() || adding} testID="liste-add-btn">
                <Ionicons name="add" size={24} color={colors.onBrand} />
              </Pressable>
            </View>

            {oneriler.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                          keyboardShouldPersistTaps="always"
                          style={styles.oneriSerit}
                          contentContainerStyle={styles.oneriIc}>
                {oneriler.map((o) => (
                  <Pressable key={`${o.source}-${o.name}`}
                             style={[styles.oneriCip,
                                     o.source === "gecmis" && styles.oneriGecmis,
                                     o.source === "esanlamli" && styles.oneriEs]}
                             onPress={() => setDraft(o.name)}
                             testID={`liste-oneri-${o.name}`}>
                    <Text style={[styles.oneriTxt,
                                  o.source === "gecmis" && styles.oneriTxtGecmis,
                                  o.source === "esanlamli" && styles.oneriTxtEs]}>
                      {o.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}

            {error && <Text style={[styles.err, styles.mx]} testID="liste-error">{error}</Text>}

            {loading ? (
              <ActivityIndicator color={colors.ink} style={{ marginTop: spacing.xxl }} />
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
                    {/* Silme artik SAGA KAYDIRARAK. Her satirda duran bir X
                        hem listeyi kalabaliklastiriyor hem yanlis dokunmayi
                        kolaylastiriyordu -- Todoist ve Apple Hatirlatmalar da
                        bu yuzden jeste gecmis. Dokunmak "aldim" demeye devam
                        ediyor, yani en sik eylem hala tek dokunus. */}
                    {pending.map((it, i) => (
                      <View key={it.item_id}>
                        <KaydirmaIpucu oyna={ipucuSatir === it.item_id}>
                        <KaydirSil onSil={() => remove(it)}
                                   testID={`liste-del-${it.item_id}`}>
                          <Row
                            minHeight={52}
                            onPress={() => toggle(it)}
                            testID={`liste-item-${it.item_id}`}
                            leading={<View style={styles.check} />}
                            title={<Text style={styles.itemTxt}>{it.text}</Text>}
                            /* FİYAT İPUCU — yalnızca daha önce alındıysa.
                               Eşleşmeyen satırda alt yazı YOK; "fiyat
                               bilinmiyor" yazmak bilgi değil gürültü.

                               "Geçen sefer" diyor, "fiyatı" demiyor: son
                               alınan fiyat, ortalama değil. Kullanıcı fişine
                               bakıp doğrulayabilir — söz tutulabilecek kadar
                               dar. Markete de yazıyor çünkü tek başına tutar
                               yarım bilgi; markete giderken karar verdiren
                               şey ikisi birden. */
                            subtitle={it.last_price != null ? (
                              <Text style={styles.ipucu} numberOfLines={1}>
                                geçen sefer {formatEUR(it.last_price)}
                                {it.last_merchant ? ` · ${it.last_merchant}` : ""}
                              </Text>
                            ) : undefined}
                            right={
                              scope === "household" ? (
                                <Avatar name={first(it.added_by)} size={24}
                                        avatarId={(member(it.added_by) as any)?.avatar_id}
                                        userId={it.added_by}
                                        photoVersion={(member(it.added_by) as any)?.photo_version} />
                              ) : undefined
                            }
                          />
                        </KaydirSil>
                        </KaydirmaIpucu>
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
      {/* Şerit ScrollView'in DIŞINDA: içeride olsaydı kaydırınca kaçardı ve
          geri alma penceresi beş saniye değil, "kaydırmadığın sürece beş
          saniye" olurdu. */}
      <GeriAlSeridi
        gorunur={!!silinen}
        metin={silinen ? `"${silinen.text}" silindi` : ""}
        onGeriAl={geriAl}
        testID="liste-geri-al"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  scroll: { backgroundColor: colors.bg, flexGrow: 1 },
  mx: { marginHorizontal: spacing.lg },
  /* Şerit kartın dışında ve yatay kaydırılabilir: altı öneri dar telefonda
     sığmıyor, alt satıra sarsaydı liste iki satır birden aşağı kayardı. */
  /* `alignSelf` ve `alignItems` OLMAZSA çipler dev gibi açılıyor.
     Sebep: bu şerit `Sheet` içinde ve `Sheet` `flex: 1`. Yüksekliği
     sınırlanmamış yatay bir ScrollView, kalan dikey boşluğu kaplıyor;
     içerik kabında `alignItems` yazılı değilse varsayılan `stretch`
     devreye giriyor ve ÇİPLER o yüksekliğe kadar uzuyor.
     Ev sekmesinde görünmüyordu çünkü altındaki liste uzun, boş dikey alan
     yok. Kişisel sekmede liste kısa olunca hata ortaya çıktı.
     Elle giriş ekranındaki şerit (`chipRow`) bunu baştan doğru yapıyordu;
     buraya kopyalanırken `alignItems` düşmüş. */
  oneriSerit: { marginTop: spacing.sm, flexGrow: 0, alignSelf: "stretch" },
  oneriIc: {
    paddingHorizontal: spacing.lg, gap: spacing.sm,
    alignItems: "center", paddingVertical: 2,
  },
  oneriCip: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6,
  },
  oneriGecmis: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  oneriEs: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  oneriTxt: { ...T.caption, color: colors.inkSecondary },
  oneriTxtGecmis: { ...T.captionSb, color: colors.accentDark },
  oneriTxtEs: { ...T.captionSb, color: colors.warning },
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
  ipucu: { ...T.caption, fontSize: 11, color: colors.inkTertiary, marginTop: 2 },
  /* Başlık ile sekme anahtarının TAM ORTASINDA.
     Önce yalnızca üstten 8 piksel vardı ve altında hiç boşluk yoktu; satır
     anahtara yapışıp onun alt yazısı gibi okunuyordu. Başlık bloğu zaten
     altına 16 bırakıyor, buraya da 16 eklenince ikisi eşitleniyor. */
  sonSatir: {
    flexDirection: "row", alignItems: "center", gap: 5,
    marginBottom: spacing.lg,
  },
  sonTxt: { ...T.caption, color: colors.onDarkMuted, flex: 1 },
  sonVurgu: { ...T.captionSb, color: colors.onDark },
  itemDone: { ...T.body, color: colors.inkTertiary, textDecorationLine: "line-through" },
  itemRight: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  itemWho: { ...T.caption, color: colors.inkTertiary },
  doneHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  clear: { ...T.captionSb, color: colors.accent },
  err: { ...T.caption, color: colors.negative, marginTop: spacing.sm },
});
