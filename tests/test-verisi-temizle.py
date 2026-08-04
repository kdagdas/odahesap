"""Test takimlarinin biraktigi hesaplari ve verilerini temizler.

Test betikleri kendi hesaplarini olusturup evden ayriliyor ama kullanici
kaydini silmiyordu; her calistirmada birikiyorlardi. Hepsinin e-postasi
@odahesap-e2e.com ile bitiyor, yani gercek kullanicilardan kesin ayirt
edilebiliyorlar.

Once ne silinecegini yazar, --sil verilmedikce hicbir sey silmez.

Kullanim:
    .venv/Scripts/python.exe ../tests/test-verisi-temizle.py         # sadece goster
    .venv/Scripts/python.exe ../tests/test-verisi-temizle.py --sil
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parents[1] / "backend" / ".env")

TEST_DOMAIN = "@odahesap-e2e.com"
SIL = "--sil" in sys.argv


def main() -> int:
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

    test_users = list(db.users.find({"email": {"$regex": f"{TEST_DOMAIN}$"}}, {"_id": 0, "user_id": 1, "email": 1}))
    test_ids = [u["user_id"] for u in test_users]
    gercek = list(db.users.find({"email": {"$not": {"$regex": f"{TEST_DOMAIN}$"}}}, {"_id": 0, "email": 1}))

    print(f"Gercek kullanicilar ({len(gercek)}) — bunlara DOKUNULMAYACAK:")
    for u in gercek:
        print("   ", u["email"])

    # Test kullanicilarinin kurdugu evler; icindeki her sey onlarla gider.
    hh_ids = [h["household_id"] for h in db.households.find(
        {"created_by": {"$in": test_ids}}, {"_id": 0, "household_id": 1})]

    # Kurucusu artik var olmayan evler de yetim kalmis test kalintisidir:
    # bazi betikler kullanicisini siliyor ama kurdugu evi birakiyordu, bu
    # yuzden yukaridaki sorgu onlari hic gormuyordu. Uyesi olan bir evi asla
    # dokunmadan birak — gercek bir ev olabilir.
    tum_kullanicilar = {u["user_id"] for u in db.users.find({}, {"_id": 0, "user_id": 1})}
    for h in db.households.find({}, {"_id": 0, "household_id": 1, "created_by": 1, "member_ids": 1}):
        if (h["household_id"] not in hh_ids
                and h.get("created_by") not in tum_kullanicilar
                and not h.get("member_ids")):
            hh_ids.append(h["household_id"])

    plan = {
        "users": db.users.count_documents({"user_id": {"$in": test_ids}}),
        "user_sessions": db.user_sessions.count_documents({"user_id": {"$in": test_ids}}),
        "devices": db.devices.count_documents({"user_id": {"$in": test_ids}}),
        "avatars": db.avatars.count_documents({"user_id": {"$in": test_ids}}),
        "households": db.households.count_documents({"household_id": {"$in": hh_ids}}),
        "periods": db.periods.count_documents({"household_id": {"$in": hh_ids}}),
        "expenses": db.expenses.count_documents({"household_id": {"$in": hh_ids}}),
        "settlements": db.settlements.count_documents({"household_id": {"$in": hh_ids}}),
        "shopping_items": db.shopping_items.count_documents(
            {"$or": [{"household_id": {"$in": hh_ids}}, {"added_by": {"$in": test_ids}}]}),
    }

    if not test_ids and not hh_ids:
        print("\nTemizlenecek test verisi yok.")
        return 0

    print(f"\nSilinecek test verisi ({len(test_ids)} hesap, {len(hh_ids)} ev):")
    for k, v in plan.items():
        print(f"   {k:<16} {v}")

    if not SIL:
        print("\nHicbir sey silinmedi. Silmek icin --sil ekleyin.")
        return 0

    db.shopping_items.delete_many({"$or": [{"household_id": {"$in": hh_ids}}, {"added_by": {"$in": test_ids}}]})
    db.settlements.delete_many({"household_id": {"$in": hh_ids}})
    db.expenses.delete_many({"household_id": {"$in": hh_ids}})
    db.periods.delete_many({"household_id": {"$in": hh_ids}})
    db.households.delete_many({"household_id": {"$in": hh_ids}})
    db.avatars.delete_many({"user_id": {"$in": test_ids}})
    db.devices.delete_many({"user_id": {"$in": test_ids}})
    db.user_sessions.delete_many({"user_id": {"$in": test_ids}})
    db.users.delete_many({"user_id": {"$in": test_ids}})

    print("\nSilindi. Kalan:")
    for name in ("users", "households", "expenses", "periods", "settlements", "shopping_items"):
        print(f"   {name:<16} {db[name].count_documents({})}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
