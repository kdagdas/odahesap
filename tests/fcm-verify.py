"""Firebase kimlik bilgisi gercekten calisiyor mu?

Sunucu bildirim hatalarini sessizce yutuyor (kasitli), o yuzden disaridan
dogrudan gorulemiyor. Ama gozlemlenebilir bir fark var:

  - Anahtar GECERLI  -> FCM'e ulasilir, sahte jeton reddedilir ve sunucu o
                        cihaz kaydini veritabanindan siler
  - Anahtar GECERSIZ -> OAuth jetonu bile alinamaz, FCM'e hic gidilmez ve
                        cihaz kaydi yerinde kalir

Yani: sahte jeton kaydet, bildirim tetikle, kaydin silinip silinmedigine bak.
Kendi test hesaplarimla calisir, gercek veriye dokunmaz.
"""
import os
import sys
import uuid

import httpx
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(r"D:\SettleUp\OdaHesap\backend\.env")
BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://odahesap-api.onrender.com").rstrip("/")
API = f"{BASE}/api"
TAG = uuid.uuid4().hex[:8]

db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
c = httpx.Client(timeout=120.0)


def reg(who):
    r = c.post(f"{API}/auth/register", json={
        "email": f"fcmv_{who}_{TAG}@odahesap-e2e.com", "password": "sifre123", "name": who.title()})
    r.raise_for_status()
    return r.json()["session_token"], r.json()["user"]["user_id"]


def hdr(t):
    return {"Authorization": f"Bearer {t}"}


alice, alice_id = reg("alice")   # bildirimi alacak taraf
bob, bob_id = reg("bob")         # tetikleyecek taraf

fake = f"FAKE_FCM_TOKEN_{TAG}"
c.post(f"{API}/devices/register", headers=hdr(alice), json={"token": fake})
before = db.devices.count_documents({"token": fake})
print(f"sahte cihaz kaydi olusturuldu: {before} kayit")

r = c.post(f"{API}/households", headers=hdr(alice), json={"name": f"FCM Dogrulama {TAG}"})
invite = r.json()["household"]["invite_code"]
c.post(f"{API}/households/join", headers=hdr(bob), json={"invite_code": invite})
c.post(f"{API}/households/approve", headers=hdr(alice), json={"user_id": bob_id})

print("Bob ev harcamasi ekliyor (Alice'e bildirim gitmeli)...")
r = c.post(f"{API}/expenses", headers=hdr(bob), json={
    "target_type": "household", "total": 12.0, "source": "manual",
    "items": [{"name": "FCM testi", "price": 12.0, "quantity": 1, "category": "diger"}]})
print("harcama ucu:", r.status_code, "<-- bildirim hatasi islemi bozmamali")

after = db.devices.count_documents({"token": fake})
print(f"\nsahte cihaz kaydi simdi: {after} kayit")

if after == 0:
    print("\n[GECTI] FCM'e ulasildi, sahte jeton reddedildi ve kayit temizlendi.")
    print("        Firebase kimlik bilgisi CALISIYOR - gercek cihazlara bildirim gider.")
    sonuc = 0
else:
    print("\n[KALDI] Cihaz kaydi duruyor: FCM'e hic gidilememis demektir.")
    print("        Servis hesabi anahtari reddedilmis olabilir.")
    sonuc = 1

print("\ntemizlik...")
for t in (bob, alice):
    c.post(f"{API}/households/leave", headers=hdr(t))
    c.post(f"{API}/auth/logout", headers=hdr(t))
db.devices.delete_many({"token": fake})
db.users.delete_many({"email": {"$regex": f"fcmv_.*_{TAG}@"}})
sys.exit(sonuc)
