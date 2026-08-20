/**
 * Uygulamanın kendi haritası — aramada "ekranlar" bölümünü besleyen liste.
 *
 * ### Neden var
 *
 * "Ev arkadaşımı nasıl davet ederim" sorusu Profil → Ev ayarları → Davet
 * kartı yolunda takılıyordu. Menü satırlarına alt açıklama eklemek bunu
 * yumuşattı ama kökten çözmedi: ağaç yeterince derinleşince **hiçbir
 * gruplama herkesin zihnine uymaz.** iOS Ayarlar, Slack, Notion, Gmail —
 * hepsi aynı noktada ayarlarına arama ekledi. Arama, taksonomi tartışmasını
 * bitirir.
 *
 * ### Neden sunucuda değil
 *
 * Bu liste **veri değil, uygulamanın kendisi.** Sunucuya sorulsaydı ekran
 * eklemek iki yerde iş olurdu ve sürümler ayrışırdı: eski bir APK, sunucunun
 * bildiği yeni bir ekrana yönlendirilirdi. Burada duruyor, yani her APK
 * yalnızca gerçekten sahip olduğu ekranları buluyor.
 *
 * ### Anahtar kelimeler nasıl seçilir
 *
 * Ekranın ADI değil, insanın **aklından geçen kelime.** Kimse "ödeme
 * bilgilerim" diye aramaz; "IBAN" diye arar. Bu yüzden her satırda ekranın
 * içindeki somut şeyler yazılı — marka adları, alan adları, eylem
 * kelimeleri.
 */

