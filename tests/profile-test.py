"""Profil duzenleme + fotograf testi."""
import base64
import io
import sys
import uuid

import httpx
from PIL import Image

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8001").rstrip("/")
API = f"{BASE}/api"
TAG = uuid.uuid4().hex[:8]
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


def tiny_jpeg(color=(14, 165, 165)) -> str:
    img = Image.new("RGB", (256, 256), color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=70)
    return base64.b64encode(buf.getvalue()).decode("ascii")


c = httpx.Client(timeout=90.0)


def reg(who, pw="sifre123"):
    r = c.post(f"{API}/auth/register", json={
        "email": f"prof_{who}_{TAG}@odahesap-e2e.com", "password": pw, "name": who.title()})
    r.raise_for_status()
    return r.json()["session_token"], r.json()["user"]["user_id"]


alice, alice_id = reg("alice")
bob, bob_id = reg("bob")
dave, dave_id = reg("dave")  # baska ev - Alice'in fotografini gormemeli

r = c.post(f"{API}/households", headers=hdr(alice), json={"name": f"Profil Ev {TAG}"})
invite = r.json()["household"]["invite_code"]
c.post(f"{API}/households/join", headers=hdr(bob), json={"invite_code": invite})
c.post(f"{API}/households/approve", headers=hdr(alice), json={"user_id": bob_id})
c.post(f"{API}/households", headers=hdr(dave), json={"name": f"Dave Ev {TAG}"})

print("\n-- isim --")
r = c.patch(f"{API}/auth/profile", headers=hdr(alice), json={"name": "Alice Yeni"})
check("isim degistirildi", r.status_code == 200 and r.json()["user"]["name"] == "Alice Yeni", r.text[:200])

print("\n-- e-posta --")
yeni = f"prof_alice_yeni_{TAG}@odahesap-e2e.com"
r = c.post(f"{API}/auth/change-email", headers=hdr(alice), json={"new_email": yeni, "password": "yanlis"})
check("yanlis sifreyle degistirilemez (401)", r.status_code == 401, f"got {r.status_code}")
r = c.post(f"{API}/auth/change-email", headers=hdr(alice),
           json={"new_email": f"prof_bob_{TAG}@odahesap-e2e.com", "password": "sifre123"})
check("baskasinin e-postasi alinamaz (409)", r.status_code == 409, f"got {r.status_code}")
r = c.post(f"{API}/auth/change-email", headers=hdr(alice), json={"new_email": yeni, "password": "sifre123"})
check("e-posta degistirildi", r.status_code == 200, r.text[:200])
r = c.post(f"{API}/auth/login", json={"email": yeni, "password": "sifre123"})
check("yeni e-posta ile giris calisiyor", r.status_code == 200, r.text[:200])
ikinci_oturum = r.json()["session_token"]

print("\n-- sifre --")
r = c.post(f"{API}/auth/change-password", headers=hdr(alice),
           json={"current_password": "yanlis", "new_password": "yenisifre1"})
check("yanlis mevcut sifre reddedilir (401)", r.status_code == 401, f"got {r.status_code}")
r = c.post(f"{API}/auth/change-password", headers=hdr(alice),
           json={"current_password": "sifre123", "new_password": "sifre123"})
check("ayni sifre reddedilir (400)", r.status_code == 400, f"got {r.status_code}")
r = c.post(f"{API}/auth/change-password", headers=hdr(alice),
           json={"current_password": "sifre123", "new_password": "yenisifre1"})
check("sifre degistirildi", r.status_code == 200, r.text[:200])
check("mevcut cihazin oturumu korundu",
      c.get(f"{API}/auth/me", headers=hdr(alice)).status_code == 200, "")
check("diger oturum dusuruldu (401)",
      c.get(f"{API}/auth/me", headers=hdr(ikinci_oturum)).status_code == 401, "")
check("eski sifreyle giris artik olmuyor",
      c.post(f"{API}/auth/login", json={"email": yeni, "password": "sifre123"}).status_code == 401, "")
check("yeni sifreyle giris oluyor",
      c.post(f"{API}/auth/login", json={"email": yeni, "password": "yenisifre1"}).status_code == 200, "")

print("\n-- fotograf --")
r = c.get(f"{API}/users/{alice_id}/photo", headers=hdr(alice))
check("fotograf yokken 404", r.status_code == 404, f"got {r.status_code}")
r = c.put(f"{API}/auth/photo", headers=hdr(alice), json={"image_base64": tiny_jpeg()})
check("fotograf yuklendi", r.status_code == 200, r.text[:200])
v1 = r.json()["photo_version"]
check("photo_version dondu", bool(v1), str(v1))

r = c.get(f"{API}/users/{alice_id}/photo", headers=hdr(alice))
check("sahibi kendi fotografini alir", r.status_code == 200 and r.content[:2] == b"\xff\xd8",
      f"{r.status_code} {r.content[:8]}")
check("dogru icerik tipi", r.headers.get("content-type", "").startswith("image/"), r.headers.get("content-type"))
r = c.get(f"{API}/users/{alice_id}/photo", headers=hdr(bob))
check("ev arkadasi gorebilir", r.status_code == 200, f"got {r.status_code}")
r = c.get(f"{API}/users/{alice_id}/photo", headers=hdr(dave))
check("baska evdeki GOREMEZ (404)", r.status_code == 404, f"got {r.status_code}")
r = c.get(f"{API}/users/{alice_id}/photo")
check("jetonsuz erisilemez (401)", r.status_code == 401, f"got {r.status_code}")

me = c.get(f"{API}/households/me", headers=hdr(bob)).json()
alice_row = [m for m in me["members"] if m["user_id"] == alice_id][0]
check("uye listesinde photo_version var", alice_row.get("photo_version") == v1, str(alice_row))
check("uye listesinde ham goruntu YOK (agir olurdu)",
      all("data" not in m and "image" not in str(m) for m in me["members"]), str(me["members"])[:200])

r = c.put(f"{API}/auth/photo", headers=hdr(alice), json={"image_base64": tiny_jpeg((255, 0, 0))})
check("yeni yuklemede surum degisir", r.json()["photo_version"] != v1, r.text[:200])

r = c.put(f"{API}/auth/photo", headers=hdr(alice), json={"image_base64": "bu-base64-degil!!"})
check("bozuk gorsel reddedilir (400)", r.status_code == 400, f"got {r.status_code}")

r = c.delete(f"{API}/auth/photo", headers=hdr(alice))
check("fotograf silindi", r.status_code == 200, r.text[:200])
check("silince 404", c.get(f"{API}/users/{alice_id}/photo", headers=hdr(alice)).status_code == 404, "")
me = c.get(f"{API}/auth/me", headers=hdr(alice)).json()
check("silince photo_version temizlendi", not me["user"].get("photo_version"), str(me["user"]))

print("\n-- temizlik --")
for t in (alice, bob, dave):
    c.post(f"{API}/households/leave", headers=hdr(t))
    c.post(f"{API}/auth/logout", headers=hdr(t))

print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
