"""Analiz uclari: Son 6 Ay serisi, urun bazli toplam, kategori sayfasi.

Tur 11'in ilk uc maddesi. Uc soru:

  1. `son_aylar` cubugundaki bir ayin toplami, o aya girildiginde gorunen
     toplamla AYNI mi? (Ikisi de `_kapsa` okuyor; ayrisirlarsa kullanici
     cubukta bir sayi gorup dokundugunda baskasini bulur.)
  2. Urun toplama `product_key` uzerinden calisiyor mu -- yani ayni urunun
     farkli market markalari TEK satirda birlesiyor mu? Tur 8'in genel urun
     adi isi bunun altyapisi.
  3. Kategori sayfasi fisin YALNIZCA o kategorideki kismini mi sayiyor?
     Fisin tamamini saymak kategori toplamini sisirir ve halkadaki dilimle
     celisirdi.

    cd backend
    .venv/Scripts/python.exe ../tests/analiz-test.py http://127.0.0.1:8090

Sunucuyu AYRI veritabaniyla baslatin: DB_NAME=odahesap_test
"""
import sys
import uuid
from datetime import date

import httpx

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8001").rstrip("/")
API = f"{BASE}/api"
TAG = uuid.uuid4().hex[:8]
AY = date.today().strftime("%Y-%m")

ok = fail = 0


