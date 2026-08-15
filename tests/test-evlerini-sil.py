"""Test kosularindan biriken evleri ve kullanicilari siler.

Her test kosusu yeni kullanici ve ev yaratiyor; zamanla veritabani bunlarla
doluyor ve gercek veriyi bulmak zorlasiyor.

GUVENLIK: silinecek ev listesi ADLA degil, KORUNACAK ev kimligiyle belirlenir.
"Su ada benziyorsa sil" kurali, gercek bir evin adi degistiginde felakete
donusur. Korunacak ev acikca yazilir, geri kalan her sey gider.

Kullanici silme daha da dar: yalnizca e-postasi test alan adlarindan biriyle
biten hesaplar. Gercek bir gmail adresi hicbir kosulda silinmez.

Kullanim:
    cd backend
    .venv/Scripts/python.exe ../tests/test-evlerini-sil.py --kuru
    .venv/Scripts/python.exe ../tests/test-evlerini-sil.py --onayla
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parents[1] / "backend" / ".env")

# Bu evler asla silinmez. Yeni gercek ev eklendikce buraya yazilir.
KORUNAN_EVLER = {"hh_2ca8b3e81966"}          # Kadir ve Cariyeleri

# Yalnizca bu alan adlarindaki hesaplar silinebilir.
TEST_ALANLARI = ("@odahesap-e2e.com", "@x.co", "@ornek.com")

ONAY = "--onayla" in sys.argv


def main() -> int:
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

    for hid in KORUNAN_EVLER:
        if not db.households.find_one({"household_id": hid}):
            print(f"DURDURULDU: korunacak ev bulunamadi ({hid}).")
            print("Yanlis veritabanina baglanmis olabilirsiniz. Hicbir sey silinmedi.")
            return 1

    silinecek = [h["household_id"] for h in db.households.find(
        {"household_id": {"$nin": list(KORUNAN_EVLER)}}, {"_id": 0, "household_id": 1})]

    korunan_uyeler = set()
    for hid in KORUNAN_EVLER:
        hh = db.households.find_one({"household_id": hid}, {"_id": 0})
        korunan_uyeler |= set(hh.get("member_ids", [])) | set(hh.get("pending_member_ids", []))

    test_kullanicilar = [
        u["user_id"] for u in db.users.find({}, {"_id": 0, "user_id": 1, "email": 1})
        if u["user_id"] not in korunan_uyeler
        and any(u.get("email", "").endswith(d) for d in TEST_ALANLARI)
    ]

    print(f"Korunan ev: {', '.join(KORUNAN_EVLER)}  ({len(korunan_uyeler)} uye)")
    print(f"Silinecek ev: {len(silinecek)}")
    print(f"Silinecek test kullanicisi: {len(test_kullanicilar)}")

    hh_q = {"household_id": {"$in": silinecek}}
    us_q = {"user_id": {"$in": test_kullanicilar}}
    plan = [
        ("expenses", hh_q), ("periods", hh_q), ("settlements", hh_q),
        ("shopping_items", hh_q), ("expense_revisions", hh_q),
        ("households", {"household_id": {"$in": silinecek}}),
        ("users", us_q), ("user_sessions", us_q), ("devices", us_q),
    ]

    print()
    toplam = 0
    for ad, q in plan:
        n = db[ad].count_documents(q)
        toplam += n
        print(f"  {ad:20} {n}")

    # Ev harcamalarinin bir kismi ev silinse de kisisel scope ile kalabilir;
    # sayimi sonra dogrulamak icin gercek evin rakamlarini yaziyoruz.
    gercek = db.expenses.count_documents({"household_id": {"$in": list(KORUNAN_EVLER)}})
    print(f"\nKorunan evin harcamasi: {gercek} (bu sayi degismemeli)")

    if not ONAY:
        print(f"\nKURU CALISMA -- {toplam} kayit silinecekti. Gercekten silmek icin --onayla")
        return 0

    for ad, q in plan:
        n = db[ad].delete_many(q).deleted_count
        print(f"  {ad:20} {n} silindi")

    sonra = db.expenses.count_documents({"household_id": {"$in": list(KORUNAN_EVLER)}})
    print(f"\nKorunan evin harcamasi: {sonra}")
    if sonra != gercek:
        print("!! UYARI: korunan evin harcama sayisi degisti, yedekten kontrol edin.")
        return 1
    print("Korunan ev bozulmadi.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
