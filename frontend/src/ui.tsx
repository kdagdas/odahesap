/**
 * Ortak arayüz bileşenleri.
 *
 * Tasarım kuralları burada tek yerde toplanır:
 *  - Liste satırları ayrı ayrı kartlara konmaz. Tek kap (`Card`) içinde
 *    `Row`'lar ve aralarında saç teli `Divider` durur. Önceki sürümde her
 *    satır kendi kenarlığı ve gölgesiyle ayrı bir karttı; sekiz harcama
 *    sekiz kenarlık demekti.
 *  - Kart başlığı kartın İÇİNDEDİR (`Card title=`), üstünde gri etiket değil.
 *  - Ekran başına tek yükseltilmiş yüzey: koyu `ScreenHeader`. Kartlar düz.
 *  - Tutarlar sağa yaslı ve eşit genişlikte rakamla (`Money`).
 */
import React from "react";
import {
  View, Text, Pressable, StyleSheet, ViewStyle, StyleProp, Image, TextStyle,
  Keyboard, Platform, Modal, Alert, TextInput,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

import {
  colors, spacing, radius, type as T, overline, fontFamily, metrics, merchantColor,
  CATEGORY_ICONS, CATEGORY_LABEL_TR, getAvatar,
} from "./theme";

/* ------------------------------------------------------------------ metin */

export function Overline({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[overline, style]}>{children}</Text>;
}

/**
 * Para. Rakamlar eşit genişlikte, böylece alt alta tutarlar hizalanır.
 *
 * `numberOfLines={1}` KULLANILMAZ: Android metni önce ölçüp sonra `tnum`
 * özelliğini uyguluyor, tablo rakamları dar rakamlardan (1, 7) geniş olduğu
 * için metin ölçülen kutusuna sığmayıp "…" ile kırpılıyordu — € işareti
 * yerine üç nokta çıkmasının sebebi buydu.
 *
 * Satır sonu sorunu bunun yerine iki yerden çözülüyor: `flexShrink: 0` tutarın
 * sıkışmasını, `formatEUR` içindeki bölünmez boşluk da "€"nin alt satıra
 * düşmesini engelliyor.
 */
export function Money({
  value, style, sign = false, color,
}: { value?: number | null; style?: StyleProp<TextStyle>; sign?: boolean; color?: string }) {
  return (
    <Text style={[styles.money, color ? { color } : null, style]}>
      {formatEUR(value, sign)}
    </Text>
  );
}

/* ------------------------------------------------------- koyu ekran başlığı */

/**
 * Tam genişlikte koyu alan; içerik yüzeyi bunun üzerine kavisle biner.
 * Hero bir kart değil, ekranın kendisidir — "her şey dikdörtgen" hissini
 * kıran asıl hamle bu.
 */
export function ScreenHeader({
  overline: over, title, right, children, testID,
}: {
  overline?: string; title?: string; right?: React.ReactNode;
  children?: React.ReactNode; testID?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      colors={[colors.dark, colors.darkAlt]}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[styles.header, { paddingTop: insets.top + spacing.md }]}
      testID={testID}
    >
      {(over || title || right) && (
        <View style={styles.headerTop}>
          <View style={{ flex: 1 }}>
            {over ? <Text style={styles.headerOverline}>{over}</Text> : null}
            {title ? <Text style={styles.headerTitle}>{title}</Text> : null}
          </View>
          {right}
        </View>
      )}
      {children}
    </LinearGradient>
  );
}

