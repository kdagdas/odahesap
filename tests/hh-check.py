"""Kalan evleri listele."""
import os

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(r"D:\SettleUp\OdaHesap\backend\.env")
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

isim = {u["user_id"]: u["email"] for u in db.users.find({}, {"_id": 0, "user_id": 1, "email": 1})}

for h in db.households.find({}, {"_id": 0}):
    uyeler = [isim.get(m, m) for m in h.get("member_ids", [])]
    print(f"\n{h['name']}  ({h['household_id']})")
    print("  kuran    :", isim.get(h.get("created_by"), h.get("created_by")))
    print("  uyeler   :", uyeler or "YOK (bos)")
    print("  harcama  :", db.expenses.count_documents({"household_id": h["household_id"]}))
    print("  davet    :", h.get("invite_code"))