/** Türkçe katlama: "sut" → "süt" eşleşsin. Sunucudaki `_FOLD` ile aynı iş. */
export function katla(s: string): string {
  return (s || "")
    .replace(/[ğĞ]/g, "g").replace(/[üÜ]/g, "u").replace(/[şŞ]/g, "s")
    .replace(/[ıI]/g, "i").replace(/[İ]/g, "i").replace(/[öÖ]/g, "o")
    .replace(/[çÇ]/g, "c").replace(/[äÄ]/g, "a").replace(/[ß]/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type UygulamaKaydi = {
  ad: string;
  /** Satırın altındaki tek satır — nereye gittiğini söyler. */
  alt: string;
  icon: string;
  rota: string;
  /** Aranacak kelimeler. Ekran adı ayrıca eklenmesin, o zaten aranıyor. */
  kelimeler: string[];
};

export const UYGULAMA_HARITASI: UygulamaKaydi[] = [
  {
    ad: "Ödeme bilgilerim", alt: "IBAN ve PayPal · telefonunda saklanır",
    icon: "card-outline", rota: "/odeme-bilgilerim",
    kelimeler: ["iban", "paypal", "hesap numarası", "banka", "para gönder",
                "ödeme bilgisi", "havale", "eft"],
  },
  {
    ad: "Ev ayarları", alt: "Üyeler, davet kodu, ev adı",
    icon: "home", rota: "/ev-ayarlari",
    kelimeler: ["davet", "davet kodu", "ev arkadaşı ekle", "üye ekle",
                "üye çıkar", "ev adı", "yönetici", "katıl", "kod"],
  },
  {
    ad: "Düzenli giderler", alt: "Kira, internet, her ay tekrarlayanlar",
    icon: "repeat", rota: "/duzenli",
    kelimeler: ["kira", "internet", "abonelik", "fatura", "her ay",
                "tekrar", "otomatik", "sabit gider"],
  },
  {
    ad: "Bildirimler", alt: "Hangi olaylar telefonuna düşsün",
    icon: "notifications-outline", rota: "/bildirimler",
    kelimeler: ["bildirim", "uyarı", "sessiz", "kapat", "push"],
  },
  {
    ad: "Aktivite", alt: "Evde neler oldu",
    icon: "time-outline", rota: "/aktivite",
    kelimeler: ["bildirim geçmişi", "neler oldu", "geçmiş bildirimler",
                "kaçırdım"],
  },
  {
    ad: "Uygulama ayarları", alt: "Tema, sürüm, çıkış",
    icon: "settings-outline", rota: "/ayarlar",
    kelimeler: ["tema", "karanlık", "koyu", "aydınlık", "dil", "sürüm",
                "çıkış", "oturumu kapat", "hakkında"],
  },
  {
    ad: "Profil", alt: "Adın, e-postan, şifren, fotoğrafın",
    icon: "person-circle-outline", rota: "/(tabs)/profil",
    kelimeler: ["ad değiştir", "e-posta", "şifre", "parola", "fotoğraf",
                "avatar", "hesabım"],
  },
  {
    ad: "Kasa", alt: "Kim kime borçlu, ödeme geçmişi",
    icon: "wallet-outline", rota: "/(tabs)/denge",
    kelimeler: ["borç", "alacak", "ödeş", "ödeştik", "kim kime",
                "bakiye", "ödeme geçmişi", "hesap"],
  },
  {
    ad: "Harcamalar", alt: "Bütün fişler ve kayıtlar",
    icon: "receipt-outline", rota: "/harcamalar",
    kelimeler: ["fiş", "harcama geçmişi", "kayıtlar", "ne aldık",
                "sil", "düzenle"],
  },
  {
    ad: "Analiz", alt: "Nereye gitti, zamlananlar, marketler",
    icon: "stats-chart-outline", rota: "/istatistik",
    kelimeler: ["istatistik", "grafik", "rapor", "zam", "zamlanan",
                "ucuzlayan", "fiyat", "kategori", "nereye gitti"],
  },
  {
    ad: "Alınacaklar", alt: "Eve ve kendine lazım olanlar",
    icon: "cart-outline", rota: "/(tabs)/liste?scope=household",
    kelimeler: ["liste", "market listesi", "alışveriş listesi", "lazım"],
  },
  {
    ad: "Fiş tara", alt: "Kamera ya da galeriden",
    icon: "scan-outline", rota: "/(tabs)/tara",
    kelimeler: ["tara", "kamera", "fotoğraf çek", "fiş oku", "ekle"],
  },
  {
    ad: "Elle harcama gir", alt: "Fişi olmayan harcamalar için",
    icon: "create-outline", rota: "/manual",
    kelimeler: ["elle gir", "manuel", "harcama ekle", "yeni harcama",
                "fişsiz"],
  },
];

/**
 * Sorguya uyan ekranlar — en iyi eşleşme başta.
 *
 * Sıralama ürün aramasıyla aynı merdiven: baştan eşleşme, kelime başı,
 * sonra içerme. Ekran adı, anahtar kelimelerden **daha ağır** basıyor —
 * "ayarlar" yazan biri "Uygulama ayarları"nı, kelimeler arasında "ayar"
 * geçen başka bir ekranı değil, önce görmeli.
 */
export function uygulamaAra(q: string): UygulamaKaydi[] {
  const a = katla(q);
  if (a.length < 2) return [];
  const puanla = (k: UygulamaKaydi): number | null => {
    const ad = katla(k.ad);
    if (ad.startsWith(a)) return 0;
    if (ad.split(" ").some((w) => w.startsWith(a))) return 1;
    let en: number | null = null;
    for (const kw of k.kelimeler) {
      const f = katla(kw);
      const p = f.startsWith(a) ? 2 : f.split(" ").some((w) => w.startsWith(a)) ? 3
        : f.includes(a) ? 4 : null;
      if (p !== null && (en === null || p < en)) en = p;
    }
    if (ad.includes(a)) return Math.min(en ?? 9, 4);
    return en;
  };
  return UYGULAMA_HARITASI
    .map((k) => ({ k, p: puanla(k) }))
    .filter((x): x is { k: UygulamaKaydi; p: number } => x.p !== null)
    .sort((x, y) => x.p - y.p)
    .map((x) => x.k)
    .slice(0, 5);
}
