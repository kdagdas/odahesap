/**
 * Bildirim → ekran haritası.
 *
 * "Kadir ortak bir harcama yaptı" bildirimine dokunmak hiçbir şey
 * yapmıyordu; akla gelen ilk soru ("benim için ne aldı?") cevapsız kalıyor,
 * kullanıcı uygulamayı elleyip fişi kendi arıyordu. Sunucu gideceği yeri
 * **zaten biliyordu** — `notify()` her kayda `data` yazıyor ve
 * `GET /notifications` onu döndürüyor. Eksik olan tek şey bu haritaydı.
 *
 * **Tek yerde** duruyor çünkü iki ayrı yerden çağrılıyor: telefonun sistem
 * bildirimine dokunmak (`_layout.tsx`) ve Aktivite listesindeki satıra
 * dokunmak. İkisi ayrışırsa aynı bildirim iki farklı yere giderdi.
 *
 * `null` dönmesi "gidilecek bir yer yok" demek ve bu bir hata değil: Aktivite
 * o satırı dokunulamaz çizer (ok koymaz), sistem bildirimi ise Aktivite'yi
 * açar. Var olmayan bir yere gitmiş gibi yapmaktansa hiç gitmemek.
 */

export type BildirimHedefi = { pathname: string; params?: Record<string, string> };

/** Sunucunun `data` alanı — alanlar bildirim türüne göre değişiyor. */
export type BildirimVerisi = Record<string, unknown> | null | undefined;

const yazi = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;

/**
 * @param kind    sunucudaki `notify(..., kind, ...)` değeri
 * @param data    aynı çağrının `data` sözlüğü
 * @param geri    geri tuşu nereye dönsün (Aktivite'den gelindiyse Aktivite)
 */
export function bildirimYolu(
  kind: string | undefined,
  data: BildirimVerisi,
  geri?: string,
): BildirimHedefi | null {
  const d = data || {};
  const expenseId = yazi(d.expense_id);
  const ay = yazi(d.ay);
  const geriParam: Record<string, string> = geri ? { geri } : {};

  /* Harcama bildirimleri → Harcamalar, o ay, o fiş açılmış.
     Ayrı bir "fiş detayı" ekranı YOK ve olmayacak: Harcamalar satırı zaten
     kalem kalem açılıyor, ikincisini çizmek aynı işi iki yerde yapmak olurdu
     (Tur 10'da borç dökümü sayfası tam bu gerekçeyle silindi).

     `ay` ESKİ bildirimlerde yok. O zaman ekran bulunduğu ayı gösterir ve
     hiçbir şey açılmaz — geriye tarihli bir fişi bu ayın listesinde
     "bulmuş" gibi yapmaktansa sessiz kalmak. Aynısı silinen harcama için de
     geçerli: kayıt yok, açılacak satır da yok. */
  if (expenseId) {
    return {
      pathname: "/harcamalar",
      params: { expense: expenseId, ...(ay ? { ay } : {}), ...geriParam },
    };
  }

  switch (kind) {
    /* Ödeme kaydedildi · geri alındı · Ev ödeşti → Kasa, Ödeme Geçmişi açık.
       Bildirimin söylediği şey bir ÖDEME ve ödemenin yaşadığı yer o kart.
       Tek bir ödemeyi vurgulamıyoruz: geçmiş zaten tarihe göre sıralı ve
       bildirimi tetikleyen kayıt en üstte duruyor. */
    case "settlement":
    case "period_closed":
      return { pathname: "/(tabs)/denge", params: { gecmis: "1", ...geriParam } };

    /* Katılma isteği · isteğin onaylandı · ev arkadaşı ayrıldı → Ev ayarları.
       Yöneticinin onay düğmesi orada; onaylanan kişi de yeni evini orada
       görüyor. */
    case "join_request":
    case "member_left":
      return { pathname: "/ev-ayarlari", params: { ...geriParam } };

    /* Yeni düzenli gider (henüz harcamaya dönmemiş) → şablonun kendisi. */
    case "recurring":
      return { pathname: "/duzenli", params: { ...geriParam } };

    default:
      return null;
  }
}
