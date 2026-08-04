"""Oturum suresinin kendini yenilediğini dogrula.

Yaklasim: kullanici olustur, veritabanindaki expires_at'i yarilama esiginin
altina cek, bir istek at, sure ileri atlamis mi bak.
"""
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta

import httpx
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(r"D:\SettleUp\OdaHesap\backend\.env")
BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
API = f"{BASE}/api"
SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "90"))

db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
mail = f"sess_{uuid.uuid4().hex[:8]}@odahesap-e2e.com"

c = httpx.Client(timeout=90.0)
r = c.post(f"{API}/auth/register", json={"email": mail, "password": "sifre123", "name": "Oturum Test"})
r.raise_for_status()
token = r.json()["session_token"]
hdr = {"Authorization": f"Bearer {token}"}

sess = db.user_sessions.find_one({"session_token": token})
ilk = sess["expires_at"]
print(f"kayit sonrasi son kullanma : {ilk}")
print(f"kalan gun                  : {(ilk.replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)).days}")

# Yarilama esiginin altina cek (30 gun kalmis gibi yap)
db.user_sessions.update_one(
    {"session_token": token},
    {"$set": {"expires_at": datetime.now(timezone.utc) + timedelta(days=30)}},
)
print("\n-> expires_at 30 gune cekildi (esik: 45 gun)")

r = c.get(f"{API}/auth/me", headers=hdr)
print(f"-> /auth/me HTTP {r.status_code}")

yeni = db.user_sessions.find_one({"session_token": token})["expires_at"]
kalan = (yeni.replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)).days
print(f"\nistek sonrasi son kullanma : {yeni}")
print(f"kalan gun                  : {kalan}")

if kalan >= SESSION_DAYS - 1:
    print(f"\n[OK] sure {SESSION_DAYS} gune yenilendi - aktif kullanici hic cikis yapmaz")
    sonuc = 0
else:
    print(f"\n[FAIL] yenilenmedi, kalan {kalan} gun")
    sonuc = 1

# Esigin ustundeyken bosuna yazmadigini da dogrula
onceki = yeni
r = c.get(f"{API}/auth/me", headers=hdr)
tekrar = db.user_sessions.find_one({"session_token": token})["expires_at"]
if tekrar == onceki:
    print("[OK] esik ustundeyken gereksiz veritabani yazmasi yok")
else:
    print("[FAIL] her istekte yaziyor")
    sonuc = 1

c.post(f"{API}/auth/logout", headers=hdr)
db.users.delete_many({"email": mail})
sys.exit(sonuc)
