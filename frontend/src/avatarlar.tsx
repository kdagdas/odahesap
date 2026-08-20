/**
 * Hazır avatarlar — hayvanlar.
 *
 * ### Neden hayvan
 *
 * Önce sekiz Ionicon vardı: kişi, gülen yüz, pizza, roket, yıldız, kalp,
 * yaprak, alev. Renkleri ayırt ediyordu ama şekilleri bir şey anlatmıyordu;
 * "roket olan" diye hatırlanan bir avatar, hatırlanmıyor demektir.
 *
 * Hayvan iki iş birden yapıyor: renkle ayrışıyor, siluetle tanınıyor. Ve
 * insan avatarının açtığı soruyu hiç açmıyor — ten rengi, cinsiyet, yaş.
 * Uygulama iki ülkede çalışıyor; kimsenin listede kendini araması gerekmesin.
 *
 * ### Neden SVG, neden burada çizili
 *
 * Dışarıdan bir avatar kütüphanesi çekmek yeni bir bağımlılık, lisans takibi
 * ve çevrimdışı bir soru demekti. `react-native-svg` zaten kurulu; çizimler
 * dosyanın içinde duruyor, uygulamayla birlikte geliyor.
 *
 * ### Küçüldüğünde ayakta kalması için üç kural
 *
 * Avatar çoğu yerde 18–34 piksel. O boyutta ayrıntı yok olur, geriye
 * **renk** ve **siluet** kalır. Bu yüzden her çizim:
 *
 *   1. tek dolgu gövde + en fazla bir koyu gölge — çizgi/kontur yok,
 *   2. iri beyaz göz + koyu bebek — 18 pikselde bile iki nokta olarak okunur,
 *   3. ayırt eden tek bir uzuv (sivri kulak, uzun kulak, gaga, boynuz).
 *
 * Gövde çerçeveden taşıyor: portre gibi duruyor, ikon gibi değil.
 *
 * ### Kimlikler KORUNUYOR
 *
 * `avatar_id` veritabanında duruyor ve kimse yeniden seçmeyecek. Yeni sıra,
 * eski sıranın RENGİNİ takip ediyor: sarı gülen yüz (1) → sarı zeminli inek,
 * kırmızı pizza (2) → kırmızı kuş, mavi roket (3) → mavi kurt, mor yıldız
 * (4) → mor baykuş, pembe kalp (5) → pembe domuz, yeşil yaprak (6) → yeşil
 * kurbağa, turuncu alev (7) → turuncu kedi. Kullanıcı yarın uygulamayı
 * açtığında avatarını değişmiş değil, BÜYÜMÜŞ buluyor.
 *
 * 0 hayvan DEĞİL ve bu bilerek: hiç seçim yapmamış herkesin varsayılanı o.
 * Oraya bir hayvan koymak, üç kişilik yeni bir evde üç aynı hayvan demekti —
 * seçilmemiş bir avatar, seçilmiş gibi görünmemeli.
 */
import React from "react";
import { View } from "react-native";
import Svg, { Circle, Ellipse, G, Path, Rect } from "react-native-svg";

export type AvatarPreset = { id: number; ad: string; color: string };

/** Sıra ve renkler yukarıdaki "kimlikler korunuyor" kuralına bağlı. */
export const AVATARS: AvatarPreset[] = [
  { id: 0, ad: "Yok", color: "#0F1B33" },
  { id: 1, ad: "İnek", color: "#F7C64F" },
  { id: 2, ad: "Kuş", color: "#FCF2C9" },
  { id: 3, ad: "Kurt", color: "#C9DAE1" },
  { id: 4, ad: "Baykuş", color: "#E7DFF6" },
  { id: 5, ad: "Domuz", color: "#D3EDE0" },
  { id: 6, ad: "Kurbağa", color: "#D8EBF3" },
  { id: 7, ad: "Kedi", color: "#CFEDE8" },
  { id: 8, ad: "Tavşan", color: "#FBE2D6" },
  { id: 9, ad: "Tavuk", color: "#FCE8A8" },
  { id: 10, ad: "At", color: "#F9DDE2" },
  { id: 11, ad: "Güvercin", color: "#EAEAE7" },
  { id: 12, ad: "Koyun", color: "#E4E0D9" },
  { id: 13, ad: "Köpek", color: "#F4E5D4" },
];

export const getAvatar = (id?: number | null): AvatarPreset =>
  AVATARS[id ?? 0] || AVATARS[0];

/* Göz her çizimde aynı: iri beyaz daire + koyu bebek + tek parlama. Tek
   yerde durması, on üç hayvanın aynı aileye benzemesini garanti ediyor. */
const KOYU = "#2B2119";

