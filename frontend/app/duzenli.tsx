/** Düzenli ödemeler — kira, elektrik, internet.
 *
 *  Tek ekran, Ev / Kişisel sekmeli. Alınacaklar listesindeki desenin aynısı:
 *  o da tek ekran ve iki kapsam taşıyor. Tur 3'ün "bu kime ait?" kuralını
 *  sekme karşılıyor, ekranı ikiye bölmeye gerek kalmıyor — aksi hâlde
 *  "kirayı nereye eklemiştim" diye bir soru doğuyordu.
 *
 *  Onay burada da ayrı bir ekran değil, alttan açılan kendi sayfamız. Bu
 *  sayede "Onayla" ve "Düzenle" tek şeye indi: karta dokunmak zaten dolu
 *  gelen sayfayı açıyor, sabit tutarda tek dokunuş yetiyor.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  ActivityIndicator, Alert, Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, apiGet, apiPost } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useHousehold } from "@/src/household";
import {
  ScreenHeader, Sheet, Card, Divider, Chip, SplitPicker, splitAll,
  BottomSheet, TabSwitch, HintCard, formatEUR, todayISO, useScrollPad, type Split,
  useKlavyeOrtusu,
} from "@/src/ui";
import {
  colors, spacing, radius, type as T, overline, fontFamily,
} from "@/src/theme";

type Recurring = {
  recurring_id: string; created_by: string; scope: "household" | "self";
  name: string; amount: number; amount_fixed: boolean; day_of_month: number;
  split_mode: "equal" | "exact"; split_with: Record<string, number>;
  category?: string | null; merchant?: string | null; notes?: string | null;
  active: boolean; due_period: string | null; last_confirmed?: string | null;
  next_due?: string; days_until?: number; missed_period?: string | null;
};

const SUGGESTED = ["Kira", "Elektrik", "Su", "İnternet", "Isınma", "Abonelik", "Temizlik", "Diğer"];
const num = (s: string) => parseFloat((s || "").replace(",", ".")) || 0;
const money = (n: number) => n.toFixed(2).replace(".", ",");
const toDDMMYYYY = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };
const fromDDMMYYYY = (s: string): string | null => {
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};

const AYLAR_TR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz",
                  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const AYLAR_TAM = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
                   "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

const ayAdiTR = (key: string) => AYLAR_TAM[parseInt(key.split("-")[1], 10) - 1] || "";

/** "4 gün gecikti" / "Bugün" / "14 gün sonra" — sayı değil cümle. */
const vadeYazi = (gun?: number) => {
  if (gun == null) return "";
  if (gun < 0) return `${-gun} gün gecikti`;
  if (gun === 0) return "Bugün";
  if (gun === 1) return "Yarın";
  return `${gun} gün sonra`;
};

/** Takvim yaprağı. Önce çıplak bir gün numarası vardı ve ne olduğu okunmuyordu. */
function DateChip({ iso, late }: { iso?: string; late?: boolean }) {
  if (!iso) return <View style={styles.dayBox} />;
  const [, ay, gun] = iso.split("-").map(Number);
  return (
    <View style={[styles.dayBox, late && styles.dayBoxLate]}>
      <Text style={[styles.dayAy, late && { color: colors.negative }]}>
        {(AYLAR_TR[ay - 1] || "").toLocaleUpperCase("tr")}
      </Text>
      <Text style={[styles.dayTxt, late && { color: colors.negative }]}>{gun}</Text>
    </View>
  );
}