def check(label, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  [OK]   {label}")
    else:
        fail += 1
        print(f"  [FAIL] {label}  {detail}")


def hdr(t):
    return {"Authorization": f"Bearer {t}"}


c = httpx.Client(timeout=90.0)
r = c.post(f"{API}/auth/register", json={
    "email": f"anz_{TAG}@odahesap-e2e.com", "password": "sifre123", "name": "Anz Test"})
r.raise_for_status()
tok = r.json()["session_token"]
c.post(f"{API}/households", headers=hdr(tok), json={"name": f"Analiz Ev {TAG}"})


def harcama(**kw):
    kw.setdefault("target_type", "household")
    kw.setdefault("source", "receipt")
    r = c.post(f"{API}/expenses", headers=hdr(tok), json=kw)
    r.raise_for_status()
    return r.json()["expense"]["expense_id"]


def kalem(ad, fiyat, adet=1, kategori="sut_urunleri", birim="adet", genel=None):
    k = {"name": ad, "price": fiyat, "quantity": adet,
         "category": kategori, "unit": birim}
    # `generic`: fis okunurken her kaleme yazilan "bu urun aslinda NE" adi.
    # Tur 8'in isi; urun toplama bunun uzerine kuruluyor.
    if genel:
        k["generic"] = genel
    return k


print("\n-- harcamalar --")
# Ayni urun UC FARKLI market markasiyla: `product_key` ucunu de "milch"e
# indirmeli, yani tek satirda birlesmeli. Tur 8'in isi tam olarak bu.
harcama(total=10.0, merchant="LIDL", items=[
    kalem("MILBONA MILCH 1L", 4.0, genel="süt"),
    kalem("Spülmittel", 6.0, kategori="ev_urunleri", genel="bulaşık deterjanı")])
harcama(total=7.0, merchant="ALDI", items=[kalem("MILSANI MILCH 1L", 7.0, genel="süt")])
harcama(total=3.0, merchant="REWE", items=[kalem("JA! MILCH 1L", 3.0, genel="süt")])
# GENEL ADI OLMAYAN kayit (Tur 8 oncesi ya da OCR cikaramamis): yedek yol ham
# addan anahtar uretmeli, yoksa bu kalemler istatistikten tamamen dusrerdi.
harcama(total=5.0, merchant="LIDL", items=[
    kalem("BUTTER 250G", 5.0, kategori="sut_urunleri")])
check("harcamalar yazildi", True)

s = c.get(f"{API}/stats/monthly?month={AY}", headers=hdr(tok)).json()

print("\n-- 1. SON 6 AY serisi --")
seri = s.get("son_aylar") or []
check("alti ay donuyor", len(seri) == 6, str(len(seri)))
check("eskiden yeniye sirali",
      [x["month"] for x in seri] == sorted(x["month"] for x in seri), str(seri))
check("son eleman bu ay", seri and seri[-1]["month"] == AY, str(seri[-1:]))
# DEGISMEZLIK: cubuktaki ay ile o ayin kendi toplami ayni olmali.
bu = next(x for x in seri if x["month"] == AY)
check("cubuktaki toplam = ayin toplami",
      abs(bu["total"] - s["total"]) < 0.01, f"{bu['total']} vs {s['total']}")
check("bos aylar da donuyor (delik yok)",
      all("total" in x for x in seri), str(seri))

print("\n-- 2. URUN BAZLI toplam --")
urunler = s.get("products") or []
sut = [u for u in urunler if u["key"] == "sut"]
check("uc market markasi TEK satirda (genel ad)", len(sut) == 1,
      str([u["key"] for u in urunler]))
if sut:
    u = sut[0]
    check("toplam 14,00 (4+7+3)", abs(u["total"] - 14.0) < 0.01, str(u))
    check("uc markette gorundu", u["market_count"] == 3, str(u))
    check("uc kalem sayildi", u["count"] == 3, str(u))
    # Ekranda GENEL ad yaziyor, market markasi degil.
    check("ekranda genel ad", u["name"] == "Süt", str(u["name"]))
# Genel adi olmayan kalem yedek yolla kendi satirinda duruyor -- kaybolmuyor.
tere = [u for u in urunler if "butter" in u["key"]]
check("genel adi olmayan kalem yedek yolla geliyor", len(tere) == 1,
      str([u["key"] for u in urunler]))
check("urun sayisi ayrica donuyor", s.get("product_count", 0) >= 2, str(s.get("product_count")))
check("liste buyukten kucuge", [u["total"] for u in urunler]
      == sorted((u["total"] for u in urunler), reverse=True), str(urunler))

r = c.get(f"{API}/stats/products?month={AY}", headers=hdr(tok)).json()
check("tum urunler ucu ayni sayiyi veriyor",
      len(r["products"]) == s.get("product_count"), str(len(r["products"])))

print("\n-- 3. KATEGORI sayfasi --")
k = c.get(f"{API}/stats/category?key=sut_urunleri&month={AY}", headers=hdr(tok)).json()
# LIDL fisi 10 EUR ama yalnizca 4 EUR'su sut; kategori toplami 14 olmali (4+7+3),
# fisin tamamini sayarsa 20 cikar ve halkadaki dilimle celisir.
check("fisin YALNIZCA o kategorideki kismi sayildi",
      abs(k["total"] - 19.0) < 0.01, str(k["total"]))
check("alti aylik seri var", len(k.get("series") or []) == 6, str(len(k.get("series") or [])))
check("serinin son ayi bu ayin toplamini tutuyor",
      abs(k["series"][-1]["total"] - k["total"]) < 0.01, str(k["series"][-1:]))
check("ne alindi: sut tek satir",
      len([p for p in k["products"] if p["key"] == "sut"]) == 1, str(k["products"]))
check("nereden: uc market", len(k["merchants"]) == 3, str(k["merchants"]))
check("market toplamlari kategoriye ait",
      abs(sum(m["total"] for m in k["merchants"]) - 19.0) < 0.01, str(k["merchants"]))

k2 = c.get(f"{API}/stats/category?key=ev_urunleri&month={AY}", headers=hdr(tok)).json()
check("diger kategori yalnizca kendi kismini sayiyor",
      abs(k2["total"] - 6.0) < 0.01, str(k2["total"]))
check("o kategoride tek market", len(k2["merchants"]) == 1, str(k2["merchants"]))

bos = c.get(f"{API}/stats/category?key=uydurma&month={AY}", headers=hdr(tok)).json()
check("bilinmeyen kategori bos donuyor", abs(bos["total"]) < 0.01, str(bos["total"]))

print("\n-- temizlik --")
c.post(f"{API}/households/leave", headers=hdr(tok))
c.post(f"{API}/auth/logout", headers=hdr(tok))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
