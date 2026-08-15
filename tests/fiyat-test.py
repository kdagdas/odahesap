"""Fiyat normallestirme testi -- birim fiyat ve paket sinifi.

Bu takim digerlerinden farkli: HTTP degil, dogrudan saf fonksiyonlari
cagiriyor. Sebep, korunan seyin bir uc degil bir HESAP olmasi. Fiyat
karsilastirmasinin tamami birim fiyata dayaniyor ve birim fiyat yanlissa
kullaniciya "fiyat iki katina cikti" diye yanlis uyari gider.

    cd backend
    .venv/Scripts/python.exe ../tests/fiyat-test.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + "/backend")
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + "/backend")

from dotenv import load_dotenv  # noqa: E402

load_dotenv()
import server  # noqa: E402

ok = fail = 0


def check(label, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  [OK]   {label}")
    else:
        fail += 1
        print(f"  [FAIL] {label}  {detail}")


def near(a, b, tol=0.005):
    return a is not None and abs(float(a) - float(b)) <= tol


print("\n-- 1. addan boyut ayiklama --")
for name, beklenen in [
    ("ZWIEBELN 2KG", (2.0, "kg")),
    ("PAPRIKA ROT 500G", (0.5, "kg")),
    ("PFIRSICHE 600G", (0.6, "kg")),
    ("Milch 1,5L", (1.5, "lt")),
    ("Wasser 750 ml", (0.75, "lt")),
    ("Sahne 200ml", (0.2, "lt")),
    ("6x0,33L Cola", (1.98, "lt")),
    ("4 x 150 g Joghurt", (0.6, "kg")),
]:
    got = server.parse_size(name)
    check(f"{name:22} -> {beklenen[0]} {beklenen[1]}",
          got and near(got[0], beklenen[0]) and got[1] == beklenen[1], str(got))

print("\n-- 2. boyut olmayan adlar --")
for name in ["Trauben dunkel", "Wagner Pic.Drei Kaese", "GURKEN", "BANANEN"]:
    check(f"{name:22} -> boyut yok", server.parse_size(name) is None,
          str(server.parse_size(name)))
# "1kg" gecmeyen ama rakam iceren adlar boyut sanilmamali
check("A101 marka adi boyut degil", server.parse_size("A101 SUT") is None,
      str(server.parse_size("A101 SUT")))

print("\n-- 3. urun anahtari --")
check("boyut anahtarin disinda",
      server.product_key("ZWIEBELN 2KG") == server.product_key("ZWIEBELN 1KG"),
      f"{server.product_key('ZWIEBELN 2KG')} vs {server.product_key('ZWIEBELN 1KG')}")
check("umlaut katlaniyor",
      server.product_key("Käse") == server.product_key("Kaese"),
      f"{server.product_key('Käse')} vs {server.product_key('Kaese')}")
check("buyuk/kucuk harf ayirmiyor",
      server.product_key("GURKEN") == server.product_key("gurken"))
check("noktalama temizleniyor",
      server.product_key("Wagner Pic.Drei") == server.product_key("Wagner Pic Drei"))
check("bos ad None", server.product_key("  ") is None)

print("\n-- 4. birim fiyat, uc paket sinifi --")
p = server.price_of_item({"name": "ZWIEBELN 2KG", "price": 1.69, "quantity": 1})
check("paketli: 1,69 / 2kg = 0,845/kg",
      p and p["pack_type"] == "paketli" and near(p["unit_price"], 0.845), str(p))
# Uc paket almak birim fiyati degistirmez -- miktar sadelesir.
p3 = server.price_of_item({"name": "PAPRIKA ROT 500G", "price": 1.59, "quantity": 3})
check("paketli: adet sayisi birim fiyati degistirmiyor",
      p3 and near(p3["unit_price"], 3.18), str(p3))

p = server.price_of_item({"name": "Trauben dunkel", "price": 10.99,
                          "quantity": 0.59, "unit": "kg"})
check("acik: tartilan urunde fiyat zaten kilo fiyati",
      p and p["pack_type"] == "acik" and near(p["unit_price"], 10.99), str(p))

p = server.price_of_item({"name": "BANANEN", "price": 0.76, "quantity": 1,
                          "unit": "adet"})
check("adet: birim fiyat uretilemiyor, adet fiyati saklaniyor",
      p and p["pack_type"] == "adet" and p["size_amount"] is None, str(p))

print("\n-- 5. OCR'in verdigi boyut ada tercih ediliyor --")
# Model fisin tamamini goruyor, ayristirici yalnizca adi. Ad "500G" dese de
# modelin verdigi 0,25 kg kazanmali.
p = server.price_of_item({"name": "SOMETHING 500G", "price": 2.0, "quantity": 1,
                          "size_amount": 0.25, "size_unit": "kg"})
check("model boyutu kazandi", p and near(p["unit_price"], 8.0), str(p))
# Bozuk boyut yok sayilmali, kalem yine islenmelidir.
p = server.price_of_item({"name": "GURKEN", "price": 1.11, "quantity": 1,
                          "size_amount": 0, "size_unit": "kg"})
check("sifir boyut yok sayildi", p and p["pack_type"] == "adet", str(p))
p = server.price_of_item({"name": "GURKEN", "price": 1.11, "size_amount": "abc"})
check("bozuk boyut kalemi dusurmedi", p is not None, str(p))

print("\n-- 6. islenemeyen kalemler --")
check("adsiz kalem atlaniyor", server.price_of_item({"name": "", "price": 5}) is None)
check("sifir fiyat atlaniyor",
      server.price_of_item({"name": "SUT", "price": 0}) is None)
check("indirim satiri (negatif) atlaniyor",
      server.price_of_item({"name": "RABATT", "price": -2.5}) is None)

print("\n-- 7. hafta cozunurlugu --")
check("2026-08-15 -> 2026-W33", server._iso_week("2026-08-15") == "2026-W33",
      server._iso_week("2026-08-15"))
check("ayni haftanin iki gunu ayni kova",
      server._iso_week("2026-08-10") == server._iso_week("2026-08-16"),
      f"{server._iso_week('2026-08-10')} vs {server._iso_week('2026-08-16')}")
check("bozuk tarih dusurmuyor", server._iso_week("abc").startswith("20"))
check("bos tarih dusurmuyor", server._iso_week(None).startswith("20"))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
