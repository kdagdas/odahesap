"""401'lerin dogru ayrildigini dogrula.

Uygulama her 401'i "oturumun dustu" sayip jetonu siliyordu. Bu yuzden sifre
degistirirken mevcut sifreyi yanlis yazmak kullaniciyi sessizce disari
atiyordu. Sunucu artik sadece gercek oturum hatalarina X-Session-Invalid
basligi koyuyor.
"""
import sys
import uuid

import httpx

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


c = httpx.Client(timeout=90.0)
mail = f"s401_{TAG}@odahesap-e2e.com"
tok = c.post(f"{API}/auth/register", json={
    "email": mail, "password": "sifre123", "name": "S401"}).json()["session_token"]
h = {"Authorization": f"Bearer {tok}"}

print("\n-- gercek oturum hatalari isaretlenmeli --")
r = c.get(f"{API}/auth/me")
check("jetonsuz istek 401", r.status_code == 401, f"got {r.status_code}")
check("  X-Session-Invalid var", r.headers.get("x-session-invalid") == "1", str(dict(r.headers)))
r = c.get(f"{API}/auth/me", headers={"Authorization": "Bearer cop_jeton"})
check("gecersiz jeton 401", r.status_code == 401, f"got {r.status_code}")
check("  X-Session-Invalid var", r.headers.get("x-session-invalid") == "1", str(dict(r.headers)))

print("\n-- yanlis sifre oturumu OLDURMEMELI --")
r = c.post(f"{API}/auth/change-password", headers=h,
           json={"current_password": "yanlis", "new_password": "yenisifre1"})
check("yanlis mevcut sifre 401", r.status_code == 401, f"got {r.status_code}")
check("  X-Session-Invalid YOK", r.headers.get("x-session-invalid") is None,
      f"basliklar: {r.headers.get('x-session-invalid')}")
check("  hata mesaji Turkce ve anlamli", "şifre" in r.json().get("detail", "").lower(),
      str(r.json()))
check("  oturum hala gecerli", c.get(f"{API}/auth/me", headers=h).status_code == 200, "")

r = c.post(f"{API}/auth/change-email", headers=h,
           json={"new_email": f"yeni_{TAG}@odahesap-e2e.com", "password": "yanlis"})
check("e-posta degisiminde yanlis sifre 401", r.status_code == 401, f"got {r.status_code}")
check("  X-Session-Invalid YOK", r.headers.get("x-session-invalid") is None, "")
check("  oturum hala gecerli", c.get(f"{API}/auth/me", headers=h).status_code == 200, "")

print("\n-- giris ekraninda anlamli mesaj --")
r = c.post(f"{API}/auth/login", json={"email": mail, "password": "yanlis"})
check("yanlis giris 401", r.status_code == 401, f"got {r.status_code}")
check("  X-Session-Invalid YOK", r.headers.get("x-session-invalid") is None, "")
check("  mesaj Turkce", "hatalı" in r.json().get("detail", "").lower(), str(r.json()))

print("\n-- dogru sifreyle gercekten degisiyor mu --")
r = c.post(f"{API}/auth/change-password", headers=h,
           json={"current_password": "sifre123", "new_password": "yenisifre1"})
check("dogru sifreyle degisiyor", r.status_code == 200, r.text[:200])
check("yeni sifreyle giris",
      c.post(f"{API}/auth/login", json={"email": mail, "password": "yenisifre1"}).status_code == 200, "")

c.post(f"{API}/auth/logout", headers=h)
print(f"\n===== {ok} basarili, {fail} basarisiz =====")
sys.exit(1 if fail else 0)