export default function Duzenli() {
  // Gezinme cubugu payi -- ic dolgu zaten var, buraya yalnizca cihazin payi.
  const altPay = useScrollPad({ extra: 0 });
  const router = useRouter();
  const { scope: initialScope } = useLocalSearchParams<{ scope?: string }>();
  const { user } = useAuth();
  const { members } = useHousehold();

  const [scope, setScope] = useState<"household" | "self">(
    initialScope === "self" ? "self" : "household"
  );
  const [rows, setRows] = useState<Recurring[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Recurring | "new" | null>(null);
  const [confirming, setConfirming] = useState<Recurring | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ recurring: Recurring[] }>("/recurring");
      setRows(res.recurring || []);
    } catch { /* liste boş kalır; ekran yine kullanılabilir */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = rows.filter((r) => r.scope === scope);
  // Vadesi gelmis (ve hala onaylanmamis) olanlar en uste; gerisi vade
  // tarihine gore siralı. Once `day_of_month` sirasi kullaniliyordu, yani
  // ayin 1'i bugun gecmis olsa bile listede basta duruyordu.
  const bekleyen = shown.filter((r) => r.active && r.due_period);
  const sonrakiler = shown
    .filter((r) => !(r.active && r.due_period))
    .sort((a, b) => (a.days_until ?? 0) - (b.days_until ?? 0));
  const kacirilan = shown.filter((r) => r.active && r.missed_period);

  const skip = async (r: Recurring) => {
    try {
      await apiPost(`/recurring/${r.recurring_id}/skip`, { period_key: r.due_period });
      load();
    } catch (e) { console.log(e); }
  };

  return (
    <View style={styles.root} testID="duzenli-screen">
      <ScrollView contentContainerStyle={[styles.page, altPay]} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          overline="HER AY TEKRARLAYAN"
          title="Düzenli Ödemeler"
          right={
            <Pressable onPress={() => router.back()} hitSlop={12} testID="duzenli-back" style={styles.headBtn}>
              <Ionicons name="close" size={20} color={colors.onDark} />
            </Pressable>
          }
        >
        </ScreenHeader>

        <Sheet>
          {/* Aciklama BASLIKTAN cikti: bir kez okunacak bir cumle,
              kalici olarak ekranin tepesini isgal etmemeli. */}
          <HintCard hintKey="duzenli-nasil">Vadesi gelince sorulur. Onaylamadan hiçbir kayıt oluşmaz.</HintCard>

          <View style={styles.body}>
            <TabSwitch
              value={scope}
              onChange={setScope}
              options={[
                { value: "household" as const, label: "Ev" },
                { value: "self" as const, label: "Kişisel" },
              ]}
              testID="duzenli-tab"
            />

            {loading ? (
              <ActivityIndicator color={colors.ink} style={{ marginTop: spacing.xxl }} />
            ) : shown.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="repeat" size={38} color={colors.inkTertiary} />
                <Text style={styles.emptyTitle}>
                  {scope === "household" ? "Ortak düzenli gider yok" : "Kişisel düzenli gider yok"}
                </Text>
                <Text style={styles.emptyDesc}>
                  Kira, elektrik, internet gibi her ay tekrarlayan giderleri buraya ekle.
                  Vadesi gelince Anasayfa'da onayına sunulur.
                </Text>
              </View>
            ) : (
              /* Bu ekran bir KAYIT DEFTERI degil, yaklasan para takvimi:
                 vadesi gelince onay bekliyor, yani dogasi bir EYLEM.
                 Siralama vadeye gore (abonelik yoneticilerinin -- Revolut
                 Subscriptions, Emma, Bobby -- tamami boyle), bastaki ciplak
                 "1" ise takvim yapragina dondu. "Tum ev · kisiye ozel · sabit"
                 jargonu ayrintiya tasindi: kurulumda bir kez lazim, her
                 bakista degil. */
              <View style={{ gap: spacing.md }}>
                {bekleyen.map((r) => (
                  <View key={r.recurring_id}
                        style={[styles.dueCard, (r.days_until ?? 0) < 0 && styles.dueCardLate]}>
                    <Pressable style={styles.row} onPress={() => setEditing(r)}
                               testID={`duzenli-row-${r.recurring_id}`}>
                      <DateChip iso={r.next_due} late={(r.days_until ?? 0) < 0} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle}>{r.name}</Text>
                        <Text style={[styles.rowWhen,
                                      (r.days_until ?? 0) < 0 && { color: colors.negative },
                                      r.days_until === 0 && { color: colors.onWarning }]}>
                          {vadeYazi(r.days_until)}
                        </Text>
                      </View>
                      <Text style={styles.rowAmount}>
                        {r.amount_fixed ? "" : "~"}{money(r.amount)}
                      </Text>
                    </Pressable>
                    {/* Onay LISTEDE: en sik yapilan is bugun ayrinti sayfasinin
                        icinde, yani bir adim uzakta duruyordu. */}
                    <View style={styles.dueActions}>
                      <Pressable style={styles.onayla} onPress={() => setConfirming(r)}
                                 testID={`duzenli-confirm-${r.recurring_id}`}>
                        <Text style={styles.onaylaTxt}>Onayla</Text>
                      </Pressable>
                      <Pressable style={styles.atla} onPress={() => skip(r)}
                                 testID={`duzenli-skip-${r.recurring_id}`}>
                        <Text style={styles.atlaTxt}>Atla</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}

                {sonrakiler.length > 0 && (
                  <>
                    <Text style={styles.grupBaslik}>SONRAKİLER</Text>
                    <Card>
                      {sonrakiler.map((r, i) => (
                        <View key={r.recurring_id}>
                          {i > 0 && <Divider inset={62} />}
                          <Pressable
                            style={[styles.row, !r.active && { opacity: 0.45 }]}
                            onPress={() => setEditing(r)}
                            testID={`duzenli-row-${r.recurring_id}`}
                          >
                            <DateChip iso={r.next_due} />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.rowTitle}>{r.name}</Text>
                              <Text style={styles.rowWhen}>
                                {r.active ? vadeYazi(r.days_until) : "pasif"}
                              </Text>
                            </View>
                            <Text style={[styles.rowAmount, !r.amount_fixed && { color: colors.inkTertiary }]}>
                              {r.amount_fixed ? "" : "~"}{money(r.amount)}
                            </Text>
                            <Ionicons name="chevron-forward" size={16} color={colors.inkTertiary} />
                          </Pressable>
                        </View>
                      ))}
                    </Card>
                  </>
                )}

                {/* Kacirilan ay icin KART uretilmiyor (alti onay karti gurultu
                    olurdu) ama 1.200 EUR'nun sessizce kaybolmasina da izin
                    verilmiyor: tek satirlik not. */}
                {kacirilan.map((r) => (
                  <View key={`missed-${r.recurring_id}`} style={styles.missed}>
                    <Ionicons name="information-circle-outline" size={16} color={colors.inkSecondary} />
                    <Text style={styles.missedTxt}>
                      {ayAdiTR(r.missed_period!)} {r.name.toLocaleLowerCase("tr")} hiç kaydedilmedi
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <Pressable style={styles.addBtn} onPress={() => setEditing("new")} testID="duzenli-add">
              <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
              <Text style={styles.addTxt}>Düzenli ödeme ekle</Text>
            </Pressable>
          </View>
        </Sheet>
      </ScrollView>

      {editing && (
        <EditSheet
          value={editing === "new" ? null : editing}
          scope={scope}
          members={members}
          meId={user?.user_id}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          onConfirmNow={(r) => { setEditing(null); setConfirming(r); }}
        />
      )}
      {confirming && (
        <ConfirmSheet
          tpl={confirming}
          members={members}
          meId={user?.user_id}
          onClose={() => setConfirming(null)}
          onDone={() => { setConfirming(null); load(); }}
        />
      )}
    </View>
  );
}

/* ---------------------------------------------------------- şablon düzenle */

function EditSheet({
  value, scope, members, meId, onClose, onSaved, onConfirmNow,
}: {
  value: Recurring | null;
  scope: "household" | "self";
  members: { user_id: string; name: string }[];
  meId?: string;
  onClose: () => void;
  onSaved: () => void;
  onConfirmNow: (r: Recurring) => void;
}) {
  const [name, setName] = useState(value?.name || "");
  const [amount, setAmount] = useState(value ? money(value.amount) : "");
  const [day, setDay] = useState(String(value?.day_of_month || 1));
  const [fixed, setFixed] = useState(value?.amount_fixed ?? true);
  const [category, setCategory] = useState(value?.category || "");
  const [split, setSplit] = useState<Split>(
    value ? { mode: value.split_mode, with: { ...value.split_with } } : { mode: "equal", with: {} }
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!value && members.length && !Object.keys(split.with).length) setSplit(splitAll(members));
  }, [members]);

  const total = num(amount);

  const save = async () => {
    setErr(null);
    if (!name.trim()) { setErr("Bir ad girin"); return; }
    if (total <= 0) { setErr("Geçerli bir tutar girin"); return; }
    const d = parseInt(day, 10);
    if (!d || d < 1 || d > 31) { setErr("Ayın kaçı? 1-31 arası bir gün girin"); return; }
    if (scope === "household" && split.mode === "exact") {
      const sum = Object.values(split.with).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - total) > 0.01) {
        setErr("Tutar değişti, bölüşümü yeniden düzenleyin");
        return;
      }
    }
    setBusy(true);
    try {
      const body: any = {
        name: name.trim(), amount: total, day_of_month: d,
        amount_fixed: fixed, category: category.trim() || null,
      };
      if (scope === "household") {
        body.split_mode = split.mode;
        body.split_with = split.with;
      }
      if (value) {
        await api(`/recurring/${value.recurring_id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        body.scope = scope;
        await apiPost("/recurring", body);
      }
      onSaved();
    } catch (e: any) { setErr(e?.message || "Kaydedilemedi"); }
    finally { setBusy(false); }
  };

  const remove = () => {
    if (!value) return;
    Alert.alert(
      "Düzenli ödeme silinsin mi?",
      `"${value.name}" bir daha sorulmayacak. Daha önce onayladığın kayıtlar duruyor.`,
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Sil", style: "destructive",
          onPress: async () => {
            try { await api(`/recurring/${value.recurring_id}`, { method: "DELETE" }); onSaved(); }
            catch (e: any) { setErr(e?.message || "Silinemedi"); }
          },
        },
      ],
    );
  };

  const klavye = useKlavyeOrtusu();

  return (
    <BottomSheet visible onClose={onClose}>
            {/* KLAVYE PAYI — fiş ekranındaki ile aynı gerekçe. Ev sahibi
                burada da yakaladı: alan klavyenin altında kalıyor ve ancak
                kaydırarak görünüyor. Alt sayfa kısa olduğunda kaydıracak yer
                de kalmıyor. Aşağıda yer açıyoruz, kutuyu zorla yukarı
                fırlatmıyoruz. */}
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }}
                        contentContainerStyle={{ paddingBottom: klavye }}>
              <Text style={[overline, styles.sheetTitle]}>
                {value ? "DÜZENLİ ÖDEMEYİ DÜZENLE" : "YENİ DÜZENLİ ÖDEME"}
              </Text>

              <View style={styles.field}>
                <Text style={styles.label}>AD</Text>
                <TextInput
                  style={styles.input} value={name} onChangeText={setName}
                  placeholder="Kira, elektrik, internet…"
                  placeholderTextColor={colors.inkTertiary} testID="duzenli-name"
                />
              </View>

              <View style={[styles.field, styles.row2]}>
                <View style={{ flex: 2 }}>
                  <Text style={styles.label}>TUTAR</Text>
                  <TextInput
                    style={styles.input} value={amount}
                    onChangeText={(t) => setAmount(t.replace(/[^\d.,]/g, ""))}
                    keyboardType="decimal-pad" placeholder="0,00"
                    placeholderTextColor={colors.inkTertiary} testID="duzenli-amount"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>AYIN KAÇI</Text>
                  <TextInput
                    style={styles.input} value={day}
                    onChangeText={(t) => setDay(t.replace(/[^\d]/g, "").slice(0, 2))}
                    keyboardType="number-pad" testID="duzenli-day"
                  />
                </View>
              </View>

              {/* Kira sabittir, elektrik değildir. "Sabit" demek "sormadan ekle"
                  demek değil — onay yine isteniyor, sadece tutar hazır geliyor. */}
              <Pressable style={styles.toggleRow} onPress={() => setFixed((f) => !f)} testID="duzenli-fixed">
                <Ionicons
                  name={fixed ? "checkbox" : "square-outline"} size={22}
                  color={fixed ? colors.accent : colors.inkTertiary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleTitle}>Tutar her ay aynı</Text>
                  <Text style={styles.toggleSub}>
                    {fixed
                      ? "Onaylarken tutar hazır gelir"
                      : "Onaylarken tutar sorulur (fatura her ay farklı)"}
                  </Text>
                </View>
              </Pressable>

              <Text style={[styles.label, { paddingHorizontal: spacing.lg }]}>KATEGORİ</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                          contentContainerStyle={styles.chipRow}>
                {SUGGESTED.map((t) => (
                  <Chip key={t} label={t} active={category === t}
                        onPress={() => setCategory(category === t ? "" : t)}
                        testID={`duzenli-cat-${t}`} />
                ))}
              </ScrollView>

              {scope === "household" && (
                <View style={styles.splitBox}>
                  <SplitPicker
                    label="BÖLÜŞÜM" value={split} onChange={setSplit}
                    members={members} meId={meId} total={total}
                    testID="duzenli-split"
                  />
                </View>
              )}

              {err && <Text style={styles.err}>{err}</Text>}
            </ScrollView>

            <Pressable style={[styles.primary, busy && { opacity: 0.6 }]} onPress={save}
                       disabled={busy} testID="duzenli-save">
              {busy ? <ActivityIndicator color={colors.onBrand} />
                    : <Text style={styles.primaryTxt}>{value ? "Kaydet" : "Ekle"}</Text>}
            </Pressable>

            {value && (
              <View style={styles.secondaryRow}>
                {value.due_period && (
                  <Pressable style={styles.secondary} onPress={() => onConfirmNow(value)}
                             testID="duzenli-confirm-now">
                    <Text style={styles.secondaryTxt}>Bu ayı onayla</Text>
                  </Pressable>
                )}
                <Pressable style={styles.secondary} onPress={remove} testID="duzenli-delete">
                  <Text style={[styles.secondaryTxt, { color: colors.negative }]}>Sil</Text>
                </Pressable>
              </View>
            )}
    </BottomSheet>
  );
}

/* ------------------------------------------------------------- onay sayfası */

/**
 * Vadesi gelen bir şablonu harcamaya çevirir.
 *
 * Android'in kendi uyarı penceresi kullanılmıyor: onay burada bir karar
 * ekranı, tutar ve bölüşüm burada değişebiliyor. Sistem penceresi bunların
 * hiçbirini taşıyamaz ve uygulamanın kendi dilini konuşmaz.
 */
export function ConfirmSheet({
  tpl, members, meId, onClose, onDone,
}: {
  tpl: Recurring;
  members: { user_id: string; name: string }[];
  meId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(money(tpl.amount));
  // Onaylamak izin vermek değil, "bu ödendi" demek: oluşan harcamanın ödeyeni
  // bakiyede alacaklı çıkıyor. Uygulamayı açan ile parayı veren çoğu zaman
  // farklı ("kirayı Salih ödüyor, uygulamayı ben giriyorum").
  const [paidBy, setPaidBy] = useState<string | undefined>(meId);
  const [payerOpen, setPayerOpen] = useState(false);
  const [dateInput, setDateInput] = useState(toDDMMYYYY(todayISO()));
  const [split, setSplit] = useState<Split>({ mode: tpl.split_mode, with: { ...tpl.split_with } });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const total = num(amount);
  const isSelf = tpl.scope === "self";
  const shareCount = Object.keys(split.with).length;
  const perHead = split.mode === "equal" && shareCount ? total / shareCount : null;

  // Kişiye özel bölüşüm eski toplama göre girilmişti; tutar değişince
  // kullanıcı bölüşümü de düzeltmeli. Sunucu da reddediyor ama hata orada
  // "kaydedilemedi" gibi okunuyor.
  const mismatch = useMemo(() => {
    if (isSelf || split.mode !== "exact") return false;
    const sum = Object.values(split.with).reduce((a, b) => a + b, 0);
    return Math.abs(sum - total) > 0.01;
  }, [split, total, isSelf]);

  const send = async (path: "confirm" | "skip") => {
    setErr(null);
    if (path === "confirm") {
      if (total <= 0) { setErr("Geçerli bir tutar girin"); return; }
      if (mismatch) { setErr("Tutar değişti, bölüşümü yeniden düzenleyin"); return; }
      if (!fromDDMMYYYY(dateInput)) { setErr("Tarih formatı: GG.AA.YYYY"); return; }
    }
    setBusy(true);
    try {
      await apiPost(`/recurring/${tpl.recurring_id}/${path}`, {
        period_key: tpl.due_period,
        ...(path === "confirm"
          ? {
              amount: total,
              paid_by: paidBy,
              expense_date: fromDDMMYYYY(dateInput),
              ...(isSelf ? {} : { split_mode: split.mode, split_with: split.with }),
            }
          : {}),
      });
      onDone();
    } catch (e: any) { setErr(e?.message || "İşlem başarısız"); }
    finally { setBusy(false); }
  };

  const monthName = (tpl.due_period || "").split("-")[1];
  const AYLAR = ["", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
                 "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

  return (
    <BottomSheet visible onClose={onClose}>
            <Text style={[overline, styles.sheetTitle]}>
              {tpl.name.toLocaleUpperCase("tr")} · {AYLAR[parseInt(monthName || "0", 10)] || ""}
            </Text>

            {/* Kalem simgesi şart: rakam hazır geldiği için düzenlenebildiği
                anlaşılmıyordu — kullanıcı değiştirebildiğini fark etmiyor. */}
            <View style={styles.amountRow}>
              <Text style={styles.currency}>€</Text>
              <TextInput
                style={styles.amountInput}
                value={amount}
                onChangeText={(t) => setAmount(t.replace(/[^\d.,]/g, ""))}
                keyboardType="decimal-pad"
                // Sabit tutarlıda hazır geliyor ama yine düzenlenebilir:
                // kira da bir kez zamlanır ve o ay elle düzeltilebilmeli.
                testID="onay-amount"
              />
              <Ionicons name="pencil" size={16} color={colors.inkTertiary} />
            </View>
            {!tpl.amount_fixed && (
              <Text style={styles.hint}>Bu gider her ay değişiyor · şablonda {money(tpl.amount)} yazıyor</Text>
            )}

            {!isSelf && (
              <View style={styles.confirmField}>
                <Pressable style={styles.payerRow} onPress={() => setPayerOpen(true)}
                           testID="onay-payer">
                  <View style={{ flex: 1 }}>
                    <Text style={styles.smallLabel}>ÖDEYEN</Text>
                    <Text style={styles.payerName}>
                      {paidBy === meId
                        ? "Sen"
                        : members.find((m) => m.user_id === paidBy)?.name || "—"}
                    </Text>
                  </View>
                  <Ionicons name="chevron-down" size={18} color={colors.inkTertiary} />
                </Pressable>
              </View>
            )}

            {!isSelf && (
              <View style={styles.confirmField}>
                <SplitPicker
                  label="BÖLÜŞÜM" value={split} onChange={setSplit}
                  members={members} meId={meId} total={total}
                  testID="onay-split"
                />
              </View>
            )}

            <View style={styles.confirmField}>
              <View style={styles.dateRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.smallLabel}>TARİH</Text>
                  <TextInput
                    style={styles.dateInput} value={dateInput} onChangeText={setDateInput}
                    placeholder="GG.AA.YYYY" placeholderTextColor={colors.inkTertiary}
                    keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
                    testID="onay-date"
                  />
                </View>
              </View>
            </View>

            <View style={[styles.summary, (mismatch || err) && styles.summaryErr]}>
              <Text style={[styles.summaryTxt, (mismatch || err) && styles.summaryTxtErr]}>
                {err || (mismatch
                  ? "Kişiye özel bölüşüm tutarla uyuşmuyor"
                  : isSelf
                    ? "Kişisel gider · dengeye girmez"
                    : perHead != null
                      ? `${shareCount} kişi · kişi başı ${formatEUR(perHead)}`
                      : `${shareCount} kişi · kişiye özel tutarlar`)}
              </Text>
            </View>

            <Pressable style={[styles.primary, busy && { opacity: 0.6 }]}
                       onPress={() => send("confirm")} disabled={busy} testID="onay-confirm">
              {busy ? <ActivityIndicator color={colors.onBrand} />
                    : <Text style={styles.primaryTxt}>Onayla ve ekle</Text>}
            </Pressable>

            <BottomSheet visible={payerOpen} onClose={() => setPayerOpen(false)}>
                  <Text style={[overline, styles.sheetTitle]}>PARAYI KİM ÖDEDİ?</Text>
                  {members.map((m, i) => (
                    <View key={m.user_id}>
                      {i > 0 && <View style={styles.payerDivider} />}
                      <Pressable
                        style={styles.payerPick}
                        onPress={() => { setPaidBy(m.user_id); setPayerOpen(false); }}
                        testID={`onay-payer-${m.user_id}`}
                      >
                        <Text style={styles.payerPickTxt}>
                          {m.name}{m.user_id === meId ? " (sen)" : ""}
                        </Text>
                        {paidBy === m.user_id && (
                          <Ionicons name="checkmark" size={20} color={colors.accent} />
                        )}
                      </Pressable>
                    </View>
                  ))}
            </BottomSheet>

            <View style={styles.secondaryRow}>
              {/* "Sonra" sunucuya gitmiyor: kart bir dahaki açılışta yine çıkar.
                  "Bu ay atla" ise kalıcı — bu ay hiç sorulmaz. */}
              <Pressable style={styles.secondary} onPress={onClose} testID="onay-later">
                <Text style={styles.secondaryTxt}>Sonra</Text>
              </Pressable>
              <Pressable style={styles.secondary} onPress={() => send("skip")} testID="onay-skip">
                <Text style={styles.secondaryTxt}>Bu ay atla</Text>
              </Pressable>
            </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  page: { backgroundColor: colors.bg, flexGrow: 1 },
  headBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.darkSurface,
    alignItems: "center", justifyContent: "center",
  },
  heroSub: { ...T.caption, color: colors.onDarkMuted, marginTop: spacing.xs },
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 62,
  },
  // Takvim yapragi: ay ustte kucuk, gun altta buyuk.
  dayBox: {
    width: 40, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center", paddingVertical: 4,
  },
  dayBoxLate: { backgroundColor: colors.negativeSoft },
  dayAy: { ...T.caption, fontSize: 9, lineHeight: 12, color: colors.inkSecondary },
  dayTxt: { ...T.bodySb, color: colors.ink, lineHeight: 19 },
  rowWhen: { ...T.caption, color: colors.inkTertiary, marginTop: 1 },
  grupBaslik: { ...overline, marginTop: spacing.sm },
  dueCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.attention, padding: spacing.sm,
  },
  dueCardLate: { borderColor: colors.negative },
  dueActions: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.sm, paddingTop: spacing.sm },
  onayla: {
    flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center",
    borderRadius: radius.pill, backgroundColor: colors.brand,
  },
  onaylaTxt: { ...T.bodySb, color: colors.onBrand },
  atla: {
    minHeight: 40, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center",
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
  },
  atlaTxt: { ...T.bodySb, color: colors.inkSecondary },
  missed: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md,
  },
  missedTxt: { ...T.caption, color: colors.inkSecondary, flex: 1, lineHeight: 18 },
  rowTitle: { ...T.emph, color: colors.ink },
  rowSub: { ...T.caption, color: colors.inkTertiary, marginTop: 1 },
  rowAmount: { ...T.bodySb, color: colors.ink },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxl },
  emptyTitle: { ...T.emph, color: colors.ink },
  emptyDesc: { ...T.caption, color: colors.inkTertiary, textAlign: "center", lineHeight: 19 },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: spacing.md },
  addTxt: { ...T.bodySb, color: colors.accent },

  sheetTitle: { paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  field: { paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  row2: { flexDirection: "row", gap: spacing.md },
  label: { ...overline, marginBottom: spacing.xs },
  smallLabel: { ...T.caption, color: colors.inkTertiary },
  input: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    fontSize: 16, fontFamily: fontFamily.regular, color: colors.ink, minHeight: 50,
  },
  toggleRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, marginTop: spacing.sm,
  },
  toggleTitle: { ...T.emph, color: colors.ink },
  toggleSub: { ...T.caption, color: colors.inkTertiary, marginTop: 1 },
  chipRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: 2 },
  splitBox: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    marginHorizontal: spacing.lg, marginTop: spacing.md, overflow: "hidden",
  },
  confirmField: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  amountRow: {
    flexDirection: "row", alignItems: "baseline", gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
  },
  currency: { fontSize: 22, color: colors.accent, fontFamily: fontFamily.bold },
  amountInput: {
    fontSize: 36, lineHeight: 44, fontFamily: fontFamily.bold, color: colors.ink,
    flex: 1, padding: 0, letterSpacing: -1,
  },
  payerRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  payerName: { ...T.bodySb, color: colors.ink, marginTop: 1 },
  payerPick: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, minHeight: 54,
  },
  payerPickTxt: { ...T.emph, color: colors.ink },
  payerDivider: {
    height: StyleSheet.hairlineWidth, backgroundColor: colors.divider,
    marginLeft: spacing.lg,
  },
  hint: { ...T.caption, color: colors.inkTertiary, paddingHorizontal: spacing.lg, marginTop: -spacing.sm, marginBottom: spacing.sm },
  dateRow: { flexDirection: "row", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  dateInput: { ...T.body, color: colors.ink, padding: 0, marginTop: 2 },
  summary: { backgroundColor: colors.accentSoft, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2 },
  summaryErr: { backgroundColor: colors.negativeSoft },
  summaryTxt: { ...T.captionSb, color: colors.accentDark },
  summaryTxtErr: { color: colors.negative },
  primary: {
    marginHorizontal: spacing.lg, marginTop: spacing.md, minHeight: 52,
    borderRadius: radius.pill, backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  primaryTxt: { ...T.emph, color: colors.onBrand },
  secondaryRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  secondary: {
    flex: 1, minHeight: 44, borderRadius: radius.pill, borderWidth: 1,
    borderColor: colors.border, alignItems: "center", justifyContent: "center",
  },
  secondaryTxt: { ...T.captionSb, color: colors.inkSecondary },
  err: { ...T.captionSb, color: colors.negative, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
});