/** Koyu başlığın içindeki iki sütunlu istatistik bloğu. */
export function HeaderSplit({ items }: { items: { label: string; value: string; accent?: boolean }[] }) {
  return (
    <View style={styles.split}>
      {items.map((it, i) => (
        <React.Fragment key={it.label}>
          {i > 0 && <View style={styles.splitLine} />}
          <View style={{ flex: 1 }}>
            <Text style={styles.splitLabel}>{it.label}</Text>
            <Text style={[styles.splitValue, it.accent && { color: colors.accentOnDark }]}>
              {it.value}
            </Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

/**
 * Koyu başlıkta yüzde değişimi rozeti.
 *
 * `onPress` verilirse rozetin kendisi istatistiklere giden düğme olur — yan
 * yana iki hap koymak yerine tek ve daha büyük bir dokunma hedefi.
 */
export function TrendBadge({
  pct, onPress, testID,
}: { pct?: number | null; onPress?: () => void; testID?: string }) {
  const up = (pct ?? 0) >= 0;
  // İlk dönemde kıyaslanacak bir şey yok; "%0 artış" yazmak yanlış olurdu.
  const hasTrend = pct !== null && pct !== undefined;
  const inner = (
    <>
      {hasTrend && (
        <>
          <Ionicons name={up ? "trending-up" : "trending-down"} size={13} color={colors.accentOnDark} />
          <Text style={styles.trendTxt}>%{Math.abs(pct as number)} {up ? "artış" : "azalış"}</Text>
        </>
      )}
      {onPress && (
        <>
          {hasTrend && <View style={styles.trendSep} />}
          <Ionicons name="stats-chart" size={12} color={colors.accentOnDark} />
          <Text style={styles.trendTxt}>İstatistikler</Text>
          <Ionicons name="chevron-forward" size={12} color={colors.accentOnDark} />
        </>
      )}
    </>
  );
  return onPress
    ? <Pressable onPress={onPress} testID={testID} style={styles.trend} hitSlop={6}>{inner}</Pressable>
    : <View style={styles.trend}>{inner}</View>;
}

/**
 * Klavyenin kapladığı yükseklik.
 *
 * `KeyboardAvoidingView` mutlak konumlu (position: absolute) öğeleri
 * itmiyor — alttan açılan sayfalar tam da öyle konumlanıyor ve klavye
 * açılınca tutar alanı klavyenin arkasında kalıyordu. Kenardan kenara
 * (edge-to-edge) çizim açık olduğu için pencere yeniden boyutlanması da
 * güvenilir değil. Yüksekliği doğrudan ölçüp elle yukarı itmek her iki
 * platformda da öngörülebilir çalışan tek yol.
 */
export function useKeyboardHeight() {
  const [height, setHeight] = React.useState(0);
  React.useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return height;
}

/** İçerik yüzeyi — koyu başlığın üzerine kavisle biner. */
export function Sheet({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.sheet, style]}>{children}</View>;
}

/* ---------------------------------------------------------------- kartlar */

export function Card({
  children, title, action, onAction, style, testID, padded = false, onLayout,
}: {
  children?: React.ReactNode; title?: string; action?: string; onAction?: () => void;
  style?: StyleProp<ViewStyle>; testID?: string; padded?: boolean;
  /** Kartın kaydırma alanı içindeki y konumu — bir bölüme atlamak için. */
  onLayout?: (y: number) => void;
}) {
  return (
    <View
      style={[styles.card, style]}
      testID={testID}
      onLayout={onLayout ? (e) => onLayout(e.nativeEvent.layout.y) : undefined}
    >
      {title ? (
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>{title}</Text>
          {action ? (
            <Pressable onPress={onAction} hitSlop={10}>
              <Text style={styles.cardAction}>{action}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={padded ? styles.cardBody : undefined}>{children}</View>
    </View>
  );
}

/** Kap içindeki tek satır. Sol yuva 40, ortada metin, sağda değer. */
export function Row({
  leading, title, subtitle, right, onPress, testID, minHeight = metrics.rowHeight,
}: {
  leading?: React.ReactNode; title?: React.ReactNode; subtitle?: React.ReactNode;
  right?: React.ReactNode; onPress?: () => void; testID?: string; minHeight?: number;
}) {
  const body = (
    <View style={[styles.row, { minHeight }]}>
      {leading ? <View style={styles.rowLeading}>{leading}</View> : null}
      <View style={{ flex: 1 }}>
        {typeof title === "string" ? <Text style={styles.rowTitle}>{title}</Text> : title}
        {typeof subtitle === "string"
          ? <Text style={styles.rowSub}>{subtitle}</Text>
          : subtitle}
      </View>
      {right}
    </View>
  );
  return onPress
    ? <Pressable onPress={onPress} testID={testID} android_ripple={{ color: colors.divider }}>{body}</Pressable>
    : <View testID={testID}>{body}</View>;
}

/**
 * Satır arası saç teli. Varsayılan girinti metin başlangıcına denk gelir:
 * kenar boşluğu 16 + ikon yuvası 36 + boşluk 12 = 64.
 */
export function Divider({ inset = metrics.dividerInset }: { inset?: number }) {
  return <View style={[styles.divider, { marginLeft: inset }]} />;
}

/* ------------------------------------------------------------ ikon / avatar */

/** Dairesel renkli ikon kabı — referans finans uygulamalarındaki gibi. */
export function IconPill({
  name, color, tint, size = metrics.icon, mci = false,
}: { name: string; color: string; tint: string; size?: number; mci?: boolean }) {
  const Icon: any = mci ? MaterialCommunityIcons : Ionicons;
  return (
    <View style={[styles.iconPill, { width: size, height: size, borderRadius: size / 2, backgroundColor: tint }]}>
      <Icon name={name} size={Math.round(size * 0.46)} color={color} />
    </View>
  );
}

export function CategoryIcon({ category, size = metrics.icon }: { category: string; size?: number }) {
  const c = CATEGORY_ICONS[category] || CATEGORY_ICONS.diger;
  return <IconPill name={c.icon} color={c.color} tint={c.bg} size={size} mci />;
}

export function categoryLabel(key: string) {
  return CATEGORY_LABEL_TR[key] || CATEGORY_LABEL_TR.diger;
}

/**
 * Dokunulabilir kategori simgesi.
 *
 * Düz simge dekoratif görünüyordu — kimse dokunulabileceğini anlamadı.
 * Köşesindeki küçük kalem rozeti, profil fotoğrafındaki kamera rozetiyle
 * aynı işaret: "buraya dokun, değiştir".
 */
export function CategoryPicker({
  category, onPress, size = metrics.icon, testID,
}: { category: string; onPress: () => void; size?: number; testID?: string }) {
  return (
    <Pressable onPress={onPress} testID={testID} hitSlop={6}>
      <CategoryIcon category={category} size={size} />
      <View style={styles.editBadge}>
        <Ionicons name="pencil" size={9} color={colors.onDark} />
      </View>
    </Pressable>
  );
}

/** Dokunulabilir birim etiketi — kenarlıklı hap, düğüm gibi okunuyor. */
export function UnitPicker({
  unit, onPress, testID,
}: { unit: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} testID={testID} hitSlop={8} style={styles.unitPill}>
      <Text style={styles.unitPillTxt}>{unit.toLocaleUpperCase("tr-TR")}</Text>
      <Ionicons name="chevron-down" size={10} color={colors.accentDark} />
    </Pressable>
  );
}

export function Avatar({
  name, size = metrics.icon, avatarId, userId, photoVersion,
}: {
  name?: string; size?: number; avatarId?: number | null;
  userId?: string | null; photoVersion?: string | null;
}) {
  const preset = getAvatar(avatarId);
  const [token, setToken] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const wants = !!(userId && photoVersion);

  React.useEffect(() => {
    let alive = true;
    if (!wants) return;
    setFailed(false);
    require("./api").getToken().then((t: string | null) => { if (alive) setToken(t); });
    return () => { alive = false; };
  }, [wants, photoVersion]);

  const box = { width: size, height: size, borderRadius: size / 2 };

  if (wants && token && !failed) {
    return (
      <Image
        source={{
          uri: `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/users/${userId}/photo?v=${photoVersion}`,
          headers: { Authorization: `Bearer ${token}` },
        }}
        style={[styles.avatar, box, { backgroundColor: preset.color }]}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <View style={[styles.avatar, box, { backgroundColor: preset.color }]}>
      <Ionicons name={preset.icon as any} size={Math.floor(size * 0.5)} color="#fff" />
    </View>
  );
}

/**
 * Bir kez gösterilip kapatılan ipucu kartı.
 *
 * Görsel işaret (kenarlıklı hap, kalem rozeti) tek başına yetmedi — kimse
 * simgeye dokunulabileceğini fark etmedi. Yazıyla bir kez söylemek gerekiyor.
 * Kapatıldığı bilgisi cihazda kalıyor, bir daha çıkmıyor.
 */
export function HintCard({
  hintKey, children, testID,
}: { hintKey: string; children: React.ReactNode; testID?: string }) {
  const [shown, setShown] = React.useState(false);
  const storageKey = `hint:${hintKey}`;

  React.useEffect(() => {
    let alive = true;
    require("@react-native-async-storage/async-storage").default
      .getItem(storageKey)
      .then((v: string | null) => { if (alive && !v) setShown(true); })
      .catch(() => {});
    return () => { alive = false; };
  }, [storageKey]);

  if (!shown) return null;
  return (
    <View style={styles.hint} testID={testID}>
      <Ionicons name="bulb-outline" size={18} color={colors.onInfo} />
      <Text style={styles.hintTxt}>{children}</Text>
      <Pressable
        hitSlop={10}
        onPress={() => {
          setShown(false);
          require("@react-native-async-storage/async-storage").default
            .setItem(storageKey, "1").catch(() => {});
        }}
        testID={testID ? `${testID}-dismiss` : undefined}
      >
        <Ionicons name="close" size={18} color={colors.onInfo} />
      </Pressable>
    </View>
  );
}

/**
 * Seçim satırı + alttan açılan liste.
 *
 * İki seçenek için iki düğme yeterliydi ama liste büyüyecek (yeni ülkeler,
 * yeni para birimleri). Yan yana düğme üçten sonra taşıyor; liste büyüdükçe
 * ekranı yeniden tasarlamamak için baştan açılır liste.
 */
export type SelectOption<T extends string> = {
  value: T;
  label: string;
  /** Solda duran kısa işaret: bayrak ya da para birimi simgesi. */
  mark?: string;
  hint?: string;
  /** Henüz gelmedi — listede görünür ama seçilemez. */
  soon?: boolean;
};

export function SelectRow<T extends string>({
  label, value, options, onSelect, locked, lockReason, testID,
}: {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onSelect: (v: T) => void;
  /** Kilitliyse kilit simgesi çıkar; dokununca sebebi söylenir. */
  locked?: boolean;
  lockReason?: string;
  testID?: string;
}) {
  const [open, setOpen] = React.useState(false);
  // Listenin son satırı telefonun gezinme çubuğunun altında kalıyordu.
  const insets = useSafeAreaInsets();
  const current = options.find((o) => o.value === value);
  return (
    <>
      <Pressable
        style={styles.selectRow}
        onPress={() => (locked
          ? Alert.alert(label, lockReason || "Bu ayar değiştirilemiyor.")
          : setOpen(true))}
        testID={testID}
      >
        {current?.mark ? <Text style={styles.selectMark}>{current.mark}</Text> : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.selectLabel}>{label}</Text>
          <Text style={[styles.selectValue, locked && { color: colors.inkSecondary }]}>
            {current?.label ?? value}
          </Text>
        </View>
        <Ionicons
          name={locked ? "lock-closed" : "chevron-down"}
          size={locked ? 16 : 18}
          color={colors.inkTertiary}
        />
      </Pressable>

      {/* Modal şart: alt sayfa kartın içinde `position: absolute` ile
          konumlanınca ekranı değil KARTI kaplıyor ve metinlerin üstüne
          yarı saydam biçimde biniyordu. React Native'de portal yok. */}
      <Modal visible={open} transparent animationType="slide"
             onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.sheetScrim} onPress={() => setOpen(false)}>
          <Pressable style={[styles.pickSheet, { paddingBottom: spacing.lg + insets.bottom }]}
                     onPress={() => {}}>
            <View style={styles.pickGrab} />
            <Text style={styles.pickTitle}>{label}</Text>
            {options.map((o, i) => (
              <React.Fragment key={o.value}>
                {i > 0 && <View style={[styles.divider, { marginLeft: spacing.lg }]} />}
                <Pressable
                  style={[styles.pickRow, o.soon && { opacity: 0.4 }]}
                  disabled={o.soon}
                  onPress={() => { setOpen(false); if (o.value !== value) onSelect(o.value); }}
                  testID={testID ? `${testID}-${o.value}` : undefined}
                >
                  {o.mark ? <Text style={styles.pickMark}>{o.mark}</Text> : null}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickLabel}>{o.label}</Text>
                    {o.hint ? <Text style={styles.pickHint}>{o.hint}</Text> : null}
                  </View>
                  {o.soon
                    ? <Text style={styles.pickSoon}>yakında</Text>
                    : o.value === value
                      ? <Ionicons name="checkmark" size={20} color={colors.accent} />
                      : null}
                </Pressable>
              </React.Fragment>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/* --------------------------------------------------------------- bölüşme */

export type Split = { mode: "equal" | "exact"; with: Record<string, number> };

export type SplitMember = { user_id: string; name: string };

/** Herkes eşit bölüşen liste — yeni harcamanın varsayılanı. */
export const splitAll = (members: SplitMember[]): Split => ({
  mode: "equal",
  with: Object.fromEntries(members.map((m) => [m.user_id, 1])),
});

/**
 * Kayıttan bölüşme listesini çıkarır — sunucudaki `split_of()`'un eşi.
 *
 * `split_with` alanı yazılmamış eski kayıtlar `target_type`'tan türetiliyor.
 * Tek yerde durması şart: rozet, düzenleme ekranı ve özet aynı cevabı
 * vermezse kullanıcı ekranlar arasında farklı bölüşüm görür.
 */
export function splitFromExpense(
  e: {
    added_by: string; total: number; target_type?: string; target_user_id?: string | null;
    split_mode?: string; split_with?: Record<string, number> | null;
  },
  members: SplitMember[],
): Split {
  if (e.split_with && Object.keys(e.split_with).length) {
    return { mode: e.split_mode === "exact" ? "exact" : "equal", with: { ...e.split_with } };
  }
  if (e.target_type === "roommate" && e.target_user_id) {
    return { mode: "exact", with: { [e.target_user_id]: Number(e.total) } };
  }
  if (e.target_type === "self") {
    return { mode: "exact", with: { [e.added_by]: Number(e.total) } };
  }
  return splitAll(members);
}

/**
 * Harcama listelerindeki bölüşme rozeti.
 *
 * Üç ekran bunu ayrı ayrı hesaplıyordu ve üçü de yalnızca eski üç durumu
 * biliyordu; "seçili kişiler" hepsinde yanlış etikete düşüyordu.
 */
export function splitBadge(
  e: Parameters<typeof splitFromExpense>[0],
  members: SplitMember[],
  meId?: string,
  /** Başkasının dökümüne bakarken "Kendim" değil "Kendisi" doğru. */
  selfLabel = "Kendim",
): { txt: string; color: string; bg: string } {
  const split = splitFromExpense(e, members);
  const ids = Object.keys(split.with);
  if (ids.length === 1 && ids[0] === e.added_by)
    return { txt: selfLabel, color: colors.onWarning, bg: colors.warningSoft };
  if (ids.length === 1) {
    const who = members.find((m) => m.user_id === ids[0])?.name?.split(" ")[0] || "?";
    return { txt: `→ ${who}`, color: colors.onInfo, bg: colors.infoSoft };
  }
  if (ids.length === members.length && members.length > 0)
    return { txt: "Ev", color: colors.dark, bg: colors.surfaceSecondary };
  return { txt: splitSummary(split, members, meId), color: colors.accentDark, bg: colors.accentSoft };
}

const parseAmount = (s: string) => parseFloat((s || "").replace(",", ".")) || 0;
const showAmount = (n: number) => n.toFixed(2).replace(".", ",");

/** Bölüşme listesini tek satırda özetler: "Tüm ev", "Sen + Salih", "→ Ali". */
export function splitSummary(split: Split, members: SplitMember[], meId?: string): string {
  const ids = Object.keys(split.with || {});
  if (!ids.length) return "Seçilmedi";
  const suffix = split.mode === "exact" && ids.length > 1 ? " · kişiye özel" : "";
  if (ids.length === members.length && members.length > 0) return "Tüm ev" + suffix;
  if (ids.length === 1) {
    if (ids[0] === meId) return "Sadece ben";
    const who = members.find((m) => m.user_id === ids[0]);
    return `→ ${who?.name?.split(" ")[0] || "?"}`;
  }
  const names = ids.map((id) =>
    id === meId ? "Sen" : members.find((m) => m.user_id === id)?.name?.split(" ")[0] || "?"
  );
  // Üçten sonra isimler satıra sığmıyor ve okunmuyor; sayı daha bilgilendirici.
  return (names.length <= 3 ? names.join(" + ") : `${names.length} kişi`) + suffix;
}

/**
 * Kimlerin bölüştüğünü seçen alt sayfa.
 *
 * Beş durumun hepsi tek ekranda: herkes işaretli = ev, sadece ben = kişisel,
 * tek kişi = ona ait, bir kısmı = seçili kişiler, "Tutar gir" = kişiye özel.
 * İki aşamalı bir listeye bölünmedi çünkü fiş inceleme ekranında her kalem
 * için ayrı ayrı açılıyor — orada her fazladan dokunuş on beşle çarpılıyor.
 *
 * Seçim sayfa kapanana kadar yereldedir: yarım kalmış bir tutar girişi
 * (toplamı tutmayan bölüşüm) dışarıya sızmamalı.
 */
export function SplitPicker({
  label = "BÖLÜŞÜM", value, onChange, members, meId, total, allowExact = true, testID,
}: {
  label?: string;
  value: Split;
  onChange: (s: Split) => void;
  members: SplitMember[];
  meId?: string;
  total: number;
  /** Fiş kaleminde kapalı: kalemin fiyatı belli, sorulan tek şey kimler bölüşüyor. */
  allowExact?: boolean;
  testID?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<Split["mode"]>(value.mode);
  const [picked, setPicked] = React.useState<string[]>(Object.keys(value.with || {}));
  const [amounts, setAmounts] = React.useState<Record<string, string>>({});
  const [err, setErr] = React.useState<string | null>(null);
  const insets = useSafeAreaInsets();

  const start = () => {
    const ids = Object.keys(value.with || {});
    setMode(value.mode);
    setPicked(ids);
    setAmounts(
      Object.fromEntries(
        members.map((m) => [
          m.user_id,
          value.mode === "exact" && value.with[m.user_id] != null
            ? showAmount(Number(value.with[m.user_id]))
            : ids.includes(m.user_id) && ids.length
              ? showAmount(total / ids.length)
              : "",
        ])
      )
    );
    setErr(null);
    setOpen(true);
  };

  const toggle = (id: string) => {
    setErr(null);
    setPicked((p) => {
      const next = p.includes(id) ? p.filter((x) => x !== id) : [...p, id];
      // Eşit bölüşmede kişi sayısı değişince önizlenen paylar da değişmeli.
      if (mode === "equal" && next.length) {
        setAmounts((a) =>
          Object.fromEntries(
            members.map((m) => [m.user_id, next.includes(m.user_id) ? showAmount(total / next.length) : ""])
          )
        );
      }
      return next;
    });
  };

  const switchMode = (m: Split["mode"]) => {
    setErr(null);
    setMode(m);
    if (m === "exact" && picked.length) {
      // Eşit paylarla doldur: çoğu kira bu rakamların yakınından başlıyor.
      setAmounts((a) =>
        Object.fromEntries(
          members.map((mem) => [
            mem.user_id,
            picked.includes(mem.user_id) ? (a[mem.user_id] || showAmount(total / picked.length)) : "",
          ])
        )
      );
    }
  };

  const entered = picked.reduce((s, id) => s + parseAmount(amounts[id]), 0);
  const remaining = Math.round((total - entered) * 100) / 100;

  const confirm = () => {
    if (!picked.length) { setErr("En az bir kişi seçin"); return; }
    if (mode === "exact") {
      if (Math.abs(remaining) > 0.01) {
        setErr(`Tutarların toplamı ${showAmount(total)} olmalı · ${showAmount(Math.abs(remaining))} ${remaining > 0 ? "eksik" : "fazla"}`);
        return;
      }
      onChange({ mode: "exact", with: Object.fromEntries(picked.map((id) => [id, parseAmount(amounts[id])])) });
    } else {
      onChange({ mode: "equal", with: Object.fromEntries(picked.map((id) => [id, 1])) });
    }
    setOpen(false);
  };

  return (
    <>
      <Pressable style={styles.selectRow} onPress={start} testID={testID}>
        <View style={{ flex: 1 }}>
          <Text style={styles.selectLabel}>{label}</Text>
          <Text style={styles.selectValue}>{splitSummary(value, members, meId)}</Text>
        </View>
        <Ionicons name="chevron-down" size={18} color={colors.inkTertiary} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.sheetScrim} onPress={() => setOpen(false)}>
          <Pressable style={[styles.pickSheet, { paddingBottom: spacing.lg + insets.bottom }]} onPress={() => {}}>
            <View style={styles.pickGrab} />
            <View style={styles.splitHead}>
              <Text style={overline}>KİMLER BÖLÜŞÜYOR?</Text>
              <Text style={styles.splitTotal}>{formatEUR(total)}</Text>
            </View>

            {allowExact && (
              <View style={styles.segment}>
                {(["equal", "exact"] as const).map((m) => (
                  <Pressable
                    key={m}
                    style={[styles.segBtn, mode === m && styles.segBtnOn]}
                    onPress={() => switchMode(m)}
                    testID={testID ? `${testID}-mode-${m}` : undefined}
                  >
                    <Text style={[styles.segTxt, mode === m && styles.segTxtOn]}>
                      {m === "equal" ? "Eşit" : "Tutar gir"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            {members.map((m, i) => {
              const on = picked.includes(m.user_id);
              return (
                <React.Fragment key={m.user_id}>
                  {i > 0 && <View style={[styles.divider, { marginLeft: spacing.lg }]} />}
                  <Pressable
                    style={styles.pickRow}
                    onPress={() => toggle(m.user_id)}
                    testID={testID ? `${testID}-member-${m.user_id}` : undefined}
                  >
                    <Ionicons
                      name={on ? "checkbox" : "square-outline"}
                      size={22}
                      color={on ? colors.accent : colors.inkTertiary}
                    />
                    <Text style={[styles.pickLabel, { flex: 1 }, !on && { color: colors.inkTertiary }]}>
                      {m.name}{m.user_id === meId ? " (sen)" : ""}
                    </Text>
                    {!on ? (
                      <Text style={styles.splitShare}>—</Text>
                    ) : mode === "exact" ? (
                      <TextInput
                        style={styles.splitInput}
                        value={amounts[m.user_id] ?? ""}
                        onChangeText={(t) => {
                          setErr(null);
                          setAmounts((a) => ({ ...a, [m.user_id]: t.replace(/[^\d.,]/g, "") }));
                        }}
                        keyboardType="decimal-pad"
                        placeholder="0,00"
                        placeholderTextColor={colors.inkTertiary}
                        testID={testID ? `${testID}-amount-${m.user_id}` : undefined}
                      />
                    ) : (
                      <Text style={styles.splitShare}>{formatEUR(total / Math.max(picked.length, 1))}</Text>
                    )}
                  </Pressable>
                </React.Fragment>
              );
            })}

            <View style={[styles.splitFoot, err ? styles.splitFootErr : null]}>
              <Text style={[styles.splitFootTxt, err ? styles.splitFootTxtErr : null]}>
                {err || `${picked.length} kişi bölüşüyor`}
              </Text>
              {!err && mode === "exact" && (
                <Text style={[styles.splitFootTxt, Math.abs(remaining) > 0.01 && styles.splitFootTxtErr]}>
                  kalan {showAmount(remaining)}
                </Text>
              )}
            </View>

            <Pressable style={styles.splitOk} onPress={confirm} testID={testID ? `${testID}-ok` : undefined}>
              <Text style={styles.splitOkTxt}>Tamam</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/* --------------------------------------------------------------- rozetler */

export function Tag({
  label, tint, color, style,
}: { label: string; tint: string; color: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.tag, { backgroundColor: tint }, style]}>
      <Text style={[styles.tagTxt, { color }]}>{label}</Text>
    </View>
  );
}

export function MerchantBadge({ name }: { name?: string | null }) {
  if (!name) return null;
  return (
    <View style={[styles.merchant, { backgroundColor: merchantColor(name) }]}>
      <Text style={styles.merchantTxt} numberOfLines={1}>{name.toUpperCase()}</Text>
    </View>
  );
}

export function Chip({
  label, active, onPress, testID, icon,
}: { label: string; active?: boolean; onPress?: () => void; testID?: string; icon?: any }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]} testID={testID}>
      {icon && (
        <Ionicons name={icon} size={14} color={active ? colors.onBrand : colors.inkSecondary}
                  style={{ marginRight: 5 }} />
      )}
      <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{label}</Text>
    </Pressable>
  );
}

export function PrimaryButton({
  label, onPress, disabled, testID, style, icon,
}: {
  label: string; onPress?: () => void; disabled?: boolean; testID?: string;
  style?: StyleProp<ViewStyle>; icon?: any;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled}
               style={[styles.primary, disabled && { opacity: 0.5 }, style]} testID={testID}>
      {icon && <Ionicons name={icon} size={18} color={colors.onBrand} style={{ marginRight: 8 }} />}
      <Text style={styles.primaryTxt}>{label}</Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------- biçimleyici */

/**
 * Türkçe biçim: binlik "." , kuruş ",". Rakam ile para birimi arasındaki
 * boşluk bölünmez (U+00A0) — normal boşluk olduğunda dar bir satırda sembol
 * tek başına alt satıra düşüyordu. İşaret ile rakam arası da aynı sebeple.
 */
const NBSP = "\u00A0";

/**
 * Ekranda gösterilen para birimi.
 *
 * Modül düzeyinde bir değişken, çünkü `formatEUR` yüzlerce yerde bağlam
 * almadan çağrılıyor; her çağrı yerine ev nesnesini taşımak uygulamanın
 * yarısını dolaşmak demekti. Ev yüklendiğinde bir kez yazılıyor.
 * Dönüşüm yok — bir ev tek para birimi kullanır, biz yalnızca sembol seçeriz.
 */
let currencySymbol = "\u20AC";
export const setCurrency = (code?: string | null) => {
  currencySymbol = code === "TRY" ? "\u20BA" : "\u20AC";
};

export function formatEUR(n: number | null | undefined, sign = false) {
  if (n === null || n === undefined || isNaN(n as number)) return `0,00${NBSP}${currencySymbol}`;
  const v = Number(n);
  const abs = Math.abs(v);
  const [int, dec] = abs.toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const prefix = sign ? (v >= 0 ? `+${NBSP}` : `\u2212${NBSP}`) : (v < 0 ? "\u2212" : "");
  return `${prefix}${grouped},${dec}${NBSP}${currencySymbol}`;
}

export const UNITS = ["adet", "kg", "lt", "paket"] as const;
export type Unit = (typeof UNITS)[number];
export const nextUnit = (u?: string): Unit =>
  UNITS[(UNITS.indexOf((u as Unit) || "adet") + 1) % UNITS.length];

/**
 * Miktar + birim. Tartılan ürünlerde fişte "0,590 kg" yazıyor; birim
 * taşınmadığı için bu "590 adet" olarak görünüyordu.
 */
export function formatQty(quantity?: number | null, unit?: string | null) {
  const q = quantity ?? 1;
  const u = (unit as Unit) || "adet";
  // Kilo ve litre ondalıklı, adet tam sayı okunur.
  const n = u === "kg" || u === "lt"
    ? q.toFixed(q < 1 || q % 1 ? 3 : 0).replace(".", ",").replace(/,?0+$/, "")
    : String(Math.round(q * 100) / 100).replace(".", ",");
  return `${n} ${u}`;
}

/** Dar yerlerde kuruşu düşürür: "1.240,00 €" -> "1.240 €". */
export function formatEURShort(n: number | null | undefined) {
  return formatEUR(n).replace(`,00${NBSP}€`, `${NBSP}€`);
}

export function formatDateTR(iso?: string | null) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return !y || !m || !d ? iso : `${d}.${m}.${y}`;
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ stiller */

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl + spacing.md, // yüzey buraya biner
  },
  headerTop: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.lg },
  headerOverline: { ...overline, color: colors.onDarkMuted },
  headerTitle: { ...T.screen, color: colors.onDark },
  split: { flexDirection: "row", alignItems: "center", marginTop: spacing.lg },
  splitLine: { width: 1, height: 34, backgroundColor: "rgba(255,255,255,0.14)", marginRight: spacing.lg },
  splitLabel: { ...T.caption, color: colors.onDarkMuted },
  splitValue: { ...T.emph, color: colors.onDark, marginTop: 1 },
  trend: {
    flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start",
    backgroundColor: "rgba(16,185,129,0.18)", paddingHorizontal: spacing.md,
    paddingVertical: 5, borderRadius: radius.pill, marginTop: spacing.md,
  },
  trendTxt: { ...T.captionSb, color: colors.accentOnDark },
  trendSep: { width: StyleSheet.hairlineWidth, height: 12, backgroundColor: colors.accentOnDark, opacity: 0.4, marginHorizontal: 2 },
  sheet: {
    flex: 1, backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    marginTop: -spacing.xl, paddingTop: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, overflow: "hidden",
  },
  cardBody: { padding: spacing.lg, paddingTop: 0 },
  cardHead: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    // Başlık ile veri arası bilerek geniş: başlık listeye yapışınca ikisi tek
    // blok gibi okunuyor, ayrılınca başlık gerçekten başlık oluyor.
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md + 2,
  },
  cardTitle: { ...T.title, color: colors.ink },
  cardAction: { ...T.captionSb, color: colors.accent },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  rowLeading: { width: metrics.leading, alignItems: "center" },
  rowTitle: { ...T.bodySb, color: colors.ink },
  rowSub: { ...T.caption, color: colors.inkTertiary, marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider },
  money: { ...T.emph, color: colors.ink, fontVariant: ["tabular-nums"], flexShrink: 0 },
  iconPill: { alignItems: "center", justifyContent: "center" },
  editBadge: {
    position: "absolute", right: -3, bottom: -3,
    width: 16, height: 16, borderRadius: 8, backgroundColor: colors.dark,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: colors.surface,
  },
  unitPill: {
    flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start",
    paddingHorizontal: 7, height: 20, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentSoft,
  },
  unitPillTxt: {
    fontSize: 10, lineHeight: 13, fontFamily: fontFamily.semibold,
    letterSpacing: 0.5, color: colors.accentDark,
  },
  hint: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.infoSoft, borderRadius: radius.md, padding: spacing.md,
  },
  hintTxt: { ...T.caption, color: colors.onInfo, flex: 1, lineHeight: 18 },
  selectRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: metrics.rowHeight,
  },
  selectMark: { fontSize: 22, lineHeight: 28, width: 30, textAlign: "center" },
  selectLabel: { ...T.caption, color: colors.inkTertiary },
  selectValue: { ...T.bodySb, color: colors.ink, marginTop: 1 },
  sheetScrim: {
    ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(12,22,38,0.45)",
    justifyContent: "flex-end",
  },
  pickSheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl, paddingTop: spacing.lg, paddingBottom: spacing.xxl,
  },
  pickGrab: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border,
    alignSelf: "center", marginBottom: spacing.md,
  },
  pickTitle: { ...overline, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  pickMark: { fontSize: 24, lineHeight: 30, width: 34, textAlign: "center" },
  pickSoon: { ...T.caption, color: colors.inkTertiary },
  pickRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, minHeight: 56,
  },
  pickLabel: { ...T.emph, color: colors.ink },
  pickHint: { ...T.caption, color: colors.inkTertiary, marginTop: 1 },
  splitHead: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, marginBottom: spacing.md,
  },
  splitTotal: { ...T.bodySb, color: colors.ink },
  segment: {
    flexDirection: "row", gap: spacing.xs, marginHorizontal: spacing.lg,
    marginBottom: spacing.sm, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill, padding: 3,
  },
  segBtn: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.pill },
  segBtnOn: { backgroundColor: colors.dark },
  segTxt: { ...T.captionSb, color: colors.inkSecondary },
  segTxtOn: { color: colors.onDark },
  splitShare: { ...T.captionSb, color: colors.inkSecondary, minWidth: 74, textAlign: "right" },
  splitInput: {
    minWidth: 88, textAlign: "right", paddingHorizontal: spacing.sm, paddingVertical: 6,
    borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary,
    fontSize: 15, fontFamily: fontFamily.semibold, color: colors.ink,
  },
  splitFoot: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: colors.accentSoft, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2, marginTop: spacing.sm,
  },
  splitFootErr: { backgroundColor: colors.negativeSoft },
  splitFootTxt: { ...T.captionSb, color: colors.accentDark },
  splitFootTxtErr: { color: colors.negative },
  splitOk: {
    marginHorizontal: spacing.lg, marginTop: spacing.md, minHeight: 50,
    borderRadius: radius.pill, backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  splitOkTxt: { ...T.emph, color: colors.onBrand },
  avatar: { alignItems: "center", justifyContent: "center" },
  tag: { paddingHorizontal: spacing.sm + 2, paddingVertical: 3, borderRadius: radius.pill, alignSelf: "flex-start" },
  tagTxt: { fontSize: 11, lineHeight: 14, fontFamily: fontFamily.medium },
  merchant: { alignSelf: "flex-start", paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm },
  merchantTxt: { color: colors.onDark, fontSize: 10, lineHeight: 13, fontFamily: fontFamily.semibold, letterSpacing: 0.4 },
  chip: {
    flexDirection: "row", alignItems: "center", height: 38, paddingHorizontal: spacing.lg,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, flexShrink: 0,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipTxt: { ...T.bodySb, color: colors.inkSecondary },
  chipTxtActive: { color: colors.onBrand },
  primary: {
    backgroundColor: colors.brand, borderRadius: radius.pill, minHeight: 54,
    alignItems: "center", justifyContent: "center", flexDirection: "row",
    paddingHorizontal: spacing.xl,
  },
  primaryTxt: { ...T.emph, color: colors.onBrand },
});
