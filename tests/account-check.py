"""Iki hesabin durumunu goster (salt okunur)."""
import os

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(r"D:\SettleUp\OdaHesap\backend\.env")
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

for mail in ("kadirdagdas9@gmail.com", "kadirdagdas9@gmail.comk"):
    u = db.users.find_one({"email": mail}, {"_id": 0})
    print(f"\n--- {mail} ---")
    if not u:
        print("  KAYIT YOK")
        continue
    uid = u["user_id"]
    hh = db.households.find_one({"member_ids": uid}, {"_id": 0, "name": 1})
    pending = db.households.find_one({"pending_member_ids": uid}, {"_id": 0, "name": 1})
    print("  user_id   :", uid)
    print("  ad        :", u.get("name"))
    print("  olusturma :", u.get("created_at"))
    print("  ev        :", hh["name"] if hh else ("beklemede: " + pending["name"] if pending else "YOK"))
    print("  harcama   :", db.expenses.count_documents({"added_by": uid}))
    print("  liste     :", db.shopping_items.count_documents({"added_by": uid}))
    print("  odeme     :", db.settlements.count_documents(
        {"$or": [{"from_user_id": uid}, {"to_user_id": uid}]}))
    print("  oturum    :", db.user_sessions.count_documents({"user_id": uid}))
    print("  cihaz     :", db.devices.count_documents({"user_id": uid}))
    print("  fotograf  :", db.avatars.count_documents({"user_id": uid}))

print("\n--- toplam kullanici sayisi (test hesaplari haric) ---")
print(db.users.count_documents({"email": {"$not": {"$regex": "odahesap-e2e.com$"}}}))