function Goz({ x, y, r = 6.5 }: { x: number; y: number; r?: number }) {
  return (
    <G>
      <Circle cx={x} cy={y} r={r} fill="#FFFFFF" />
      <Circle cx={x + 0.4} cy={y + 0.5} r={r * 0.51} fill={KOYU} />
      <Circle cx={x + 1.4} cy={y - 0.9} r={r * 0.2} fill="#FFFFFF" />
    </G>
  );
}

/** Küçük koyu göz — postu beyaz olan hayvanda beyaz göz kayboluyor. */
function Nokta({ x, y, r = 4 }: { x: number; y: number; r?: number }) {
  return (
    <G>
      <Circle cx={x} cy={y} r={r} fill={KOYU} />
      <Circle cx={x + 1.2} cy={y - 1.2} r={r * 0.33} fill="#FFFFFF" />
    </G>
  );
}

const CIZIMLER: Record<number, React.ReactElement> = {
  /* 0 — hayvan değil: seçilmemiş avatar. Koyu lacivert, beyaz silüet. */
  0: (
    <G>
      <Rect width={64} height={64} fill="#0F1B33" />
      <Circle cx={32} cy={26} r={11} fill="#FFFFFF" opacity={0.92} />
      <Path d="M12 64c0-12 9-20 20-20s20 8 20 20z" fill="#FFFFFF" opacity={0.92} />
    </G>
  ),

  /* 1 — İNEK. Sarı zemin: eski sarı gülen yüzün yerini alıyor. */
  1: (
    <G>
      <Rect width={64} height={64} fill="#F7C64F" />
      <Path d="M14 20c-4-3-6-8-3-9 3-1 6 3 7 7zM50 20c4-3 6-8 3-9-3-1-6 3-7 7z" fill="#3B3129" />
      <Ellipse cx={32} cy={40} rx={21} ry={21} fill="#FCFAF6" />
      <Path d="M32 19c-6 0-11 3-14 8 5 4 12 3 16-2 2-3 1-6-2-6z" fill="#DE4C3C" />
      <Ellipse cx={13} cy={35} rx={6} ry={5} fill="#F0AFB6" />
      <Ellipse cx={51} cy={35} rx={6} ry={5} fill="#F0AFB6" />
      <Ellipse cx={32} cy={52} rx={13} ry={10} fill="#F3B0B8" />
      <Ellipse cx={27} cy={51} rx={2} ry={2.6} fill="#C97E88" />
      <Ellipse cx={37} cy={51} rx={2} ry={2.6} fill="#C97E88" />
      <Goz x={24} y={38} />
      <Goz x={40} y={38} />
    </G>
  ),

  /* 2 — KUŞ. Kırmızı gövde: eski kırmızı pizzanın yerine. */
  2: (
    <G>
      <Rect width={64} height={64} fill="#FCF2C9" />
      <Path d="M28 47v11M36 47v11M24 60h8M32 60h8" stroke="#E8622F" strokeWidth={2.2} strokeLinecap="round" />
      <Circle cx={32} cy={33} r={17} fill="#E03A2C" />
      <Path d="M32 30c7-1 12 3 13 8-5 3-12 1-15-3z" fill="#EE7A4A" />
      <Path d="M15 30l-8 3 8 3z" fill="#F0A02E" />
      <Goz x={24} y={27} r={7} />
    </G>
  ),

  /* 3 — KURT. Mavi: eski mavi roketin yerine. */
  3: (
    <G>
      <Rect width={64} height={64} fill="#C9DAE1" />
      <Path d="M14 30L17 8l13 13zM50 30L47 8 34 21z" fill="#4E93BE" />
      <Path d="M17 16l9 8-9 5zM47 16l-9 8 9 5z" fill="#8FC0DC" />
      <Ellipse cx={32} cy={40} rx={21} ry={22} fill="#5CA3CE" />
      <Path d="M32 19c-4 0-6 3-6 8s2 9 6 12z" fill="#EAF3F8" opacity={0.85} />
      <Ellipse cx={32} cy={52} rx={11} ry={8} fill="#3E7FA6" />
      <Ellipse cx={32} cy={48} rx={4.2} ry={3.2} fill="#20303A" />
      <Goz x={23} y={36} />
      <Goz x={41} y={36} />
    </G>
  ),

  /* 4 — BAYKUŞ. Mor: eski mor yıldızın yerine. */
  4: (
    <G>
      <Rect width={64} height={64} fill="#E7DFF6" />
      <Path d="M12 30l3-14 12 9zM52 30l-3-14-12 9z" fill="#7C63B8" />
      <Ellipse cx={32} cy={40} rx={21} ry={22} fill="#8B6FC4" />
      <Path d="M46 24a15 16 0 018 16 15 16 0 01-8 16z" fill="#7259AC" />
      <Ellipse cx={32} cy={38} rx={19} ry={14} fill="#BCA9E2" />
      <Goz x={23} y={37} r={8} />
      <Goz x={41} y={37} r={8} />
      <Path d="M32 45l-4 5h8z" fill="#F0A02E" />
      <Path d="M25 62v-4M39 62v-4" stroke="#F0A02E" strokeWidth={3} strokeLinecap="round" />
    </G>
  ),

  /* 5 — DOMUZ. Pembe gövde: eski pembe kalbin yerine. */
  5: (
    <G>
      <Rect width={64} height={64} fill="#D3EDE0" />
      <Path d="M13 28l3-14 12 10zM51 28l-3-14-12 10z" fill="#EFA0AC" />
      <Ellipse cx={32} cy={42} rx={22} ry={21} fill="#F3AEB8" />
      <Ellipse cx={32} cy={52} rx={11} ry={8.5} fill="#E58E9C" />
      <Ellipse cx={28} cy={52} rx={2} ry={2.6} fill="#B85F70" />
      <Ellipse cx={36} cy={52} rx={2} ry={2.6} fill="#B85F70" />
      <Goz x={23} y={37} />
      <Goz x={41} y={37} />
    </G>
  ),

  /* 6 — KURBAĞA. Yeşil: eski yeşil yaprağın yerine. */
  6: (
    <G>
      <Rect width={64} height={64} fill="#D8EBF3" />
      <Rect x={10} y={24} width={44} height={42} rx={19} fill="#6FBE55" />
      <Circle cx={21} cy={26} r={11} fill="#6FBE55" />
      <Circle cx={43} cy={26} r={11} fill="#6FBE55" />
      <Goz x={21} y={26} r={7.5} />
      <Goz x={43} y={26} r={7.5} />
      <Path d="M24 44c4 5 12 5 16 0" stroke="#33671F" strokeWidth={2.6} fill="none" strokeLinecap="round" />
    </G>
  ),

  /* 7 — KEDİ. Turuncu: eski turuncu alevin yerine. */
  7: (
    <G>
      <Rect width={64} height={64} fill="#CFEDE8" />
      <Path d="M15 30L18 9l13 12zM49 30L46 9 33 21z" fill="#E88434" />
      <Rect x={12} y={17} width={40} height={46} rx={18} fill="#F49B49" />
      <Rect x={22} y={21} width={3} height={8} rx={1.5} fill="#DC7A2C" />
      <Rect x={30.5} y={19} width={3} height={9} rx={1.5} fill="#DC7A2C" />
      <Rect x={39} y={21} width={3} height={8} rx={1.5} fill="#DC7A2C" />
      <Ellipse cx={32} cy={47} rx={13} ry={9} fill="#FBEBDA" />
      <Goz x={24} y={38} />
      <Goz x={40} y={38} />
      <Path d="M29 45h6l-3 3z" fill="#E88C8C" />
      <Path d="M8 42h8M8 48h8M56 42h-8M56 48h-8" stroke={KOYU} strokeWidth={1.4} strokeLinecap="round" opacity={0.5} />
    </G>
  ),

  /* 8 — TAVŞAN. Beyaz post: göz beyazı kaybolacağı için koyu nokta. */
  8: (
    <G>
      <Rect width={64} height={64} fill="#FBE2D6" />
      <Ellipse cx={23} cy={16} rx={6} ry={16} fill="#FAF7F4" />
      <Ellipse cx={41} cy={16} rx={6} ry={16} fill="#FAF7F4" />
      <Ellipse cx={23} cy={17} rx={3} ry={11} fill="#F4C3C8" />
      <Ellipse cx={41} cy={17} rx={3} ry={11} fill="#F4C3C8" />
      <Ellipse cx={32} cy={45} rx={21} ry={22} fill="#FDFBF9" />
      <Path d="M32 23a21 22 0 00-21 22 21 22 0 0021 22z" fill="#F1ECE7" opacity={0.55} />
      <Nokta x={24} y={42} r={4.2} />
      <Nokta x={40} y={42} r={4.2} />
      <Path d="M29 51h6l-3 3z" fill="#E79AA2" />
    </G>
  ),

  /* 9 — TAVUK. Tek göz: profilden duruyor, ikinci göz yalan olurdu. */
  9: (
    <G>
      <Rect width={64} height={64} fill="#FCE8A8" />
      <Path d="M28 16c0-4 3-6 5-4 1-4 5-4 6-1 3-1 5 2 3 5z" fill="#E2453A" />
      <Ellipse cx={35} cy={42} rx={21} ry={20} fill="#FEFCF8" />
      <Path d="M16 33l-9 4 9 5z" fill="#EE8B2E" />
      <Ellipse cx={45} cy={45} rx={10} ry={8} fill="#F0E8DC" />
      <Goz x={26} y={33} />
    </G>
  ),

  /* 10 — AT. Yandan: uzun kafa ancak profilden at olarak okunuyor. */
  10: (
    <G>
      <Rect width={64} height={64} fill="#F9DDE2" />
      <Path d="M20 20l-3-11 9 7zM33 17l1-11 7 9z" fill="#E2702F" />
      <Path d="M40 22c8 4 11 14 9 24l-30 20V32c0-8 6-13 12-13 3 0 6 1 9 3z" fill="#EC8038" />
      <Path d="M40 22c-4-2-7-3-9-3-6 0-12 5-12 13v6c0-9 8-15 14-14 4 1 6 2 7-2z" fill="#5C3826" />
      <Ellipse cx={26} cy={45} rx={9} ry={7} fill="#F7E4D2" />
      <Ellipse cx={24} cy={44} rx={2} ry={1.6} fill="#8A4E2E" />
      <Goz x={35} y={33} />
    </G>
  ),

  /* 11 — GÜVERCİN. */
  11: (
    <G>
      <Rect width={64} height={64} fill="#EAEAE7" />
      <Path d="M28 48v10M37 48v10M24 60h8M33 60h8" stroke="#E8622F" strokeWidth={2.2} strokeLinecap="round" />
      <Circle cx={33} cy={33} r={18} fill="#98A0A8" />
      <Path d="M36 24c6 0 11 3 13 7M38 20c5 1 9 4 11 8M40 17c4 2 7 5 8 8" stroke="#C3C9CE" strokeWidth={2.6} fill="none" strokeLinecap="round" />
      <Path d="M16 31l-9 3 9 4z" fill="#F0A02E" />
      <Goz x={25} y={29} r={7.5} />
    </G>
  ),

  /* 12 — KOYUN. Yığılmış daireler yün oluyor; tek şekille olmuyor. */
  12: (
    <G>
      <Rect width={64} height={64} fill="#E4E0D9" />
      <Ellipse cx={11} cy={38} rx={6} ry={4.5} fill="#EFA0AC" />
      <Ellipse cx={53} cy={38} rx={6} ry={4.5} fill="#EFA0AC" />
      <Circle cx={20} cy={30} r={11} fill="#FCFAF6" />
      <Circle cx={44} cy={30} r={11} fill="#FCFAF6" />
      <Circle cx={32} cy={24} r={12} fill="#FCFAF6" />
      <Ellipse cx={32} cy={44} rx={21} ry={19} fill="#FDFCFA" />
      <Circle cx={15} cy={46} r={9} fill="#FCFAF6" />
      <Circle cx={49} cy={46} r={9} fill="#FCFAF6" />
      <Nokta x={24} y={42} r={3.8} />
      <Nokta x={40} y={42} r={3.8} />
      <Ellipse cx={17} cy={49} rx={4} ry={2.6} fill="#F5C3C8" opacity={0.8} />
      <Ellipse cx={47} cy={49} rx={4} ry={2.6} fill="#F5C3C8" opacity={0.8} />
      <Ellipse cx={32} cy={50} rx={3} ry={2.2} fill="#E08E9A" />
    </G>
  ),

  /* 13 — KÖPEK. */
  13: (
    <G>
      <Rect width={64} height={64} fill="#F4E5D4" />
      <Ellipse cx={13} cy={38} rx={8} ry={14} fill="#8A5327" />
      <Ellipse cx={51} cy={38} rx={8} ry={14} fill="#8A5327" />
      <Ellipse cx={32} cy={40} rx={21} ry={21} fill="#D89446" />
      <Path d="M45 26a13 13 0 018 12 13 13 0 01-8 12z" fill="#8A5327" />
      <Ellipse cx={32} cy={50} rx={13} ry={10} fill="#FAF1E4" />
      <Ellipse cx={32} cy={45} rx={4} ry={3.2} fill={KOYU} />
      <Path d="M32 48v4M28 54c2 2 6 2 8 0" stroke={KOYU} strokeWidth={1.8} fill="none" strokeLinecap="round" />
      <Goz x={24} y={35} />
      <Goz x={41} y={35} />
    </G>
  ),
};

/**
 * Bir avatarı çizer. Daireye kırpma `overflow: "hidden"` ile yapılıyor —
 * SVG `ClipPath`'i her platformda aynı davranmıyor, `borderRadius` davranıyor.
 */
export function AvatarCizim({ id, size }: { id?: number | null; size: number }) {
  const cizim = CIZIMLER[id ?? 0] || CIZIMLER[0];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden" }}>
      <Svg width={size} height={size} viewBox="0 0 64 64">{cizim}</Svg>
    </View>
  );
}
