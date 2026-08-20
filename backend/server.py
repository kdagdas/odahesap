"""OdaHesap — Roommate Household Expense Splitter Backend."""
from fastapi import FastAPI, APIRouter, Header, HTTPException, Depends, Response
from fastapi.responses import HTMLResponse, JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from typing import Iterable, List, Literal, Optional, Dict
from datetime import datetime, timezone, timedelta, date
from zoneinfo import ZoneInfo
from pathlib import Path
import asyncio
import base64
import difflib
import os
import re
import uuid
import random
import secrets
import string
import logging
import json
import bcrypt
import httpx

import push

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
# Google AI Studio key (free tier) — https://aistudio.google.com/apikey
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")
SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "90"))

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="OdaHesap API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("odahesap")


# ---------- Models ----------
class RegisterReq(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(min_length=1, max_length=60)


class LoginReq(BaseModel):
    email: EmailStr
    password: str


class ProfileUpdate(BaseModel):
    avatar_id: Optional[int] = None
    name: Optional[str] = None


class ChangeEmailReq(BaseModel):
    new_email: EmailStr
    password: str


class ChangePasswordReq(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6, max_length=128)


class PhotoUploadReq(BaseModel):
    # ~400 KB of base64 is a generous ceiling for a 256px avatar; the app
    # downscales before sending, this only stops a malformed upload.
    image_base64: str = Field(min_length=16, max_length=400_000)


# Bir ev = bir para birimi. Ulke secimi varsayilani belirler; donusum yok.
COUNTRY_CURRENCY = {"DE": "EUR", "TR": "TRY"}


class HouseholdCreate(BaseModel):
    name: str
    country: Literal["DE", "TR"] = "DE"


class HouseholdJoin(BaseModel):
    invite_code: str


class HouseholdRename(BaseModel):
    """Ev ayarları. Ad, ülke ve para birimi aynı uçtan güncellenir."""
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    country: Optional[Literal["DE", "TR"]] = None
    currency: Optional[Literal["EUR", "TRY"]] = None


class ShoppingItemCreate(BaseModel):
    text: str = Field(min_length=1, max_length=120)
    scope: Literal["household", "self"] = "household"
    note: Optional[str] = Field(default=None, max_length=200)


class ShoppingItemUpdate(BaseModel):
    text: Optional[str] = Field(default=None, min_length=1, max_length=120)
    done: Optional[bool] = None
    note: Optional[str] = Field(default=None, max_length=200)


class DeviceRegisterReq(BaseModel):
    token: str = Field(min_length=10, max_length=4096)
    platform: str = "android"


class NotificationPrefs(BaseModel):
    """Per-user switches. Expense pushes are the chatty ones, so they get
    their own toggles — a busy household can fire a dozen a day.

    Harcama tarafi UCE ayrildi: yeni harcama / duzenleme-silme / odeme kaydi.
    Tek anahtarken, duzenleme gurultusunden bunalan biri kapatmak icin yeni
    harcamalari da kapatmak zorunda kaliyordu."""
    new_expense: Optional[bool] = None
    expense_edit: Optional[bool] = None
    settlement: Optional[bool] = None
    period_closed: Optional[bool] = None


class MemberActionReq(BaseModel):
    user_id: str


class ApproveReq(BaseModel):
    user_id: str
    # Bölüşme listesi kayıt anında donduğu için yeni üye kendiliğinden geçmiş
    # harcamalara girmiyor. Ama gerçek hayatta girmesi gereken bir durum var:
    # kişi fiziksel olarak dönem başından beri evde, uygulamaya sonradan
    # katıldı. Karar kullanıcınındır, varsayılan "katılmasın".
    include_open_period: bool = False


class ExpenseItem(BaseModel):
    name: str
    price: float  # unit price in EUR
    quantity: float = 1  # allow fractional (e.g. 0.5 kg produce)
    # Fişte tartılan ürünün altında "0,590 kg x 10,99 EUR/kg" yazıyor. Birim
    # kaydedilmediği için bu "590 adet" olarak görünüyordu — hem saçma, hem de
    # "kaç kez süt alındı" gibi bir sayım yapılamaz hale getiriyordu.
    unit: Literal["adet", "kg", "lt", "paket"] = "adet"
    # Paket boyutu kilogram ya da litre cinsinden. Fiyat karsilastirmasi birim
    # fiyata dayaniyor ve miktar cogu zaman urun adinin icinde sikismis durumda
    # ("ZWIEBELN 2KG"); bu alan onu ayri tutuyor.
    size_amount: Optional[float] = None
    size_unit: Optional[Literal["kg", "lt"]] = None
    # Urunun NE oldugu -- markadan ve ambalajdan bagimsiz, kisa Turkce ad.
    # Fisteki yazim ile aranan kelime cogu zaman tutmuyor: alinacaklar listesi
    # Turkce yaziliyor, fis Almanca geliyor. Bu alan ikisi arasindaki kopru.
    generic: Optional[str] = None
    category: str = "diger"


TargetType = Literal["self", "household", "roommate", "custom"]


class ExpenseCreate(BaseModel):
    # `target_type` artık kural değil etiket: parayı `split_with` belirliyor.
    # Yine de girdi olarak kabul ediliyor — eski uygulama sürümleri ve testler
    # bunu gönderiyor, sunucu ondan bir katılımcı listesi türetiyor.
    target_type: Optional[TargetType] = None
    target_user_id: Optional[str] = None
    split_mode: Optional[Literal["equal", "exact"]] = None
    split_with: Optional[Dict[str, float]] = None
    items: List[ExpenseItem] = []
    total: float
    source: Literal["manual", "receipt"] = "manual"
    category: Optional[str] = None
    merchant: Optional[str] = None
    notes: Optional[str] = None
    currency: str = "EUR"
    expense_date: Optional[str] = None  # ISO YYYY-MM-DD


class ExpenseUpdate(BaseModel):
    target_type: Optional[TargetType] = None
    target_user_id: Optional[str] = None
    split_mode: Optional[Literal["equal", "exact"]] = None
    split_with: Optional[Dict[str, float]] = None
    items: Optional[List[ExpenseItem]] = None
    total: Optional[float] = None
    category: Optional[str] = None
    merchant: Optional[str] = None
    notes: Optional[str] = None
    expense_date: Optional[str] = None


class SettlementCreate(BaseModel):
    """A real-world payment between two housemates."""
    from_user_id: str
    to_user_id: str
    amount: float = Field(gt=0)
    note: Optional[str] = Field(default=None, max_length=200)


class OCRRequest(BaseModel):
    image_base64: str


# ---------- Helpers ----------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


# Evin saat dilimi ÜLKESİNDEN türüyor; kullanıcıya ayrıca sorulmuyor.
#
# Sorulsaydı kurulum ekranına anlamı belirsiz bir soru daha eklenirdi ("neden
# önemli?") ve cevabı zaten ülkeden çıkarılabiliyor. İki ülke desteklendiği
# için tablo da iki satır; yeni ülke eklenirse buraya bir satır düşer.
COUNTRY_TZ = {"DE": "Europe/Berlin", "TR": "Europe/Istanbul"}
_VARSAYILAN_TZ = "Europe/Berlin"


def ev_saat_dilimi(hh: Optional[dict]) -> ZoneInfo:
    try:
        return ZoneInfo(COUNTRY_TZ.get((hh or {}).get("country") or "DE", _VARSAYILAN_TZ))
    except Exception:  # noqa: BLE001 — tzdata yoksa uygulama yine ayağa kalksın
        return ZoneInfo(_VARSAYILAN_TZ)


def ev_bugun(hh: Optional[dict]) -> date:
    """Bu ev için BUGÜN.

    `now_utc().date()` yanlış cevap veriyordu ve belirtisi geceleri
    görünüyordu: Almanya yaz saatinde UTC+2, yani yerel saat 01:00'de UTC hâlâ
    "dün". Ayın 1'inde gece yarısından sonra açan biri Anasayfa'da **geçen
    ayın** rakamlarını görüyordu; "bu ayın kaçıncı günündeyiz" hesabı da bir
    gün geride kalıyordu (trend satırı bu sayıya dayanıyor).

    Zaman damgaları (`created_at`) UTC kalmaya devam ediyor — onlar bir AN'ı
    kaydediyor ve anın saat dilimi yok. Değişen yalnızca "bugün hangi gün,
    hangi ay" sorusu; o soru evin takvimine ait.

    **Gezen kullanıcı evin takvimini taşımıyor.** Kadir Türkiye'deyken de ev
    Almanya saatiyle çalışır: ay sınırı ev arkadaşlarının ortak defterine ait,
    kimin nerede olduğuna değil. Aksi hâlde aynı harcama iki telefonda iki
    farklı aya düşebilirdi.
    """
    return now_utc().astimezone(ev_saat_dilimi(hh)).date()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def gen_invite_code() -> str:
    # secrets, not random: this is the only thing standing between a stranger
    # and a request to join your household.
    return "".join(secrets.choice(string.digits) for _ in range(6))


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_password(plain: str, hashed: Optional[str]) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("ascii"))
    except ValueError:
        return False


def norm_email(email: str) -> str:
    return email.strip().lower()


def public_user(user: dict) -> dict:
    """Strip internal/sensitive fields before returning a user to the client.

    `photo_version` is a cache-buster, not the photo itself. Avatars live in
    their own collection behind GET /users/{id}/photo — inlining them here
    would re-download every member's image on every household refresh, and
    that refresh now runs each time a screen gains focus.
    """
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user["name"],
        "avatar_id": user.get("avatar_id", 0),
        "photo_version": user.get("photo_version"),
    }


async def issue_session(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    await db.user_sessions.insert_one(
        {
            "session_token": token,
            "user_id": user_id,
            "expires_at": now_utc() + timedelta(days=SESSION_DAYS),
            "created_at": now_utc(),
        }
    )
    return token


def make_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def parse_date(s: Optional[str]) -> Optional[str]:
    """Normalize date to YYYY-MM-DD. Accepts YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY."""
    if not s:
        return None
    s = s.strip()
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


# Marks the 401s that actually mean "this session is dead, sign in again", as
# opposed to "the password you just typed is wrong". The app clears its stored
# token only on the former — without the distinction, mistyping your current
# password while changing it silently logged you out.
SESSION_INVALID = {"X-Session-Invalid": "1"}


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Oturum bulunamadı",
                            headers=SESSION_INVALID)
    token = authorization.replace("Bearer ", "", 1).strip()
    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not sess:
        raise HTTPException(status_code=401, detail="Oturum geçersiz",
                            headers=SESSION_INVALID)
    expires_at = make_aware(sess["expires_at"])
    if expires_at < now_utc():
        raise HTTPException(status_code=401, detail="Oturum süresi doldu",
                            headers=SESSION_INVALID)
    user = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Kullanıcı bulunamadı",
                            headers=SESSION_INVALID)

    # Sliding expiry: someone who keeps using the app is never logged out.
    # Only written once the session is past its halfway point, so normal
    # requests stay read-only instead of writing on every call.
    if expires_at - now_utc() < timedelta(days=SESSION_DAYS / 2):
        await db.user_sessions.update_one(
            {"session_token": token},
            {"$set": {"expires_at": now_utc() + timedelta(days=SESSION_DAYS)}},
        )
    return user


# Fields safe to return for *other* users (never password_hash).
PUBLIC_USER_PROJECTION = {
    "_id": 0, "user_id": 1, "email": 1, "name": 1, "avatar_id": 1,
    "photo_version": 1,
}


async def get_user_household(user_id: str) -> Optional[dict]:
    """Bu isteğin hangi eve ait olduğu.

    31 çağrı noktasının hepsi buradan geçiyor; "bir kullanıcı = bir ev"
    varsayımı koda dağılmış değil, TEK YERDE. Bu fonksiyon `active_household_id`
    alanını okuyarak çoklu üyeliği taşıyabilir hale geldi ve çağrı yerlerinin
    hiçbirine dokunulmadı.

    Bugün davranış aynı: alan boşsa (bütün mevcut kullanıcılarda öyle) üyesi
    olduğu tek ev bulunuyor. Alan doluysa ve kişi hâlâ o evin üyesiyse o ev
    dönüyor — üyelikten çıkarılmışsa alan yok sayılıyor, yoksa çıkarılan biri
    evi görmeye devam ederdi.

    Erken yapıldı çünkü maliyeti zamanla artıyordu: çağrı sayısı v18'de 24,
    bugün 31. Her tur birkaç tane daha ekliyor.
    """
    user = await db.users.find_one(
        {"user_id": user_id}, {"_id": 0, "active_household_id": 1}
    )
    active = (user or {}).get("active_household_id")
    if active:
        hh = await db.households.find_one(
            {"household_id": active, "member_ids": user_id}, {"_id": 0}
        )
        if hh:
            return hh
    return await db.households.find_one({"member_ids": user_id}, {"_id": 0})


async def user_households(user_id: str) -> List[dict]:
    """Kişinin üyesi olduğu bütün evler. Bugün en fazla bir tane."""
    return await db.households.find({"member_ids": user_id}, {"_id": 0}).to_list(20)


def admin_id(hh: dict) -> str:
    """Who runs this household.

    `admin_id` was added after the first households existed, so fall back to
    `created_by` — every household has it, and the creator is the right admin.
    """
    return hh.get("admin_id") or hh["created_by"]


DEFAULT_PREFS = {
    "new_expense": True,     # yeni harcama eklendi
    "expense_edit": True,    # var olan harcama duzenlendi ya da silindi
    "settlement": True,      # odeme kaydedildi ya da geri alindi
    "period_closed": True,
}

# Kapatilamayan turler. "Yeni katilma istegi" yalnizca yoneticiye gider ve
# gormezse ev arkadasi kapida bekler; "Istegin onaylandi" da hayatta bir kez
# olur ve kacirilirsa kisi eve girdigini bilmez. Ikisi de bir TERCIH degil,
# akisin calismasi icin sart -- o yuzden anahtari hic yok.
# Okunmus bildirimin raf omru. Otuz gun, "gecen ay ne olmustu" sorusunun
# hala sorulabildigi ama listenin yigina donmedigi aralik. Okunmamislar bu
# kurala girmiyor -- kacirilan olayin tek izi onlar.
BILDIRIM_OMRU_GUN = 30

_ALWAYS = ("join_request",)

# Once dordu birden `new_expense` anahtarini paylasiyordu: "duzenleme
# bildirimleri beni yoruyor" diyen biri, kapatmak icin yeni harcamalari da
# kapatmak zorunda kaliyordu -- yani parasini ilgilendiren seyleri duymamayi
# gozeliyordu. Rakiplerde (Splitwise, Tricount) bu turler ayri.
_INHERIT_FROM_NEW_EXPENSE = ("expense_edit", "settlement")


def pref_allows(prefs: Optional[dict], kind: str) -> bool:
    """Kullanici bu turu istiyor mu?

    Yeni anahtarlar acikca ayarlanana kadar eski `new_expense` secimini
    **miras alir**: `new_expense`'i kapatmis biri, biz anahtari bolduk diye
    aniden yeniden bildirim almaya baslamamali.
    """
    if kind in _ALWAYS:
        return True
    p = prefs or {}
    if kind in _INHERIT_FROM_NEW_EXPENSE and kind not in p:
        return {**DEFAULT_PREFS, **p}.get("new_expense", True)
    return {**DEFAULT_PREFS, **p}.get(kind, True)


def money_str(amount: float, hh: Optional[dict] = None) -> str:
    """Bildirim metnindeki tutar. Simge evin para biriminden gelir; sabit "EUR"
    yazmak TRY kullanan bir eve yanlis para birimi gosteriyordu."""
    sign = "₺" if (hh or {}).get("currency") == "TRY" else "€"
    return f"{float(amount):.2f}".replace(".", ",") + f" {sign}"


async def notify(user_ids: Iterable[str], title: str, body: str,
                 kind: str, data: Optional[dict] = None) -> None:
    """Push to these users, honouring their per-kind switches.

    Never raises: a failed notification must not fail the action that caused
    it. Dead tokens are pruned using what FCM reports back.
    """
    ids = [u for u in dict.fromkeys(user_ids) if u]
    if not ids:
        return

    # Bildirim kaydı push'tan bağımsız yazılıyor: telefon kapalıysa, jeton
    # ölmüşse ya da FCM hiç yapılandırılmamışsa bile "ben yokken ne oldu"
    # sorusunun bir cevabı olmalı. Push kaybolur, kayıt kalır.
    now = now_utc()
    await db.notifications.insert_many([{
        "notification_id": new_id("ntf"),
        "user_id": uid,
        "title": title,
        "body": body,
        "kind": kind,
        "data": data or {},
        "read": False,
        "created_at": now,
    } for uid in ids])

    try:
        if not push.is_configured():
            return

        users = await db.users.find(
            {"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1, "notif_prefs": 1}
        ).to_list(50)
        allowed = {
            u["user_id"] for u in users if pref_allows(u.get("notif_prefs"), kind)
        }
        if not allowed:
            return

        devices = await db.devices.find(
            {"user_id": {"$in": list(allowed)}}, {"_id": 0, "token": 1}
        ).to_list(200)
        tokens = [d["token"] for d in devices]
        if not tokens:
            return

        result = await push.send_to_tokens(tokens, title, body, {**(data or {}), "kind": kind})
        if result["invalid_tokens"]:
            await db.devices.delete_many({"token": {"$in": result["invalid_tokens"]}})
    except Exception:
        logger.exception("Bildirim gonderilemedi (islem etkilenmedi)")


@api.get("/notifications")
async def list_notifications(user=Depends(get_current_user)):
    """Ben yokken ne oldu.

    Bildirim gelip kaçırıldığında geriye bakacak bir yer yoktu; telefonu
    kapalı olan ya da bildirimleri kapatmış biri olan bitenden habersiz
    kalıyordu.
    """
    # OKUNMUS ve 30 gunden eski olanlar burada dokuluyor. Ayri bir zamanlayici
    # YOK: bu uc zaten gunde birkac kez cagriliyor ve is kisinin kendi
    # kayitlariyla sinirli. Okunmamis olan yaslansa da SILINMEZ -- kacirilmis
    # bir olayin tek izi o kayit.
    try:
        await db.notifications.delete_many({
            "user_id": user["user_id"],
            "read": True,
            "created_at": {"$lt": now_utc() - timedelta(days=BILDIRIM_OMRU_GUN)},
        })
    except Exception:  # noqa: BLE001
        logger.exception("Eski bildirimler temizlenemedi (liste etkilenmedi)")

    rows = await db.notifications.find(
        {"user_id": user["user_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(60)
    unread = sum(1 for r in rows if not r.get("read"))
    return {"notifications": rows, "unread": unread}


@api.post("/notifications/read")
async def mark_notifications_read(user=Depends(get_current_user)):
    await db.notifications.update_many(
        {"user_id": user["user_id"], "read": False}, {"$set": {"read": True}}
    )
    return {"ok": True}


@api.delete("/notifications/{notification_id}")
async def delete_notification(notification_id: str, user=Depends(get_current_user)):
    """Tek bir bildirimi sil.

    Bildirim KISIYE ait bir kayit: ayni olay icin her alici kendi satirini
    tasiyor. Bu yuzden silmek paylasilan hicbir seyi bozmuyor ve onay
    sorulmuyor -- alinacaklar listesindeki maddeyi silmekten farki bu.
    """
    res = await db.notifications.delete_one(
        {"notification_id": notification_id, "user_id": user["user_id"]}
    )
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Bildirim bulunamadı")
    return {"ok": True}


@api.post("/notifications/clear-read")
async def clear_read_notifications(user=Depends(get_current_user)):
    """Okunmuslari topluca sil.

    Yalnizca OKUNMUS olanlar: ekrani acmadan biriken bir yigini temizlemek
    isteyen biri, henuz gormedigi bir olayi da silmis olmamali. Aktivite
    ekrani acilista hepsini okundu isaretledigi icin, kullanicinin gordugu
    liste ile bu dugmenin sildigi kume birebir ayni.
    """
    res = await db.notifications.delete_many(
        {"user_id": user["user_id"], "read": True}
    )
    return {"ok": True, "deleted": res.deleted_count}


async def require_admin(user_id: str) -> dict:
    """Return the caller's household, or 403 if they don't run it."""
    hh = await get_user_household(user_id)
    if not hh:
        raise HTTPException(status_code=400, detail="Ev bulunamadı")
    if admin_id(hh) != user_id:
        raise HTTPException(status_code=403, detail="Bu işlemi sadece ev yöneticisi yapabilir")
    return hh


async def get_pending_household(user_id: str) -> Optional[dict]:
    return await db.households.find_one({"pending_member_ids": user_id}, {"_id": 0})


async def get_active_period(household_id: str) -> Optional[dict]:
    return await db.periods.find_one(
        {"household_id": household_id, "status": "active"}, {"_id": 0}
    )


# ---------- Auth ----------
@api.post("/auth/register")
async def auth_register(body: RegisterReq):
    email = norm_email(body.email)
    if await db.users.find_one({"email": email}, {"_id": 0}):
        raise HTTPException(status_code=409, detail="Bu e-posta zaten kayıtlı")

    user = {
        "user_id": new_id("user"),
        "email": email,
        "name": body.name.strip(),
        "password_hash": hash_password(body.password),
        "avatar_id": 0,
        "created_at": now_utc(),
    }
    try:
        await db.users.insert_one(user.copy())
    except Exception:
        # unique index race — another request registered the same email first
        raise HTTPException(status_code=409, detail="Bu e-posta zaten kayıtlı")

    token = await issue_session(user["user_id"])
    return {"session_token": token, "user": public_user(user)}


@api.post("/auth/login")
async def auth_login(body: LoginReq):
    email = norm_email(body.email)
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(body.password, user.get("password_hash")):
        raise HTTPException(status_code=401, detail="E-posta veya şifre hatalı")
    token = await issue_session(user["user_id"])
    return {"session_token": token, "user": public_user(user)}


@api.patch("/auth/profile")
async def update_profile(body: ProfileUpdate, user=Depends(get_current_user)):
    patch: dict = {}
    if body.avatar_id is not None:
        if body.avatar_id < 0 or body.avatar_id > 7:
            raise HTTPException(status_code=400, detail="Geçersiz avatar")
        patch["avatar_id"] = int(body.avatar_id)
    if body.name is not None and body.name.strip():
        patch["name"] = body.name.strip()
    if not patch:
        return {"user": public_user(user)}
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": patch})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"user": public_user(updated)}


@api.get("/auth/me")
async def auth_me(user=Depends(get_current_user)):
    u = public_user(user)
    # ETKIN deger donuyor, ham deger degil: `new_expense`'i kapatmis ama yeni
    # anahtarlari hic gormemis kullaniciya "acik" gostermek yalan olurdu --
    # `pref_allows` onlari kapali sayiyor.
    prefs = user.get("notif_prefs") or {}
    u["notif_prefs"] = {k: pref_allows(prefs, k) for k in DEFAULT_PREFS}
    return {"user": u, "push_enabled": push.is_configured()}


@api.post("/auth/change-email")
async def change_email(body: ChangeEmailReq, user=Depends(get_current_user)):
    """Requires the password: an unattended phone must not be enough to move
    the account to an address the owner does not control."""
    if not verify_password(body.password, user.get("password_hash")):
        raise HTTPException(status_code=401, detail="Şifre hatalı")
    new_email = norm_email(body.new_email)
    if new_email == user["email"]:
        raise HTTPException(status_code=400, detail="Bu zaten mevcut e-postanız")
    if await db.users.find_one({"email": new_email}, {"_id": 0}):
        raise HTTPException(status_code=409, detail="Bu e-posta başka bir hesapta kayıtlı")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"email": new_email}})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"user": public_user(updated)}


@api.post("/auth/change-password")
async def change_password(
    body: ChangePasswordReq,
    authorization: Optional[str] = Header(None),
    user=Depends(get_current_user),
):
    if not verify_password(body.current_password, user.get("password_hash")):
        raise HTTPException(status_code=401, detail="Mevcut şifre hatalı")
    if body.current_password == body.new_password:
        raise HTTPException(status_code=400, detail="Yeni şifre eskisiyle aynı olamaz")

    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"password_hash": hash_password(body.new_password)}},
    )
    # Changing a password should evict anyone else who was signed in — that is
    # the whole point if the old one leaked. The current phone keeps its session.
    keep = authorization.replace("Bearer ", "", 1).strip() if authorization else ""
    await db.user_sessions.delete_many(
        {"user_id": user["user_id"], "session_token": {"$ne": keep}}
    )
    return {"ok": True}


@api.put("/auth/photo")
async def upload_photo(body: PhotoUploadReq, user=Depends(get_current_user)):
    b64 = body.image_base64
    mime = "image/jpeg"
    if b64.startswith("data:"):
        header, b64 = b64.split(",", 1)
        if ";" in header and ":" in header:
            mime = header.split(":", 1)[1].split(";", 1)[0] or mime
    try:
        raw = base64.b64decode(b64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Görsel çözümlenemedi")
    if len(raw) > 300_000:
        raise HTTPException(status_code=413, detail="Görsel çok büyük")

    version = uuid.uuid4().hex[:12]
    await db.avatars.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"user_id": user["user_id"], "data": raw, "mime": mime, "updated_at": now_utc()}},
        upsert=True,
    )
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"photo_version": version}})
    return {"photo_version": version}


@api.delete("/auth/photo")
async def delete_photo(user=Depends(get_current_user)):
    await db.avatars.delete_one({"user_id": user["user_id"]})
    await db.users.update_one({"user_id": user["user_id"]}, {"$unset": {"photo_version": ""}})
    return {"ok": True}


@api.get("/users/{user_id}/photo")
async def get_photo(user_id: str, user=Depends(get_current_user)):
    """Only yourself and people you actually share a household with."""
    if user_id != user["user_id"]:
        hh = await get_user_household(user["user_id"])
        if not hh or user_id not in hh.get("member_ids", []):
            raise HTTPException(status_code=404, detail="Bulunamadı")

    row = await db.avatars.find_one({"user_id": user_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Fotoğraf yok")
    return Response(
        content=row["data"],
        media_type=row.get("mime", "image/jpeg"),
        # Immutable: the URL carries a version that changes on every upload.
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@api.post("/devices/register")
async def register_device(body: DeviceRegisterReq, user=Depends(get_current_user)):
    """Store this phone's FCM token.

    Keyed on the token, not the user: reinstalls mint a new token, and the same
    phone can be handed to a different account. Upserting on the token keeps
    exactly one row per device and re-points it at whoever logged in last.
    """
    await db.devices.update_one(
        {"token": body.token},
        {"$set": {
            "token": body.token,
            "user_id": user["user_id"],
            "platform": body.platform,
            "updated_at": now_utc(),
        }},
        upsert=True,
    )
    return {"ok": True}


@api.post("/devices/unregister")
async def unregister_device(body: DeviceRegisterReq, user=Depends(get_current_user)):
    await db.devices.delete_one({"token": body.token, "user_id": user["user_id"]})
    return {"ok": True}


@api.patch("/auth/notifications")
async def update_notification_prefs(body: NotificationPrefs, user=Depends(get_current_user)):
    prefs = {**DEFAULT_PREFS, **(user.get("notif_prefs") or {})}
    for key, value in body.model_dump(exclude_none=True).items():
        prefs[key] = bool(value)
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"notif_prefs": prefs}})
    return {"notif_prefs": prefs}


@api.post("/auth/logout")
async def auth_logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.replace("Bearer ", "", 1).strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ---------- Households ----------
async def _generate_unique_invite() -> str:
    for _ in range(20):
        code = gen_invite_code()
        if not await db.households.find_one({"invite_code": code}, {"_id": 0}):
            return code
    raise HTTPException(status_code=500, detail="Could not generate unique invite code")


@api.post("/households")
async def create_household(body: HouseholdCreate, user=Depends(get_current_user)):
    if await get_user_household(user["user_id"]):
        raise HTTPException(status_code=400, detail="Zaten bir evdesiniz")
    if await get_pending_household(user["user_id"]):
        # remove pending status if creating own
        await db.households.update_many(
            {"pending_member_ids": user["user_id"]},
            {"$pull": {"pending_member_ids": user["user_id"]}},
        )

    hh_id = new_id("hh")
    period_id = new_id("per")
    invite_code = await _generate_unique_invite()

    household = {
        "household_id": hh_id,
        "name": body.name,
        # Bir ev = bir para birimi. Karışırsa toplama işlemi anlamsızlaşır:
        # 40 € ile 500 ₺ toplanamaz, bölünemez, "kim kime borçlu" hesaplanamaz.
        # Fişten okunan sembol kaynak değil, denetim olarak kullanılıyor.
        "country": body.country,
        "currency": COUNTRY_CURRENCY[body.country],
        "invite_code": invite_code,
        "created_by": user["user_id"],
        "admin_id": user["user_id"],
        "member_ids": [user["user_id"]],
        "pending_member_ids": [],
        "current_period_id": period_id,
        "created_at": now_utc(),
    }
    period = {
        "period_id": period_id,
        "household_id": hh_id,
        "started_at": now_utc(),
        "closed_at": None,
        "status": "active",
        "participant_ids": [user["user_id"]],
    }
    await db.households.insert_one(household.copy())
    await db.periods.insert_one(period.copy())
    return {"household": household, "period": period}


@api.post("/households/join")
async def join_household(body: HouseholdJoin, user=Depends(get_current_user)):
    if await get_user_household(user["user_id"]):
        raise HTTPException(status_code=400, detail="Zaten bir evdesiniz")
    already_pending = await get_pending_household(user["user_id"])
    if already_pending:
        return {"pending": True, "household": already_pending}

    hh = await db.households.find_one({"invite_code": body.invite_code.strip()}, {"_id": 0})
    if not hh:
        raise HTTPException(status_code=404, detail="Geçersiz davet kodu")
    if user["user_id"] in hh.get("member_ids", []):
        raise HTTPException(status_code=400, detail="Zaten bu evdesiniz")

    await db.households.update_one(
        {"household_id": hh["household_id"]},
        {"$addToSet": {"pending_member_ids": user["user_id"]}},
    )
    hh = await db.households.find_one({"household_id": hh["household_id"]}, {"_id": 0})
    await notify(
        [admin_id(hh)],
        "Yeni katılma isteği",
        f"{user['name']} \"{hh['name']}\" evine katılmak istiyor.",
        "join_request",
        {"household_id": hh["household_id"]},
    )
    return {"pending": True, "household": hh}


@api.patch("/households")
async def rename_household(body: HouseholdRename, user=Depends(get_current_user)):
    hh = await require_admin(user["user_id"])
    patch: dict = {}
    if body.name is not None:
        patch["name"] = body.name.strip()

    # Ülke ve para birimi evin kuralı. Kur çevrimi yapmıyoruz; para birimini
    # değiştirmek "40 €" yazan kaydı "40 ₺" diye göstermek demek — tutar aynı
    # kalır, anlamı değişir ve geçmiş bütün hesaplaşmalar sessizce yanlış
    # okunur. Ülkeyi tek başına değiştirmek de yarım bir taşınma olurdu.
    # İkisi de yalnızca evde henüz harcama yokken değişebilir.
    #
    # Ülke para birimini YALNIZCA ev kurulurken belirliyor. Burada türetmek,
    # zararsız bir ülke değişikliğini gizlice para birimi değişikliğine
    # çeviriyor ve kullanıcıya alakasız bir hata gösteriyordu.
    changing = (
        (body.country is not None and body.country != hh.get("country", "DE"))
        or (body.currency is not None and body.currency != hh.get("currency", "EUR"))
    )
    if changing:
        used = await db.expenses.count_documents({"household_id": hh["household_id"]})
        if used:
            raise HTTPException(
                status_code=400,
                detail="Ülke ve para birimi yalnızca hiç harcama yapılmamış "
                       "evlerde değiştirilebilir. Farklı bir para birimi için "
                       "yeni bir ev kurun.",
            )
        if hh.get("created_by") != user["user_id"]:
            raise HTTPException(
                status_code=403,
                detail="Bu ayarı yalnızca evi kuran kişi değiştirebilir.",
            )

    if body.country is not None:
        patch["country"] = body.country
    if body.currency is not None:
        patch["currency"] = body.currency

    if not patch:
        raise HTTPException(status_code=400, detail="Değiştirilecek bir şey yok")
    await db.households.update_one({"household_id": hh["household_id"]}, {"$set": patch})
    updated = await db.households.find_one({"household_id": hh["household_id"]}, {"_id": 0})
    return {"household": updated}


@api.post("/households/regenerate-invite")
async def regenerate_invite(user=Depends(get_current_user)):
    """Mint a fresh invite code.

    The old one never expires on its own, so anyone who has ever seen it —
    including someone who has since moved out — can keep asking to join.
    """
    hh = await require_admin(user["user_id"])
    code = await _generate_unique_invite()
    await db.households.update_one(
        {"household_id": hh["household_id"]}, {"$set": {"invite_code": code}}
    )
    return {"invite_code": code}


@api.post("/households/transfer-admin")
async def transfer_admin(body: MemberActionReq, user=Depends(get_current_user)):
    hh = await require_admin(user["user_id"])
    if body.user_id not in hh.get("member_ids", []):
        raise HTTPException(status_code=404, detail="Bu kişi evin üyesi değil")
    if body.user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Yöneticilik zaten sizde")
    await db.households.update_one(
        {"household_id": hh["household_id"]}, {"$set": {"admin_id": body.user_id}}
    )
    return {"ok": True, "admin_id": body.user_id}


async def _uye_kaydi(household_id: str, user_id: str, eylem: str) -> None:
    """Üyelik değişimini eve ekler: `katildi` · `ayrildi` · `cikarildi`.

    Dönem para hesabından çıkınca "bu dönemde üç kişiydik" sınırı da kalktı.
    Bölüşme listeleri (`split_with`) her harcamanın kaç kişiye bölündüğünü
    zaten dondurarak taşıyor — yani "ne zaman üçe, ne zaman ikiye bölündü"
    sorusu veriden türetilebiliyor. Türetilemeyen tek şey **kimin** ne zaman
    ayrıldığı; borç dökümündeki "12 Ağustos · Kemal evden ayrıldı" satırı
    buradan geliyor.

    Eklemeli ve küçük: üyelik değişimi yılda birkaç kez olan bir olay.
    """
    await db.households.update_one(
        {"household_id": household_id},
        {"$push": {"member_log": {
            "user_id": user_id, "eylem": eylem, "at": now_utc(),
        }}},
    )


@api.post("/households/remove-member")
async def remove_member(body: MemberActionReq, user=Depends(get_current_user)):
    """Kick a member out — for people who moved out and deleted the app
    without leaving the household themselves.

    Guarded on purpose: member_ids drives how household expenses are split, so
    removing someone mid-period silently re-splits every expense in it and
    erases what they owed. Settle and close the period first, then remove.
    """
    hh = await require_admin(user["user_id"])
    if body.user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Kendinizi çıkaramazsınız, 'Evden ayrıl'ı kullanın")
    if body.user_id not in hh.get("member_ids", []):
        raise HTTPException(status_code=404, detail="Bu kişi evin üyesi değil")

    period = await get_active_period(hh["household_id"])
    if period:
        involved = await db.expenses.count_documents({
            "household_id": hh["household_id"],
            "period_id": period["period_id"],
            "$or": [{"added_by": body.user_id}, {"target_user_id": body.user_id}],
        })
        if involved:
            raise HTTPException(
                status_code=400,
                detail=f"Bu kişinin ödeşilmemiş {involved} harcaması var. Çıkarmadan önce "
                       "ödeşin, yoksa herkesin payı yeniden hesaplanır.",
            )

    await db.households.update_one(
        {"household_id": hh["household_id"]}, {"$pull": {"member_ids": body.user_id}}
    )
    await _uye_kaydi(hh["household_id"], body.user_id, "cikarildi")
    return {"ok": True, "removed": body.user_id}


@api.post("/households/approve")
async def approve_member(body: ApproveReq, user=Depends(get_current_user)):
    hh = await require_admin(user["user_id"])
    if body.user_id not in hh.get("pending_member_ids", []):
        raise HTTPException(status_code=404, detail="Bekleyen üye bulunamadı")

    active = await get_active_period(hh["household_id"])
    joined = 0
    if active:
        # Listesi yazılmamış eski kayıtlar burada dondurulıyor — ÜYE EKLENMEDEN
        # ÖNCE, yani liste katılımdan önceki kadroyu gösteriyor. Yapılmazsa
        # bu kayıtlar her hesaplamada o günkü üye listesine bölünmeye devam
        # eder ve "kat / katma" sorusunun cevabı onlarda hiç uygulanmazdı.
        legacy = await db.expenses.find(
            {"household_id": hh["household_id"], "period_id": active["period_id"],
             "split_with": {"$in": [None, {}]}},
            {"_id": 0, "expense_id": 1, "added_by": 1, "total": 1,
             "target_type": 1, "target_user_id": 1},
        ).to_list(5000)
        for e in legacy:
            mode, sw = split_of(e, hh["member_ids"])
            await db.expenses.update_one(
                {"expense_id": e["expense_id"]},
                {"$set": {"split_mode": mode, "split_with": sw}},
            )

        if body.include_open_period:
            # Yalnızca eşit bölüşülen EV harcamaları. Kişiye özel tutarlara
            # dokunmak toplamı bozar; ikili ve kişisel harcamalar zaten yeni
            # üyeyi ilgilendirmiyor.
            res = await db.expenses.update_many(
                {"household_id": hh["household_id"], "period_id": active["period_id"],
                 "target_type": "household", "split_mode": "equal"},
                {"$set": {f"split_with.{body.user_id}": 1.0}},
            )
            joined = res.modified_count

    await db.households.update_one(
        {"household_id": hh["household_id"]},
        {
            "$pull": {"pending_member_ids": body.user_id},
            "$addToSet": {"member_ids": body.user_id},
        },
    )
    # Yeni üye yalnızca AÇIK döneme yazılır. Kapalı dönemlerin listesi dondu;
    # bugün eve katılan biri aylar önce kapanmış bir hesaba karışmamalı.
    if active:
        await db.periods.update_one(
            {"period_id": active["period_id"]},
            {"$addToSet": {"participant_ids": body.user_id}},
        )
    await _uye_kaydi(hh["household_id"], body.user_id, "katildi")
    await notify(
        [body.user_id],
        "İsteğin onaylandı",
        f"Artık \"{hh['name']}\" evindesin. Harcamaları görebilirsin.",
        "join_request",
        {"household_id": hh["household_id"]},
    )
    return {"ok": True, "joined_expenses": joined}


@api.post("/households/reject")
async def reject_member(body: MemberActionReq, user=Depends(get_current_user)):
    hh = await require_admin(user["user_id"])
    await db.households.update_one(
        {"household_id": hh["household_id"]},
        {"$pull": {"pending_member_ids": body.user_id}},
    )
    return {"ok": True}


@api.get("/households/me")
async def my_household(user=Depends(get_current_user)):
    hh = await get_user_household(user["user_id"])
    if hh:
        members = await db.users.find(
            {"user_id": {"$in": hh["member_ids"]}}, PUBLIC_USER_PROJECTION
        ).to_list(50)
        pending = await db.users.find(
            {"user_id": {"$in": hh.get("pending_member_ids", [])}}, PUBLIC_USER_PROJECTION
        ).to_list(50)
        active_period = await get_active_period(hh["household_id"])
        # Approving someone mid-period re-splits every expense already in it,
        # so the UI warns when there is anything to re-split.
        open_expense_count = 0
        if active_period:
            open_expense_count = await db.expenses.count_documents({
                "household_id": hh["household_id"],
                "period_id": active_period["period_id"],
                "target_type": "household",
            })
        # En eski harcamanın ayı — ay seçicinin alt sınırı.
        #
        # Yalnızca evin `created_at`'ine dayanmak yetmiyor: fiş GERİYE TARİHLİ
        # girilebiliyor (ev bugün kurulup dün alınan Temmuz fişi eklenebilir).
        # O zaman created_at Ağustos, ama Temmuz'da veri var ve seçici onu
        # gizlerse kullanıcı "verilerim nerede" diyor. İkisinin ERKENİ alınıyor.
        ilk_ay = None
        ilk = await db.expenses.find(
            {"household_id": hh["household_id"], "expense_date": {"$ne": None}},
            {"_id": 0, "expense_date": 1},
        ).sort("expense_date", 1).limit(1).to_list(1)
        if ilk and ilk[0].get("expense_date"):
            ilk_ay = ilk[0]["expense_date"][:7]
        hh_out = dict(hh)
        hh_out["first_expense_month"] = ilk_ay
        return {
            "household": hh_out,
            "members": members,
            "pending_members": pending,
            "active_period": active_period,
            "pending": False,
            "admin_id": admin_id(hh),
            "is_admin": admin_id(hh) == user["user_id"],
            "open_expense_count": open_expense_count,
        }
    # user might be pending on another household
    pending_hh = await get_pending_household(user["user_id"])
    if pending_hh:
        return {
            "household": None,
            "pending_household": {
                "household_id": pending_hh["household_id"],
                "name": pending_hh["name"],
            },
            "members": [],
            "pending_members": [],
            "active_period": None,
            "pending": True,
        }
    return {"household": None, "members": [], "pending_members": [], "active_period": None, "pending": False}


@api.post("/households/leave")
async def leave_household(user=Depends(get_current_user)):
    hh = await get_user_household(user["user_id"])
    if hh:
        # Ayrılanın ödeşilmemiş bakiyesi — ayrılmadan ÖNCE ölçülüyor.
        #
        # Ayrılmak borcu silmiyor: `period_participants()` kişiyi dönemde
        # tuttuğu için borç kalanların Kasa'sında yaşamaya devam ediyor. Bunu
        # hem ayrılana (istemcideki onay ekranı) hem kalanlara söylemek
        # gerekiyor, yoksa insanlar "ayrıldı, borç da gitti" sanıyor.
        kalan = 0.0
        aktif = await get_active_period(hh["household_id"])
        if aktif:
            try:
                bak = await _compute_balances(hh["household_id"], aktif["period_id"])
                kalan = float((bak.get("net") or {}).get(user["user_id"], 0.0))
            except Exception:   # bakiye okunamazsa ayrılma engellenmemeli
                kalan = 0.0
        await db.households.update_one(
            {"household_id": hh["household_id"]}, {"$pull": {"member_ids": user["user_id"]}}
        )
        # If the admin walks out, hand the household to whoever is left —
        # otherwise nobody can approve joins or close periods ever again.
        if admin_id(hh) == user["user_id"]:
            remaining = [m for m in hh.get("member_ids", []) if m != user["user_id"]]
            if remaining:
                await db.households.update_one(
                    {"household_id": hh["household_id"]},
                    {"$set": {"admin_id": remaining[0]}},
                )
        await _uye_kaydi(hh["household_id"], user["user_id"], "ayrildi")
        # Ayrılma SESSIZ olamaz. Ayrılan kişinin ödeşilmemiş borcu duruyor
        # olabilir ve o borç kalanların ekranında yaşamaya devam ediyor
        # (`period_participants` onu dönemde tutuyor). Ayrıca bu andan sonra
        # ev harcamaları bir kişi eksiğe bölünmeye başlıyor -- kalanların
        # bunu bir yerden görmesi gerekiyor.
        # Tutar bildirimin İÇİNDE. "Bir ev arkadaşı ayrıldı" tek başına
        # eyleme geçirmiyor; "48,20 € borcu duruyor" geçiriyor.
        if kalan < -0.01:
            durum = (f"{money_str(abs(kalan), hh)} borcu duruyor ve ödeşene kadar "
                     "Kasa'da görünmeye devam edecek.")
        elif kalan > 0.01:
            durum = f"Eve {money_str(kalan, hh)} alacağı kaldı."
        else:
            durum = "Ödeşmiş durumdaydı."
        await notify(
            [m for m in hh.get("member_ids", []) if m != user["user_id"]],
            "Bir ev arkadaşı ayrıldı",
            f"{user['name']} evden ayrıldı. {durum} Bundan sonraki ev "
            "harcamaları kalan üyeler arasında bölüşülecek.",
            "member_left",
            {"household_id": hh["household_id"], "user_id": user["user_id"]},
        )
    # also cancel any pending
    await db.households.update_many(
        {"pending_member_ids": user["user_id"]},
        {"$pull": {"pending_member_ids": user["user_id"]}},
    )
    return {"ok": True}


# ---------- OCR (Gemini 3 Flash Vision) ----------
UNIT_KEYS = ("adet", "kg", "lt", "paket")

CATEGORY_KEYS = (
    "sut_urunleri", "meyve_sebze", "et_balik", "firin",
    "icecek", "atistirmalik", "temel_gida", "ev_urunleri", "diger",
)

CATEGORY_KEYWORDS = {
    "sut_urunleri": [
        "milch", "käse", "joghurt", "jogurt", "quark", "sahne", "butter", "kefir",
        "gouda", "camembert", "mozzarella", "feta", "frischkäse", "schmand", "eier",
    ],
    "meyve_sebze": [
        "obst", "gemüse", "apfel", "banane", "tomate", "gurke", "salat", "zwiebel",
        "karotte", "möhre", "kartoffel", "paprika", "zitrone", "orange", "birne",
        "trauben", "beere", "avocado", "brokkoli", "spinat", "pilze", "champignon",
    ],
    "et_balik": [
        "fleisch", "wurst", "schinken", "hähnchen", "rind", "schwein", "fisch",
        "lachs", "puten", "salami", "hack", "steak", "thunfisch", "garnelen", "speck",
    ],
    "firin": [
        "brot", "brötchen", "semmel", "gebäck", "kuchen", "toast", "backwaren",
        "baguette", "croissant", "brezel",
    ],
    "icecek": [
        "wasser", "saft", "cola", "limo", "bier", "wein", "kaffee", "tee",
        "sprudel", "schorle", "energy", "milchgetränk",
    ],
    "atistirmalik": [
        "schokolade", "chips", "keks", "riegel", "eis", "süß", "bonbon",
        "gummibär", "nuss", "erdnuss", "popcorn", "waffel", "praline",
    ],
    "ev_urunleri": [
        "papier", "reiniger", "spül", "waschmittel", "seife", "shampoo", "zahnpasta",
        "duschgel", "putz", "müllbeutel", "schwamm", "windel", "taschentuch",
        "weichspüler", "allzweck", "toiletten",
    ],
}


def _fold_german(s: str) -> str:
    """Fold German text to a plain-ASCII form for keyword matching.

    Receipts (and OCR) spell umlauts either way — "Brötchen" or "Broetchen",
    "Spülmittel" or "Spuelmittel" — so both must land on the same string.
    Keywords are folded with this same function at import time.
    """
    s = s.lower()
    for src, dst in (("ä", "a"), ("ö", "o"), ("ü", "u"), ("ß", "ss")):
        s = s.replace(src, dst)
    for src, dst in (("ae", "a"), ("oe", "o"), ("ue", "u")):
        s = s.replace(src, dst)
    return s


# Longest keyword first, so the most specific match wins regardless of category
# order: "Fleischsalat" must hit "fleisch" (meat), not "salat" (vegetables).
_FOLDED_KEYWORDS: List[tuple] = sorted(
    ((_fold_german(kw), cat) for cat, kws in CATEGORY_KEYWORDS.items() for kw in kws),
    key=lambda pair: len(pair[0]),
    reverse=True,
)


def categorize_item(name: str) -> str:
    n = _fold_german(name)
    for kw, cat in _FOLDED_KEYWORDS:
        if kw in n:
            return cat
    return "diger"


OCR_SYSTEM_PROMPT = """You are an expert at reading grocery receipts from Germany (Kassenbon: Rewe, Edeka, Aldi, Lidl, Penny, Kaufland, Netto, DM, Rossmann, Bauhaus, Obi, Hornbach, IKEA, Action, Tedi) and from Turkey (fiş: BİM, A101, ŞOK, Migros, CarrefourSA, Macrocenter, Tarım Kredi, File, Hakmar, Metro).

Extract information from the receipt image and return STRICT JSON only (no prose, no markdown, no code fences).

Rules:
1. German and Turkish number formats both use comma as decimal separator: "3,49" means 3.49. Convert to a float with dot.
2. Extract the merchant/store name from the top of the receipt (e.g. "REWE", "EDEKA", "ALDI", "BİM", "A101", "ŞOK", "MİGROS"). Turkish receipts print the full legal name ("BİM BİRLEŞİK MAĞAZALAR A.Ş."); return it as printed, the server shortens it. If unknown, use null.
3. Extract the purchase date. Look for "Datum" or "TARİH", or a date-like line at the top or bottom. Return as ISO string "YYYY-MM-DD". Ignore any time.
3b. Currency: "EUR" if the receipt shows EUR or the euro sign, "TRY" if it shows TL, TRY or the lira sign. Read it from the receipt; do not guess from the language.
4. Line items: each product line typically has a name and a price. Return one entry per item.
   - Quantity: if you see "2 x 1,49" or "3 Stk" or "2X" style, set quantity accordingly and use the unit price. If unclear, quantity = 1 and price = total for that line.
   - Unit: weighed goods print a separate line under the item, e.g. "0,590 kg x 10,99 EUR/kg" or "0,284 kg" — that line belongs to the item ABOVE it, never to a new item. When you see one, set "unit":"kg", "quantity":0.590 and "price":10.99 (the per-kilo price). Same for litres ("1,5 l", "0,75 L") with "unit":"lt". Multi-packs counted in pieces stay "unit":"adet". Never turn a weight into a piece count: 0,590 kg is not 590 pieces.
   - German items often have "A" or "B" (VAT class) at end — strip it.
   - Generic name: ALSO return "generic" — what the product actually IS, as a
     short common noun in TURKISH, singular and lowercase. Use your knowledge
     of the product, not the printed words: receipts print brand and marketing
     names, so "Gelbwuerzel 1kg" is "havuç", "Goldaehren" is "ekmek",
     "Hafermilch" is "yulaf sütü", "TUNA DILIM SUCUK" is "sucuk", "Milbona
     Joghurt" is "yoğurt". Keep it to one or two words and do not include
     brand, size or packaging.
     If you genuinely do not know what the product is, return null. A wrong
     generic name is worse than none: it silently merges two different
     products into one.
   - Package size: if the printed name carries a pack size ("ZWIEBELN 2KG",
     "PAPRIKA ROT 500G", "6x0,33L", "Milch 1,5L"), ALSO return it separately as
     "size_amount" (a number in kilograms or litres, so 500 g is 0.5) and
     "size_unit" ("kg" or "lt"). Keep the size in "name" as printed — do not
     rewrite the name. If the item is weighed at the till, leave size_amount
     null and set "unit":"kg" as described above; the per-kilo price is already
     in "price". If there is no size anywhere, leave both null.
     This is used to compare prices per kilo between shops, so a wrong size is
     worse than a missing one: when unsure, return null.
5. Discount lines: markers include "Rabatt", "RABATT", "-%", "Preisnachlass", "PAYBACK Rabatt", lines starting with "-", or negative prices. If a discount is clearly associated with an item, subtract from that item's price. Otherwise return as a separate item with negative price.
6. Ignore non-item lines: "MwSt", "Summe", "Zwischensumme", "Gesamtsumme", "Bar", "EC", "Karte", "Rueckgeld", and their Turkish equivalents "TOPLAM", "ARA TOPLAM", "KDV", "NAKİT", "KREDİ KARTI", "PARA ÜSTÜ", "FİŞ NO", store address, times, cashier numbers, "vielen Dank", "teşekkür ederiz".
7. Item names stay in the language printed on the receipt — do NOT translate.

8. Classify every line item into exactly one category. Use your own knowledge
   of the product, not the wording: receipts print brand names, not product
   types ("Goldähren" is bread, "TUNA DILIM SUCUK" is sausage), and this
   household also shops at Turkish supermarkets, so items may be in Turkish,
   German or English. Allowed values:
     "sut_urunleri"  milk, cheese, yoghurt, butter, cream, eggs (süt, kaşar, peynir, yumurta)
     "meyve_sebze"   fresh fruit and vegetables (meyve, sebze, salça değil)
     "et_balik"      meat, poultry, fish, sausage, charcuterie (et, tavuk, balık, sucuk, salam)
     "firin"         bread, pastry, cake, biscuits-as-bakery (ekmek, poğaça, börek)
     "icecek"        any drink incl. water, juice, tea, coffee, beer, wine (çay, kahve, ayran)
     "atistirmalik"  sweets, crisps, chocolate, nuts, ice cream (çikolata, cips, kuruyemiş)
     "temel_gida"    pasta, rice, flour, sugar, oil, legumes, spices, tinned goods
                     (makarna, pirinç, un, şeker, yağ, bakliyat, baharat, salça, konserve)
     "ev_urunleri"   cleaning, hygiene, paper goods, bags, batteries (deterjan, şampuan, poşet)
     "diger"         only when genuinely none of the above fits
   Discount lines take the category "diger".

Return JSON EXACTLY in this schema:
{
  "merchant": "REWE" | "EDEKA" | "ALDI" | "LIDL" | "PENNY" | "KAUFLAND" | "NETTO" | "DM" | "ROSSMANN" | string | null,
  "date": "YYYY-MM-DD" | null,
  "total": number | null,
  "currency": "EUR" | "TRY",
  "items": [
    { "name": string, "price": number, "quantity": number, "unit": "adet" | "kg" | "lt" | "paket",
      "size_amount": number | null, "size_unit": "kg" | "lt" | null,
      "generic": string | null, "category": string }
  ]
}

If nothing is legible, return empty items array."""


GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


async def gemini_vision(system_prompt: str, user_text: str, image_b64: str, mime: str = "image/jpeg") -> str:
    """Call the Google Generative Language REST API directly (free-tier API key)."""
    payload = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": user_text},
                    {"inline_data": {"mime_type": mime, "data": image_b64}},
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            # Reading a receipt is transcription, not reasoning. Left on, the
            # model spent ~1000 thinking tokens per scan and they come out of
            # the same output budget — long receipts had their JSON cut off
            # mid-array and failed to parse.
            "thinkingConfig": {"thinkingBudget": 0},
            "maxOutputTokens": 8192,
        },
    }
    url = GEMINI_ENDPOINT.format(model=GEMINI_MODEL)

    # The free tier returns 503/429 under load often enough that a single
    # attempt shows up to the user as "fiş okunamadı" for a perfectly good
    # photo. Retry the transient ones; a scan is worth a few extra seconds.
    last_status, last_body = None, ""
    for attempt in range(1, 4):
        try:
            async with httpx.AsyncClient(timeout=120.0) as http:
                r = await http.post(url, params={"key": GEMINI_API_KEY}, json=payload)
        except Exception as e:
            logger.warning("Gemini ağ hatası (deneme %s): %s", attempt, e)
            if attempt == 3:
                raise HTTPException(status_code=502, detail="OCR servisine ulaşılamadı")
            await asyncio.sleep(attempt * 2)
            continue

        if r.status_code == 200:
            data = r.json()
            candidates = data.get("candidates") or []
            finish = candidates[0].get("finishReason") if candidates else None
            parts = (candidates[0].get("content", {}).get("parts") or []) if candidates else []
            text = "".join(p.get("text", "") for p in parts).strip()
            if finish == "MAX_TOKENS":
                # Truncated JSON is unparseable; say so plainly in the log
                # instead of leaving a "parse hatası" mystery behind.
                logger.warning("Gemini çıktı bütçesi doldu (deneme %s), yanıt kesildi", attempt)
                text = ""
            if text:
                return text
            # Empty completion happens on a hiccup too — worth one more go.
            logger.warning("Gemini boş yanıt (deneme %s), finish=%s", attempt,
                           candidates[0].get("finishReason") if candidates else None)
            last_status, last_body = 200, "boş yanıt"
        else:
            last_status, last_body = r.status_code, r.text[:300]
            logger.warning("Gemini %s (deneme %s): %s", r.status_code, attempt, last_body)
            if r.status_code == 429:
                # Ücretsiz katmanın kotası DAKİKALIK: arka arkaya iki fiş
                # taramak ikincisini düşürüyordu ve kullanıcı için bu "uygulama
                # sadece bir fiş okuyor" gibi görünüyordu. Bir kez bekleyip
                # tekrar deniyoruz; kalıcıysa dürüstçe söylüyoruz.
                if attempt == 1:
                    logger.warning("Gemini kota (429), 20 sn bekleyip tekrar denenecek")
                    await asyncio.sleep(20)
                    continue
                raise HTTPException(
                    status_code=429,
                    detail="Ücretsiz OCR kotası doldu. Bir dakika sonra tekrar deneyin.",
                )
            if r.status_code < 500 and r.status_code != 408:
                break  # kalıcı hata, tekrar denemenin anlamı yok

        if attempt < 3:
            await asyncio.sleep(attempt * 2)

    logger.error("Gemini başarısız: %s %s", last_status, last_body)
    raise HTTPException(status_code=502, detail="Fiş okunamadı, lütfen tekrar deneyin")


@api.post("/ocr/receipt")
async def ocr_receipt(body: OCRRequest, user=Depends(get_current_user)):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY tanımlı değil")

    hh = await get_user_household(user["user_id"])
    b64 = body.image_base64
    mime = "image/jpeg"
    if b64.startswith("data:"):
        header, b64 = b64.split(",", 1)
        if ";" in header and ":" in header:
            mime = header.split(":", 1)[1].split(";", 1)[0] or mime

    try:
        text = await gemini_vision(
            OCR_SYSTEM_PROMPT,
            "Parse this German receipt and return the strict JSON as specified.",
            b64,
            mime,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("OCR call failed")
        raise HTTPException(status_code=502, detail=f"OCR başarısız: {e}")

    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        logger.error("OCR yanıtı JSON değil: %s", text[:300])
        raise HTTPException(status_code=502, detail="Fiş okunamadı, lütfen tekrar deneyin")
    try:
        parsed = json.loads(text[start : end + 1])
    except Exception:
        logger.error("OCR JSON parse edilemedi: %s", text[:300])
        raise HTTPException(status_code=502, detail="Fiş okunamadı, lütfen tekrar deneyin")

    items = []
    for it in parsed.get("items", []) or []:
        try:
            name = str(it.get("name", "")).strip()
            price = float(it.get("price", 0) or 0)
            qty = float(it.get("quantity", 1) or 1)
        except Exception:
            continue
        if not name:
            continue
        # The model classifies from product knowledge; the keyword matcher is
        # only a net for when it returns something unexpected. Keywords alone
        # missed 56% of real items — they are German-only and half this
        # household's shopping is Turkish brands.
        cat = str(it.get("category", "") or "").strip().lower()
        if cat not in CATEGORY_KEYS:
            cat = categorize_item(name)
        unit = str(it.get("unit", "") or "").strip().lower()
        if unit not in UNIT_KEYS:
            # Model birim vermediyse tartıya benzeyen miktarı adet saymayalım:
            # tam sayı olmayan bir miktar fişte neredeyse her zaman kilogramdır.
            unit = "kg" if 0 < qty < 1 or (qty % 1) else "adet"
        # Modelin verdigi boyut, ada bakan ayristiriciya tercih edilir; ikisi de
        # yoksa alan bos kalir ve kalem yine normal kaydedilir. Bos boyut, yanlis
        # boyuttan iyidir: yanlis olan dogrudan yanlis birim fiyat demek.
        size_amount, size_unit = None, None
        try:
            sa = it.get("size_amount")
            su = str(it.get("size_unit") or "").strip().lower()
            if sa is not None and su in ("kg", "lt") and float(sa) > 0:
                size_amount, size_unit = round(float(sa), 4), su
        except (TypeError, ValueError):
            pass
        if size_amount is None:
            got = parse_size(name)
            if got:
                size_amount, size_unit = got[0], got[1]
        # Modelin urun bilgisi. Fis "Gelbwurzel 1kg" yaziyor ama satilan sey
        # havuc; hicbir kural tabanli eslestirme bunu bilemez. Bos gelmesi
        # sorun degil, yanlis gelmesi sorun -- isteme "emin degilsen null don"
        # yazili.
        generic = str(it.get("generic") or "").strip().lower()[:40] or None
        items.append(
            {
                "name": name,
                "price": round(price, 2),
                "quantity": qty if qty > 0 else 1,
                "unit": unit,
                "size_amount": size_amount,
                "size_unit": size_unit,
                "generic": generic,
                "category": cat,
            }
        )

    return {
        "merchant": parsed.get("merchant"),
        "date": parse_date(parsed.get("date")),
        "total": parsed.get("total"),
        # Fisin para birimi KAYNAK degil, DENETIM: evin para birimi neyse
        # kayit ona gore tutuluyor. Fis baska bir birimdeyse istemci uyarir --
        # 500 TL'yi sessizce euro toplamina eklemek en kotu sonuc olurdu.
        "currency": (parsed.get("currency") or "").upper() or None,
        "household_currency": (hh or {}).get("currency", "EUR"),
        "items": items,
    }


# ---------- Bölüşme ----------
# Üç ayrı özel durum (`household` / `self` / `roommate`) tek mekanizmaya indi:
# her harcama kendi katılımcı listesini taşır.
#
#     split_mode "equal"  → split_with = {user_id: ağırlık}   (bugün hep 1)
#     split_mode "exact"  → split_with = {user_id: tutar}
#
# Liste yalnızca parayı değil, **görünürlüğü ve bildirimi de** belirliyor:
# harcamayı ekleyen ve listede olanlar görür, listede olanlara haber gider.
# Böylece eski üç durum kendiliğinden çıkıyor — herkes listede = ev, sadece
# ben = kişisel, tek başkası = ona ait.
#
# Liste kayıt anında donuyor. Sonradan eve katılan biri geçmiş harcamaların
# payını kendiliğinden üstlenmiyor; katılım onayında açıkça soruluyor.


def _split_from_target(target_type: Optional[str], target_user_id: Optional[str],
                       payer: str, total: float, member_ids: List[str]) -> tuple:
    """Eski `target_type` girdisinden katılımcı listesi türet.

    İki yerde lazım: `split_with` göndermeyen bir istemci (eski APK, testler)
    ve `split_with` alanı hiç yazılmamış eski kayıtlar.
    """
    if target_type == "roommate" and target_user_id:
        return "exact", {target_user_id: round(float(total), 2)}
    if target_type == "self":
        return "exact", {payer: round(float(total), 2)}
    # Varsayılan ev harcaması. Ağırlıklar 1: "eşit bölüş" demenin yolu.
    return "equal", {m: 1.0 for m in member_ids} or {payer: 1.0}


def split_of(e: dict, participants: List[str]) -> tuple:
    """Bir harcamanın bölüşme kipi ve listesi.

    `split_with` yazılmamış eski kayıtlar için `target_type`'tan türetiliyor.
    Bu yedek yol kalıcıdır: tek seferlik bir göç betiği kaçırdığı her kaydı
    sessizce dengeden düşürürdü, burada böyle bir kayıp mümkün değil.
    """
    sw = e.get("split_with")
    if isinstance(sw, dict) and sw:
        mode = e.get("split_mode") or "equal"
        return mode, {u: float(v) for u, v in sw.items()}
    return _split_from_target(
        e.get("target_type"), e.get("target_user_id"),
        e["added_by"], float(e.get("total") or 0), participants,
    )


def expense_shares(e: dict, participants: List[str]) -> Dict[str, float]:
    """Kim bu harcamadan ne kadar borçlandı.

    Eşit bölüşmede paylar yuvarlanmadan dağıtılıyor; yuvarlama en sonda, net
    bakiye üzerinde bir kez yapılıyor. Kişi başına yuvarlamak 10,00 €'yu üç
    kişide 9,99 ya da 10,02 yapar ve toplam ödenen ile bölüşülen tutmaz.
    """
    mode, sw = split_of(e, participants)
    total = float(e.get("total") or 0)
    if mode == "exact":
        return {u: float(a) for u, a in sw.items() if float(a) != 0}
    weights = {u: float(w) for u, w in sw.items() if float(w) > 0}
    denom = sum(weights.values())
    if denom <= 0:
        return {}
    return {u: total * w / denom for u, w in weights.items()}


# Bir harcamanın bir kişi için hangi HAREKET satırına, ne kadar yazıldığı.
#
# Aynı harcama birden çok satıra düşebilir: ortak bir alışverişi sen ödediysen
# hem "ev alışverişlerindeki payın" (borcunu artıran) hem de "senin ödediğin ev
# alışverişleri" (azaltan) satırına yazılır. İkisi aynı olayın iki yüzü.
#
# **Tek yerde duruyor.** `_ekstre()` bakiyeyi bu türlere ayırıyor,
# `/expenses?akis=` de aynı türle süzüyor. İki kopya olsaydı kaçınılmaz olarak
# ayrışırlardı ve belirtisi şu olurdu: ekstrede "Senin için alınanlar 8,40"
# yazıyor, dokunuyorsun, liste boş açılıyor. Kullanıcı bunu bir gizlilik
# kuralı sanır — oysa iki süzgeç aynı fikirde değildir.
#
# İşaret kuralı burada değil ekranda: artı borcu artırır, eksi azaltır.
def akis_paylari(e: dict, shares: Dict[str, float], user_id: str,
                 member_ids: List[str]) -> Dict[str, float]:
    """Satırlar `kime_kategori()` ile BİREBİR eşleşiyor.

    Önce eşleşmiyordu ve etiket yalan söylüyordu: "Ev alışverişlerindeki
    payın 107,32" satırı, ev harcaması OLMAYAN ikili bir alışverişteki payını
    (2,99) da içine katıyordu. Ekrandaki sayıyı üçle çarpıp evin toplamını
    bulmaya çalışan biri yanlış rakama varıyordu.

    Artık her satırın tek bir karşılığı var ve dokunulduğunda Harcamalar'da
    tam o küme açılıyor. Kategori başına en fazla iki satır: **payın**
    (borcunu artıran) ve **ödediğin** (azaltan).

      ev      → `ev_pay` + `ev_odedigin`
      bana    → `bana_pay`            (tanım gereği alan sen değilsin)
      baskasi → `baskasi_pay` + `baskasi_odedigin`   (alan hep sensin)
      kendim  → hiçbiri; kişisel harcama bakiyeye girmiyor

    Toplamlar korunuyor: artıran satırların toplamı `share`, azaltanların
    toplamı `paid`, farkı da ayın deltası. `_ekstre` bunu test ediyor.
    """
    kategori = kime_kategori(e, shares, user_id, member_ids)
    if not kategori or kategori == "kendim":
        return {}
    payim = float(shares.get(user_id, 0.0))
    tam = float(e.get("total") or 0)
    out: Dict[str, float] = {}
    if kategori == "ev":
        if payim:
            out["ev_pay"] = payim
        if e["added_by"] == user_id:
            out["ev_odedigin"] = tam
    elif kategori == "bana":
        if payim:
            out["bana_pay"] = payim
    else:   # baskasi — alan sensin, listede senden başkası da var
        # Kendi payın borcunu artırır, fişin tamamı azaltır; net fark tam
        # olarak ötekilerin sana borçlandığı tutardır.
        if payim:
            out["baskasi_pay"] = payim
        out["baskasi_odedigin"] = tam
    return out


def kime_kategori(e: dict, shares: Dict[str, float], user_id: str,
                  member_ids: List[str]) -> Optional[str]:
    """Bir harcama **kimin için** alınmış — Harcamalar süzgecinin ekseni.

    `akis_paylari()`'ndan AYRI ve bilerek: o bakiyeyi açıklıyor ("borcun nasıl
    oluştu"), bu ise "ne aldık" sorusuna cevap veriyor. İkisini tek fonksiyona
    sıkıştırmak, para matematiğini gözatma aracına bağımlı hale getirirdi.

    Kural **alıcıdan bağımsız**: kategoriyi bölüşme listesi belirliyor, kimin
    ödediği değil. "Kim aldı" ayrı bir eksen (kişi süzgeci) ve ikisi
    çarpılabiliyor — "Kemal'in eve aldıkları" = `ev` + kişi:Kemal.

      * `ev`      — liste evin TAMAMI. Kim almış olursa olsun ev harcaması.
      * `bana`    — seni İÇEREN alt küme, alan başkası. Yalnız sana da
                    olabilir, sen+Kemal de: ikisinde de sana alınmıştır.
      * `baskasi` — alan sensin ve listede senden başkası da var. Kendi payın
                    içinde olsa bile birini sübvanse etmişsindir.
      * `kendim`  — yalnızca sen, alan da sen. Kişisel harcama.
    """
    if not shares:
        return None
    kisiler = set(shares)
    # "Ev" DONMUŞ bilgidir: `target_type` kayıt anındaki kadroya göre yazıldı.
    # Bugünkü üye listesiyle karşılaştırmak, biri evden ayrıldığında geçmişteki
    # bütün ev harcamalarını "ev değil" yapardı. Alan yoksa küme kıyası yedek —
    # tek kişilik evde "herkes" ile "sadece ben" aynı listedir ve orada doğru
    # cevap ev harcamasıdır (`derive_target_type` ile aynı öncelik sırası).
    if e.get("target_type") == "household" or kisiler == set(member_ids):
        return "ev"
    odeyen = e["added_by"]
    if user_id in kisiler:
        if odeyen != user_id:
            return "bana"
        return "baskasi" if len(kisiler) > 1 else "kendim"
    # Seni içermeyen alt küme: yalnızca sen aldıysan görebiliyorsun zaten.
    return "baskasi" if odeyen == user_id else None


def derive_target_type(payer: str, split_with: Dict[str, float], member_ids: List[str]) -> str:
    """Listeden okunan etiket. Süzgeçler ve ekrandaki rozet bunu kullanıyor.

    Sıra önemli: tek kişilik bir evde "herkes" ile "sadece ben" aynı listedir,
    ve orada doğru cevap ev harcamasıdır — kişisel harcama kimseden gizlenmiyor.
    """
    keys = set(split_with)
    if keys and keys == set(member_ids):
        return "household"
    if keys == {payer}:
        return "self"
    if len(keys) == 1:
        return "roommate"
    return "custom"


def validate_split(mode: str, split_with: Dict[str, float], total: float,
                   allowed: List[str]) -> Dict[str, float]:
    """Kaydetmeden önce listeyi doğrula ve temizle."""
    if not split_with:
        raise HTTPException(status_code=400, detail="Bölüşülecek kişi seçilmedi")
    clean: Dict[str, float] = {}
    for uid, val in split_with.items():
        if uid not in allowed:
            raise HTTPException(status_code=400, detail="Bölüşme listesinde evin üyesi olmayan biri var")
        v = round(float(val), 2)
        if v <= 0:
            continue
        clean[uid] = v
    if not clean:
        raise HTTPException(status_code=400, detail="Bölüşülecek kişi seçilmedi")
    if mode == "exact":
        # 0,01 tolerans: kullanıcı 1200'ü 400/400/400 diye böldüğünde sorun yok
        # ama 1000'i üçe bölerken 333,33 × 3 = 999,99 kalıyor.
        if abs(sum(clean.values()) - round(float(total), 2)) > 0.01 + 1e-9:
            raise HTTPException(
                status_code=400,
                detail="Girilen tutarların toplamı harcama tutarını tutmuyor",
            )
    return clean


def resolve_split(body, payer: str, total: float, member_ids: List[str],
                  fallback: Optional[dict] = None) -> tuple:
    """İstekten bölüşme kipi ve listesini çıkar.

    `split_with` geldiyse o kullanılır; gelmediyse `target_type`'tan türetilir.
    """
    if body.split_with is not None:
        mode = body.split_mode or "equal"
        allowed = list(dict.fromkeys(list(member_ids) + [payer]))
        return mode, validate_split(mode, body.split_with, total, allowed)
    # `target_type` yalnızca harcama gövdelerinde var. Düzenli gider şablonu
    # gibi yalnızca `split_with` taşıyan gövdelerde alan hiç bulunmuyor.
    tt = getattr(body, "target_type", None)
    tu = getattr(body, "target_user_id", None)
    if tt is not None or fallback is None:
        return _split_from_target(tt, tu, payer, total, member_ids)
    # Ne liste ne etiket geldi: düzenlemede bölüşmeye dokunulmamış demektir.
    stored = fallback.get("split_with")
    if not (isinstance(stored, dict) and stored):
        # Eski kayıt: liste `target_type`'tan türetiliyor, yani tutarı takip eder.
        return _split_from_target(
            fallback.get("target_type"), fallback.get("target_user_id"),
            payer, total, member_ids,
        )
    mode, sw = split_of(fallback, member_ids)
    if mode == "exact" and abs(sum(sw.values()) - round(float(total), 2)) > 0.01 + 1e-9:
        # Kişiye özel tutarlar toplamı tutmuyor. Oransal olarak yeniden
        # dağıtmak sessizce yanlış borç üretir — 1200 €'luk kirada A'nın 350'si
        # kimsenin onaylamadığı bir sayıya kayar. Kullanıcı yeniden bölüştürsün.
        raise HTTPException(
            status_code=400,
            detail="Tutar değişti, kişiye özel bölüşüm artık tutmuyor. Bölüşümü yeniden düzenleyin.",
        )
    return mode, sw


# ---------- Expenses ----------
@api.post("/expenses")
async def create_expense(body: ExpenseCreate, user=Depends(get_current_user)):
    hh = await get_user_household(user["user_id"])
    if not hh:
        raise HTTPException(status_code=400, detail="Önce bir eve katılın")
    period = await get_active_period(hh["household_id"])
    if not period:
        raise HTTPException(status_code=400, detail="Aktif dönem bulunamadı")

    if body.target_type == "roommate":
        if not body.target_user_id or body.target_user_id not in hh["member_ids"]:
            raise HTTPException(status_code=400, detail="Geçersiz oda arkadaşı")
        if body.target_user_id == user["user_id"]:
            raise HTTPException(status_code=400, detail="Kendinize atayamazsınız")

    split_mode, split_with = resolve_split(
        body, user["user_id"], body.total, hh["member_ids"]
    )
    target_type = derive_target_type(user["user_id"], split_with, hh["member_ids"])

    expense_id = new_id("exp")
    doc = {
        "expense_id": expense_id,
        "household_id": hh["household_id"],
        "period_id": period["period_id"],
        "added_by": user["user_id"],
        "target_type": target_type,
        # Tek kişiye ait harcamalarda korunuyor: eski kayıtlarla aynı şekilde
        # süzülebilsin ve eski APK sürümleri hedefi okumaya devam edebilsin.
        # Listeden okunuyor, gövdeden değil — istemci `split_with` gönderip
        # `target_user_id` göndermemiş olabilir.
        "target_user_id": next(iter(split_with)) if target_type == "roommate" else None,
        "split_mode": split_mode,
        "split_with": split_with,
        "items": [i.model_dump() for i in body.items],
        "total": round(body.total, 2),
        "source": body.source,
        "category": body.category,
        "merchant": await resolve_merchant(hh["household_id"], body.merchant),
        "notes": body.notes,
        "currency": hh.get("currency", "EUR"),
        "expense_date": parse_date(body.expense_date) or ev_bugun(hh).isoformat(),
        "created_at": now_utc(),
    }
    await db.expenses.insert_one(doc.copy())
    # Fiyat kaydi harcamadan SONRA ve tamamen ayri: icerideki her sey yutuluyor,
    # yazilamamasi harcamanin kaydedilmesini engellemiyor.
    await record_price_points(doc, hh)

    # Kimin haberi olacağı, kimin payı olduğundan çıkıyor: listede olan herkes
    # (ekleyen hariç) duyar. Kişisel harcamada liste yalnızca ekleyeni içerdiği
    # için kimseye gitmez — gizli olması gereken şey varlığını da duyurmamalı.
    audience = [u for u in split_with if u != user["user_id"]]
    if audience:
        label = body.merchant or body.category or ("Fiş" if body.source == "receipt" else "Harcama")
        amount = money_str(doc["total"], hh)
        if target_type == "household":
            title, msg = "Yeni ev harcaması", f"{user['name']} · {label} · {amount}"
        elif target_type == "roommate":
            title, msg = "Senin için bir harcama", f"{user['name']} senin için {label} aldı · {amount}"
        else:
            title = "Ortak bir harcama"
            msg = f"{user['name']} · {label} · {amount} · {len(split_with)} kişi bölüşüyor"
        # `ay` neden var: bildirime dokununca Harcamalar ekrani aciliyor ve o
        # ekran AY bazli calisiyor. Ay yazilmazsa geriye tarihli bir fis
        # bugunun listesinde bulunamaz. Eski bildirimlerde bu alan yok; istemci
        # o zaman hicbir seyi acmiyor -- yanlis fis acmaktansa hicbiri.
        await notify(audience, title, msg, "new_expense",
                     {"expense_id": expense_id, "ay": doc["expense_date"][:7]})
    return {"expense": doc}


def _visible_filter(user_id: str) -> dict:
    """Bu kişinin görebileceği harcamalar: eklediği ya da payı olduğu.

    Kural bölüşme listesinden okunuyor. `split_with` yazılmamış eski kayıtlar
    için eski `target_type` maddeleri duruyor — sorgu veritabanında çalıştığı
    için `split_of()` yedek yolu burada kullanılamıyor.
    """
    legacy = {"split_with": {"$in": [None, {}]}}
    return {
        "$or": [
            {"added_by": user_id},
            {f"split_with.{user_id}": {"$exists": True}},
            {**legacy, "target_type": "household"},
            {**legacy, "target_type": "roommate", "target_user_id": user_id},
        ]
    }


@api.get("/expenses")
async def list_expenses(
    period_id: Optional[str] = None,
    member_id: Optional[str] = None,
    target_type: Optional[str] = None,
    month: Optional[str] = None,
    akis: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Görünür harcamalar.

    `month=YYYY-MM` verilirse dönem yerine **takvim ayı** süzülür ve her
    kayda `my_share` (senin payın) ile `kime` (kimin için) eklenir.

    `akis=` **kimin için** ekseni — `kime_kategori()` tanımlıyor:
    `ev` · `bana` · `baskasi` · `kendim`. Kişi süzgeci (`member_id`) "kim
    aldı" eksenidir ve ikisi ÇARPILABİLİR: `akis=ev&member_id=kemal` =
    "Kemal'in eve aldıkları".

    Bu eksen bilerek `akis_paylari()`'ndan ayrı. O bakiyeyi açıklıyor
    ("borcun nasıl oluştu"), bu "ne aldık" sorusuna cevap veriyor; tek
    fonksiyona sıkıştırmak para matematiğini gözatma aracına bağlardı.

    **Bu süzgeç neden istemcide değil.** Önce `split_with` alanına bakarak
    telefonda süzülüyordu ve Tur 4 öncesi kayıtları kaçırıyordu: o kayıtlarda
    alan hiç yok, `split_of()` yedek yolu ise yalnızca sunucuda çalışıyor.
    Belirtisi "Senin için alınanlar 3 €" yazıp içinin boş açılmasıydı — bir
    gizlilik kuralı gibi görünüyordu, oysa yalnızca eksik veriydi.
    """
    hh = await get_user_household(user["user_id"])
    if not hh:
        return {"expenses": []}
    q: dict = {"household_id": hh["household_id"]}
    aylik = bool(month) and len(month or "") == 7
    if aylik:
        pass  # ay süzgeci Python tarafında; `expense_date` boşsa `created_at`
    elif period_id:
        q["period_id"] = period_id
    else:
        active = await get_active_period(hh["household_id"])
        if active:
            q["period_id"] = active["period_id"]
    q.update(_visible_filter(user["user_id"]))
    if member_id:
        q["added_by"] = member_id
    if target_type:
        q["target_type"] = target_type
    exps = await db.expenses.find(q, {"_id": 0}).sort("expense_date", -1).to_list(1000)

    if aylik:
        # Ay süzgeci burada, sorguda değil: `_expense_day()` tarihi boş olan
        # eski kayıtlarda `created_at`'e düşüyor ve bu mantık Mongo sorgusuna
        # çevrilemiyor.
        exps = [e for e in exps if _expense_day(e)[:7] == month]
    if aylik or akis:
        uyeler = await period_participants(
            hh["household_id"],
            (await get_active_period(hh["household_id"]) or {}).get("period_id", ""),
            hh["member_ids"],
        )
        suzulmus = []
        for e in exps:
            shares = expense_shares(e, uyeler)
            # "Kimin için" ekseni. Kişi süzgeci (`member_id`) ayrı çalışıyor ve
            # ikisi çarpılabiliyor: `akis=ev` + `member_id=kemal` = "Kemal'in
            # eve aldıkları".
            kategori = kime_kategori(e, shares, user["user_id"], hh["member_ids"])
            if akis and kategori != akis:
                continue
            e["kime"] = kategori
            e["my_share"] = round(float(shares.get(user["user_id"], 0.0)), 2)
            suzulmus.append(e)
        exps = suzulmus

    # ÖDEŞME GÜNÜ her kayda yazılıyor.
    #
    # Dönem yalnızca ödeşilince kapanıyor, yani **kapalı dönem = ödeşilmiş**.
    # Aylık pencereye geçince bir ayın içinde ödeşilmiş ve ödeşilmemiş
    # harcamalar yan yana düşer oldu (15 Temmuz'da ödeştiyseniz Temmuz'un
    # yarısı öyle, yarısı böyle) ve listede ikisini ayıran hiçbir şey yoktu.
    #
    # Çizgiyi istemci çiziyor ama TARİHİ burada üretiliyor: kapanış anı
    # dönemin üstünde duruyor, harcamanın değil.
    kapali = {}
    for p in await db.periods.find(
        {"household_id": hh["household_id"], "status": "closed"},
        {"_id": 0, "period_id": 1, "closed_at": 1},
    ).to_list(500):
        if p.get("closed_at"):
            kapali[p["period_id"]] = make_aware(p["closed_at"]).date().isoformat()
    for e in exps:
        e["odesme"] = kapali.get(e.get("period_id"))

    # secondary sort by created_at desc for same date
    exps.sort(key=lambda e: (e.get("expense_date") or "", e.get("created_at")), reverse=True)
    return {"expenses": exps}


@api.get("/members/{member_id}/expenses")
async def member_expenses(
    member_id: str,
    month: Optional[str] = None,
    period_id: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Bir ev arkadaşının o ay ne aldığı — çağırana görünen kadarıyla.

    `month=YYYY-MM` verilirse takvim ayı süzülür. Görüntülemenin her yeri
    takvim ayı olduğu için varsayılan da budur; `period_id` yalnızca eski
    APK'lar için duruyor.

    **İki toplam düzeltildi.** Önce `household_total` / `roommate_total`
    dönüyordu ve ekran ikincisini "Kişisel" diye yazıyordu — oysa `roommate`
    *bir başkası için* alınan demek, kişisel değil. Yani "Kemal'in kişiseli"
    yazan satır aslında Kemal'in BAŞKASI için aldıklarıydı. Üç sayı da ayrı
    dönüyor; adları neyi saydıklarını söylüyor.
    """
    hh = await get_user_household(user["user_id"])
    if not hh or member_id not in hh["member_ids"]:
        raise HTTPException(status_code=404, detail="Üye bulunamadı")
    q: dict = {"household_id": hh["household_id"], "added_by": member_id}
    aylik = bool(month) and len(month or "") == 7
    if aylik:
        pass  # ay süzgeci Python tarafında; `expense_date` boşsa `created_at`
    elif period_id:
        q["period_id"] = period_id
    else:
        active = await get_active_period(hh["household_id"])
        if active:
            q["period_id"] = active["period_id"]
    q.update(_visible_filter(user["user_id"]))
    exps = await db.expenses.find(q, {"_id": 0}).to_list(1000)
    if aylik:
        exps = [e for e in exps if _expense_day(e)[:7] == month]
    exps.sort(key=lambda e: (e.get("expense_date") or "", e.get("created_at")), reverse=True)

    uyeler = await period_participants(
        hh["household_id"],
        (await get_active_period(hh["household_id"]) or {}).get("period_id", ""),
        hh["member_ids"],
    )
    ev = kisisel = baskasi = 0.0
    for e in exps:
        shares = expense_shares(e, uyeler)
        tutar = float(e.get("total") or 0)
        if len(shares) > 1:
            ev += tutar
        elif set(shares) == {member_id}:
            kisisel += tutar
        else:
            baskasi += tutar
    return {
        "expenses": exps,
        "household_total": round(ev, 2),
        "personal_total": round(kisisel, 2),
        "for_others_total": round(baskasi, 2),
        # Eski APK'lar bu adı okuyor; anlamı değişmedi (başkası için alınan).
        "roommate_total": round(baskasi, 2),
    }


async def _get_editable_expense(expense_id: str, user: dict) -> dict:
    """Fetch an expense the caller is allowed to change.

    Closed periods are off limits. Their balances are what everyone settled
    on; editing or deleting inside one rewrites history after the fact and the
    numbers people already paid against would silently stop matching. To fix
    something in a closed period, reopen it first.
    """
    doc = await db.expenses.find_one({"expense_id": expense_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Harcama bulunamadı")
    if doc["added_by"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Sadece ekleyen kişi değiştirebilir")

    period = await db.periods.find_one({"period_id": doc["period_id"]}, {"_id": 0})
    if period and period.get("status") == "closed":
        raise HTTPException(
            status_code=400,
            detail="Bu harcama kapatılmış bir döneme ait. Değiştirmek için önce dönemi yeniden açın.",
        )
    return doc


# Kimin payını değiştiren alanlar. Nottaki bir yazım hatası kimseyi
# ilgilendirmiyor; telefon her düzeltmede titrerse insanlar bildirimleri
# kapatır ve asıl önemli olanı da kaçırır.
MATERIAL_FIELDS = ("total", "target_type", "target_user_id", "split_with")


# Fişin üstündeki ticari unvan ekleri. "BIM BIRLESIK MAGAZALAR A.Ş." ile
# "BİM" aynı market; bunlar temizlenmezse istatistikte iki ayrı satır oluyor.
LEGAL_SUFFIXES = (
    "a.ş.", "a.ş", "as", "aş", "ltd. şti.", "ltd.şti.", "ltd şti", "ltd.", "ltd",
    "şti.", "şti", "san. ve tic.", "san.ve tic.", "san. tic.", "sanayi ve ticaret",
    "ticaret", "tic.", "tic", "gmbh & co. kg", "gmbh & co kg", "gmbh", "mbh",
    "kg", "ag", "e.k.", "ek", "ohg", "gbr", "se", "inc.", "inc", "b.v.", "bv",
)


# Bilinen zincirler. Fişin üstünde tam ticari unvan yazıyor
# ("BİM BİRLEŞİK MAĞAZALAR A.Ş."), insanların kullandığı ad ise kısa olanı.
# Benzerlik ölçümü bunu çözemez — iki metin gerçekten farklı; markayı bilmek
# gerekiyor. Ekrandaki marka renkleri de bu adlarla eşleşiyor.
KNOWN_MERCHANTS = (
    # Türkiye
    "BİM", "A101", "ŞOK", "Migros", "CarrefourSA", "Macrocenter", "Tarım Kredi",
    "File", "Hakmar", "Onur Market", "Metro",
    # Almanya
    "REWE", "EDEKA", "ALDI", "LIDL", "PENNY", "KAUFLAND", "NETTO", "NORMA",
    "DM", "ROSSMANN", "ACTION", "TEDi", "BAUHAUS", "OBI", "HORNBACH", "IKEA",
)

# Türkçe harfleri karşılaştırma için sadeleştir. `.lower()` Türkçe'de
# güvenilmez ("İ" iki kod noktasına açılıyor) ve OCR aynı harfi her seferinde
# aynı yazmıyor; katlayınca "BİM" ile "BIM" aynı anahtara düşüyor.
_FOLD = str.maketrans({
    "ğ": "g", "Ğ": "g", "ü": "u", "Ü": "u", "ş": "s", "Ş": "s",
    "ı": "i", "I": "i", "İ": "i", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c",
    "ä": "a", "Ä": "a", "ß": "ss",
})


def normalize_merchant(name: Optional[str]) -> Optional[str]:
    """Fiş üstündeki market adını karşılaştırılabilir bir anahtara indirger.

    Yalnızca eşleştirme için kullanılır; kullanıcıya gösterilen ad bozulmaz.
    """
    if not name:
        return None
    s = str(name).translate(_FOLD).lower()
    s = s.replace("&", " ").replace(".", ". ")
    s = " ".join(s.split())
    changed = True
    while changed:
        changed = False
        for suf in LEGAL_SUFFIXES:
            if s.endswith(" " + suf):
                s = s[: -len(suf) - 1].strip()
                changed = True
    s = "".join(ch for ch in s if ch.isalnum() or ch.isspace())
    return " ".join(s.split()) or None


def canonical_brand(name: Optional[str]) -> Optional[str]:
    """Ad bilinen bir zincirle başlıyorsa markanın kendi yazımını döndür."""
    key = normalize_merchant(name)
    if not key:
        return None
    for brand in KNOWN_MERCHANTS:
        bk = normalize_merchant(brand)
        if bk and (key == bk or key.startswith(bk + " ")):
            return brand
    return None


def match_known_merchant(name: Optional[str], known: List[str]) -> Optional[str]:
    """Evde daha önce kullanılmış bir markete yeterince benziyorsa onu döndür.

    "Bizim Fleisher GmbH" ile "Bizim Fleischer" tek harf farkıyla aynı yer.
    Yapay zekâya sormuyoruz: bu iş kütüphanesiz, bedava ve her seferinde aynı
    sonucu veriyor — kullanıcı sayısı arttıkça jeton maliyeti de doğurmuyor.
    """
    if not name:
        return None
    key = normalize_merchant(name)
    if not key:
        return None
    best, best_score = None, 0.0
    for k in known:
        other = normalize_merchant(k)
        if not other:
            continue
        if other == key:
            return k
        score = difflib.SequenceMatcher(None, key, other).ratio()
        if score > best_score:
            best, best_score = k, score
    # 0.88: "bizim fleisher" ↔ "bizim fleischer" 0.96 veriyor, "rewe" ↔ "penny"
    # 0.2'de kalıyor. Eşiği düşürmek gerçekten farklı dükkânları birleştirir.
    return best if best_score >= 0.88 else None


async def resolve_merchant(household_id: str, name: Optional[str]) -> Optional[str]:
    """Girilen market adını tek bir yazıma indirger.

    Önce bilinen zincir listesi, sonra evin kendi geçmişi. Sıra önemli: zincir
    listesi kesin bilgi, benzerlik ölçümü tahmin.
    """
    clean = (name or "").strip() or None
    if not clean:
        return None
    brand = canonical_brand(clean)
    if brand:
        return brand
    known = await db.expenses.distinct("merchant", {"household_id": household_id})
    return match_known_merchant(clean, [k for k in known if k]) or clean


# ---------- Fiyat normalleştirme ----------
# Fiyat karşılaştırmasının tamamı BİRİM fiyata dayanır. Fişte ham fiyat var
# ama miktar çoğu zaman ürün adının içinde sıkışmış:
#
#     ZWIEBELN 2KG      1,69   ->  0,85 EUR/kg
#     PAPRIKA ROT 500G  1,59   ->  3,18 EUR/kg
#
# Ham fiyatları toplamak hiçbir işe yaramaz: "soğan 1,69" ile "soğan 1,11"
# karşılaştırılamaz, biri iki kilo diğeri belli değil.

# Çoklu paket önce denenir: "6x0,33L" tek başına "0,33 L" değil 1,98 L.
_MULTI_SIZE_RE = re.compile(
    r"(?<![a-z0-9])(\d+)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*(kg|gr|g|ml|cl|lt|l)(?![a-z])",
    re.IGNORECASE,
)
_SIZE_RE = re.compile(
    r"(?<![a-z0-9])(\d+(?:[.,]\d+)?)\s*(kg|gr|g|ml|cl|lt|l)(?![a-z])",
    re.IGNORECASE,
)
# Her şey kg ve lt'ye indirgeniyor; iki farklı ölçekte seri tutmak
# karşılaştırmayı yine imkânsız kılardı.
_SIZE_FACTORS = {
    "kg": (1.0, "kg"), "g": (0.001, "kg"), "gr": (0.001, "kg"),
    "lt": (1.0, "lt"), "l": (1.0, "lt"), "ml": (0.001, "lt"), "cl": (0.01, "lt"),
}


def parse_size(name: str) -> Optional[tuple]:
    """Ürün adından paket boyutunu ayıkla → (miktar, "kg"|"lt", eşleşen metin).

    Kütüphanesiz ve belirlenimci: aynı ad her zaman aynı sonucu verir ve
    kullanıcı sayısı arttıkça jeton maliyeti doğurmaz — market ismi
    birleştirmede kullanılan yaklaşımın aynısı.
    """
    if not name:
        return None
    for rx, multi in ((_MULTI_SIZE_RE, True), (_SIZE_RE, False)):
        m = rx.search(name)
        if not m:
            continue
        try:
            count = float(m.group(1).replace(",", ".")) if multi else 1.0
            amount = float(m.group(2 if multi else 1).replace(",", "."))
        except ValueError:
            continue
        factor, base = _SIZE_FACTORS[m.group(3 if multi else 2).lower()]
        total = count * amount * factor
        if total <= 0:
            continue
        return round(total, 4), base, m.group(0)
    return None


def product_key(name: str) -> Optional[str]:
    """Ürün adını karşılaştırılabilir bir anahtara indirger.

    Boyut anahtarın DIŞINDA bırakılıyor. İçeri alınsaydı 1 kg'lık file ile
    2 kg'lık file ayrı seriler olur ve az veriyle her ikisi de anlamsız
    kalırdı; boyut ayrı alanda durup birim fiyata dönüşüyor.
    """
    if not name:
        return None
    s = name
    got = parse_size(s)
    if got:
        s = s.replace(got[2], " ")
    s = _fold_german(s).translate(_FOLD)
    s = "".join(ch if ch.isalnum() or ch.isspace() else " " for ch in s)
    return " ".join(s.split()) or None


def price_of_item(item: dict) -> Optional[dict]:
    """Bir fiş kaleminden karşılaştırılabilir birim fiyat çıkar.

    Üç durum var ve ayrımı korumak şart:

    - **açık**: kasada tartılan ürün. Fiş `0,590 kg x 10,99 EUR/kg` yazar,
      yani `price` zaten kilo fiyatıdır.
    - **paketli**: boyut adın içinde. `price` paketin fiyatı, kilo fiyatı
      bölmeyle çıkar. `quantity` sadeleşir — üç paket almak birim fiyatı
      değiştirmez.
    - **adet**: boyutu bilinmeyen sayılabilir ürün. Kilo fiyatı üretilemez,
      adet fiyatı olarak saklanır ve yalnızca kendi sınıfıyla karşılaştırılır.

    Açık ile paketliyi aynı seride toplamak "fiyat iki katına çıktı" gibi
    yanlış uyarılar üretir: değişen fiyat değil ambalajdır.
    """
    name = str(item.get("name") or "").strip()
    key = product_key(name)
    if not key:
        return None
    # Genel ad, markalar arasi karsilastirmanin tek kopru noktasi: "Gelbwurzel"
    # ile "Karotten Bio" ayni urun anahtarina dusmez ama ikisi de "havuc".
    generic = str(item.get("generic") or "").strip().lower() or None
    gkey = product_key(generic) if generic else None
    try:
        price = float(item.get("price") or 0)
    except (TypeError, ValueError):
        return None
    if price <= 0:
        return None

    # Önce kalemin kendi alanı (OCR'ın verdiği), sonra addan ayıklama. Sıra
    # önemli: model fişin tamamını görüyor, ayrıştırıcı yalnızca adı.
    size = None
    try:
        sa, su = item.get("size_amount"), str(item.get("size_unit") or "").lower()
        if sa is not None and su in ("kg", "lt") and float(sa) > 0:
            size = (round(float(sa), 4), su, "")
    except (TypeError, ValueError):
        size = None
    if size is None:
        size = parse_size(name)
    unit = str(item.get("unit") or "").strip().lower()

    if size:
        amount, base, _ = size
        return {"product_key": key, "product": name, "pack_type": "paketli",
                "generic": generic, "generic_key": gkey,
                "size_amount": amount, "size_unit": base,
                "unit_price": round(price / amount, 4), "price_unit": base}
    if unit in ("kg", "lt"):
        return {"product_key": key, "product": name, "pack_type": "acik",
                "generic": generic, "generic_key": gkey,
                "size_amount": None, "size_unit": unit,
                "unit_price": round(price, 4), "price_unit": unit}
    return {"product_key": key, "product": name, "pack_type": "adet",
            "generic": generic, "generic_key": gkey,
            "size_amount": None, "size_unit": "adet",
            "unit_price": round(price, 4), "price_unit": "adet"}


def _iso_week(day: Optional[str]) -> str:
    """"2026-08-15" → "2026-W33". Gün değil hafta kaydediliyor.

    Gün + nadir bir ürün + market üçlüsü tek bir fişe kadar izlenebilir;
    hafta izlenemez. Fiyat eğilimi için hafta zaten yeterli çözünürlük.
    """
    try:
        d = date.fromisoformat((day or "")[:10])
    except ValueError:
        d = now_utc().date()
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


async def record_price_points(expense: dict, household: dict) -> None:
    """Bir harcamanın kalemlerinden anonim fiyat kayıtları üret.

    **Kimlikten yazma anında kopuk.** `household_id`, `user_id`, `expense_id`
    hiç yazılmıyor — sonradan temizlenen değil, hiç var olmayan alanlar. Bu
    ikisi arasındaki fark hem teknik hem hukuki olarak belirleyici: sonradan
    silinen bir alan yedeklerde ve günlüklerde yaşamaya devam eder.

    Ham ürün adı da saklanıyor: yarın daha iyi bir normalleştirici yazılırsa
    anahtarlar yeniden üretilebilsin, veri kaybolmasın.

    **Asla istisna fırlatmaz.** `notify()` ile aynı kural — fiyat kaydının
    tutmaması bir harcamanın kaydedilmesini engellememeli.
    """
    try:
        if expense.get("source") != "receipt" or not expense.get("merchant"):
            return
        merchant = expense["merchant"]
        mkey = normalize_merchant(merchant)
        if not mkey:
            return
        week = _iso_week(expense.get("expense_date"))
        rows = []
        for item in expense.get("items") or []:
            p = price_of_item(item)
            if not p:
                continue
            rows.append({
                "price_id": new_id("prc"),
                "merchant_key": mkey,
                "merchant": merchant,
                "country": household.get("country") or "DE",
                "currency": expense.get("currency") or household.get("currency") or "EUR",
                "week": week,
                "category": item.get("category") or "diger",
                "source": "receipt",
                "created_at": now_utc(),
                **p,
            })
        if rows:
            await db.price_points.insert_many(rows)
    except Exception as exc:      # noqa: BLE001 — bilerek yutuluyor
        logger.warning("fiyat kaydi yazilamadi: %s", exc)


async def _record_revision(before: dict, patch: dict, user: dict, action: str) -> None:
    """Harcamanın eski hâlini sakla. Kayıtlar küçük, geçmiş geri gelmez."""
    changes = {
        k: {"eski": before.get(k), "yeni": patch[k]}
        for k in patch
        if k != "updated_at" and before.get(k) != patch[k]
    }
    if action == "edit" and not changes:
        return
    await db.expense_revisions.insert_one({
        "revision_id": new_id("rev"),
        "expense_id": before["expense_id"],
        "household_id": before["household_id"],
        "period_id": before.get("period_id"),
        "action": action,
        "by": user["user_id"],
        "by_name": user.get("name"),
        "changes": changes,
        # Silmede eski hâlin tamamı lazım: kayıt gitti, geriye yalnızca bu kalıyor.
        "snapshot": before if action == "delete" else None,
        "created_at": now_utc(),
    })


async def _notify_expense_change(before: dict, patch: dict, user: dict, action: str) -> None:
    """Tutarı ya da kime ait olduğunu değiştiren düzenlemeyi ilgililere duyur."""
    if action == "edit" and not any(
        k in patch and patch[k] != before.get(k) for k in MATERIAL_FIELDS
    ):
        return

    hh = await db.households.find_one({"household_id": before["household_id"]}, {"_id": 0})
    if not hh:
        return

    after = {**before, **patch}
    # Kişisel harcama kimseyi ilgilendirmez — ne eski ne yeni hâlinde.
    was = set() if before.get("target_type") == "self" else set(
        expense_shares(before, hh["member_ids"]))
    now = set() if after.get("target_type") == "self" else set(
        expense_shares(after, hh["member_ids"]))
    me = user["user_id"]

    label = before.get("merchant") or before.get("category") or "Harcama"
    total = patch.get("total", before.get("total", 0))
    tutar_txt = money_str(total, hh)
    data = {"expense_id": before["expense_id"],
            "ay": (patch.get("expense_date") or before.get("expense_date") or "")[:7] or None}

    if action == "delete":
        await notify(
            [a for a in was if a != me],
            "Harcama silindi",
            f"{user['name']} · {label} · {tutar_txt} kaydını sildi",
            "expense_edit", data,
        )
        return

    # Üç ayrı kitle, üç ayrı cümle. Hepsine "harcama güncellendi" demek en
    # önemli iki durumu gizler: bölüşüme yeni giren kişinin borcu arttı,
    # çıkarılanınki düştü. Bunu ancak kendisi ekrana bakıp fark ederse
    # öğrenirdi — ve "artık 90 €" mesajı ikisine de yanlış okunuyordu.
    for people, title, msg in (
        ([a for a in now - was if a != me], "Bir harcamaya eklendin",
         f"{user['name']} · {label} · {tutar_txt} · artık sen de bölüşüyorsun"),
        ([a for a in was - now if a != me], "Bir harcamadan çıkarıldın",
         f"{user['name']} · {label} · {tutar_txt} · bu harcamada payın kalmadı"),
        ([a for a in now & was if a != me], "Harcama güncellendi",
         f"{user['name']} · {label} · artık {tutar_txt}"),
    ):
        if people:
            await notify(people, title, msg, "expense_edit", data)


@api.patch("/expenses/{expense_id}")
async def update_expense(expense_id: str, body: ExpenseUpdate, user=Depends(get_current_user)):
    doc = await _get_editable_expense(expense_id, user)
    hh = await get_user_household(user["user_id"])
    if not hh:
        raise HTTPException(status_code=400, detail="Ev bulunamadı")

    patch: dict = {}
    if body.target_type == "roommate":
        target_user = body.target_user_id if body.target_user_id is not None else doc.get("target_user_id")
        if not target_user or target_user not in hh["member_ids"]:
            raise HTTPException(status_code=400, detail="Geçersiz oda arkadaşı")
        if target_user == user["user_id"]:
            raise HTTPException(status_code=400, detail="Kendinize atayamazsınız")

    # Tutar bölüşmeden önce çözülüyor: eşit bölüşmede paylar tutarın kendisinden,
    # kişiye özel bölüşmede ise doğrulama yeni tutara karşı yapılıyor.
    new_total = round(body.total, 2) if body.total is not None else float(doc["total"])
    if body.total is not None and body.total <= 0:
        raise HTTPException(status_code=400, detail="Tutar sıfırdan büyük olmalı")

    touches_split = (
        body.split_with is not None or body.target_type is not None
        or body.target_user_id is not None or body.total is not None
    )
    if touches_split:
        split_mode, split_with = resolve_split(
            body, doc["added_by"], new_total, hh["member_ids"], fallback=doc
        )
        target_type = derive_target_type(doc["added_by"], split_with, hh["member_ids"])
        patch["split_mode"] = split_mode
        patch["split_with"] = split_with
        patch["target_type"] = target_type
        patch["target_user_id"] = next(iter(split_with)) if target_type == "roommate" else None

    if body.items is not None:
        patch["items"] = [i.model_dump() for i in body.items]
    if body.total is not None:
        patch["total"] = new_total
    if body.merchant is not None:
        # Düzenleme yolunda da çalışması şart: yalnızca kayıtta normalleştirseydik
        # aynı adı elle yazan kullanıcı yine ayrı bir market yaratırdı.
        patch["merchant"] = await resolve_merchant(hh["household_id"], body.merchant)
    if body.category is not None:
        patch["category"] = body.category.strip() or None
    if body.notes is not None:
        patch["notes"] = body.notes.strip() or None
    if body.expense_date is not None:
        parsed = parse_date(body.expense_date)
        if not parsed:
            raise HTTPException(status_code=400, detail="Tarih formatı geçersiz")
        patch["expense_date"] = parsed

    if patch:
        patch["updated_at"] = now_utc()
        await db.expenses.update_one({"expense_id": expense_id}, {"$set": patch})
        await _record_revision(doc, patch, user, "edit")
        await _notify_expense_change(doc, patch, user, "edit")
    updated = await db.expenses.find_one({"expense_id": expense_id}, {"_id": 0})
    return {"expense": updated}


@api.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, user=Depends(get_current_user)):
    doc = await _get_editable_expense(expense_id, user)
    await db.expenses.delete_one({"expense_id": expense_id})
    await _record_revision(doc, {}, user, "delete")
    await _notify_expense_change(doc, {}, user, "delete")
    return {"ok": True}


@api.get("/expenses/duplicate-check")
async def duplicate_check(
    total: float,
    expense_date: Optional[str] = None,
    merchant: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Bu fiş zaten kayıtlı mı?

    Dosya karşılaştırması işe yaramıyor: aynı fişi iki kez çeken kişi iki
    farklı fotoğraf üretir. Fişin kendisine bakmak gerekiyor.

    Ölçüt TUTAR DEĞİL, market + tarih. Sebebi şu: taslağın toplamı kalemlerin
    toplamı, ve OCR aynı fişin iki fotoğrafından farklı kalem listesi
    çıkarabiliyor — indirim satırını bir seferinde ayrı kalem yapıp öbüründe
    ürüne işleyince toplam birkaç kuruş kayıyor ve tam eşleşme kaçıyordu.
    Aynı gün aynı marketten alışveriş zaten seyrek; tutarı kullanıcıya
    gösterip kararı ona bırakmak, sessizce kaçırmaktan iyi.

    Engellemiyor, uyarıyor: aynı gün aynı marketten iki alışveriş olabilir.
    """
    hh = await get_user_household(user["user_id"])
    if not hh:
        return {"duplicates": []}
    day = parse_date(expense_date) if expense_date else None
    q: dict = {"household_id": hh["household_id"]}
    if day:
        q["expense_date"] = day
    rows = await db.expenses.find(q, {"_id": 0}).sort("created_at", -1).to_list(100)

    if merchant and merchant.strip():
        # Kayıtlı adlar zaten tek yazıma indirgenmiş; sorguyu da aynı yoldan
        # geçirmezsek "Bizim Fleisher GmbH" ile "Bizim Fleischer" eşleşmiyordu.
        key = normalize_merchant(await resolve_merchant(hh["household_id"], merchant))
        rows = [r for r in rows if normalize_merchant(r.get("merchant")) == key]
    else:
        # Market yoksa elimizde yalnızca tarih kalıyor; o tek başına çok geniş.
        # Tutara geri dönüyoruz ama gevşek bir payla.
        rows = [r for r in rows if abs(float(r.get("total", 0)) - total) <= 0.5]

    return {"duplicates": rows[:5]}


@api.get("/expenses/{expense_id}/revisions")
async def expense_revisions(expense_id: str, user=Depends(get_current_user)):
    """Bir harcamanın düzenleme geçmişi.

    Ev harcamasını yalnızca ekleyen kişi değiştirebiliyor; herkesin payını
    etkileyen bir tutar sessizce büyümesin diye kim neyi ne zaman değiştirdi
    kayıtta duruyor.
    """
    hh = await get_user_household(user["user_id"])
    if not hh:
        raise HTTPException(status_code=404, detail="Ev bulunamadı")
    rows = await db.expense_revisions.find(
        {"expense_id": expense_id, "household_id": hh["household_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return {"revisions": rows}


# ---------- Shopping list ----------
# Two scopes, mirroring how expenses already work so there is nothing new to
# learn: "household" is shared with everyone in the house, "self" is private
# to whoever wrote it and never leaves their own list.
def _shopping_filter(user_id: str, household_id: Optional[str], scope: Optional[str]) -> dict:
    visible = [{"scope": "self", "added_by": user_id}]
    if household_id:
        visible.append({"scope": "household", "household_id": household_id})
    q: dict = {"$or": visible}
    if scope == "self":
        q = {"scope": "self", "added_by": user_id}
    elif scope == "household":
        if not household_id:
            return {"_id": None}  # no household -> nothing to show
        q = {"scope": "household", "household_id": household_id}
    return q


@api.get("/shopping")
async def list_shopping(scope: Optional[str] = None, user=Depends(get_current_user)):
    hh = await get_user_household(user["user_id"])
    hh_id = hh["household_id"] if hh else None
    q = _shopping_filter(user["user_id"], hh_id, scope)
    items = await db.shopping_items.find(q, {"_id": 0}).to_list(500)
    # Outstanding first, then newest — the point of the screen is what is
    # still missing, not a history of what was bought.
    items.sort(key=lambda i: (bool(i.get("done")), -(i.get("created_at").timestamp() if i.get("created_at") else 0)))
    return {"items": items}


@api.post("/shopping")
async def add_shopping(body: ShoppingItemCreate, user=Depends(get_current_user)):
    hh = await get_user_household(user["user_id"])
    if body.scope == "household" and not hh:
        raise HTTPException(status_code=400, detail="Önce bir eve katılın")

    doc = {
        "item_id": new_id("itm"),
        "household_id": hh["household_id"] if hh else None,
        "scope": body.scope,
        "text": body.text.strip(),
        "note": (body.note or "").strip() or None,
        "added_by": user["user_id"],
        "done": False,
        "done_by": None,
        "done_at": None,
        "created_at": now_utc(),
    }
    await db.shopping_items.insert_one(doc.copy())
    return {"item": doc}


class ShoppingMatchReq(BaseModel):
    """Fişten çıkan kalem adları ve fişin tarihi."""
    names: List[str] = Field(default_factory=list)
    # Fişin ÜSTÜNDEKİ tarih (YYYY-MM-DD), kaydedildiği an değil.
    expense_date: Optional[str] = None


@api.post("/shopping/match")
async def match_shopping(body: ShoppingMatchReq, user=Depends(get_current_user)):
    """Fişteki kalemleri BEKLEYEN alınacaklar listesiyle eşleştirir.

    Bu uç yalnızca **önerir**; hiçbir şeyi işaretlemez. Liste paylaşılan bir
    şey — ev arkadaşının yazdığı maddeyi haber vermeden silmek, uygulamanın
    en çok güven kaybedeceği yer olurdu. İşaretleme kullanıcının onayıyla,
    var olan `PATCH /shopping/{id}` üzerinden yapılıyor.

    Eşleştirme Tur 8'in **genel ürün adı** işinin üstüne kuruluyor: fişte
    `SAHNE 200G` yazıyor, listede `Krema`; ikisi de `product_key` ile aynı
    anahtara düşüyor. Bu, rakiplerin yapamadığı bir şey çünkü hiçbiri fişi
    kalem kalem okumuyor.

    İki güven seviyesi dönüyor:
      * `sure=True`  — anahtarlar birebir aynı; kutu işaretli gelir
      * `sure=False` — biri ötekini içeriyor (ör. "süt" ⊂ "tam yağlı süt");
        kutu BOŞ gelir. Yanlış düşürmek, düşürmemekten pahalı.
    """
    hh = await get_user_household(user["user_id"])
    if not hh:
        return {"matches": []}

    bekleyen = await db.shopping_items.find(
        {"household_id": hh["household_id"], "scope": "household", "done": False},
        {"_id": 0, "item_id": 1, "text": 1, "created_at": 1},
    ).to_list(500)
    if not bekleyen:
        return {"matches": []}

    # TARİH SÜZGECİ — fiş maddeden ESKİYSE eşleştirme yok.
    #
    # Somut belirti: bir hafta önceki fişi bugün taratıyorsun ve dün listeye
    # yazılmış "Süt" işaretlenmeye aday çıkıyor. O sütü almadın; madde daha
    # ortada yokken kesilmiş bir fişle karşılanamaz.
    #
    # Aynı gün ELENMİYOR (`<`, `<=` değil): sabah "Süt" yazılıp öğlen alınan
    # süt en sık senaryo. Saat karşılaştırması da yapılmıyor — fişin üstünde
    # saat yok, yalnızca gün var.
    fis_gun = parse_date(body.expense_date) if body.expense_date else None
    if fis_gun:
        bekleyen = [
            it for it in bekleyen
            if not it.get("created_at")
            or make_aware(it["created_at"]).date().isoformat() <= fis_gun
        ]
        if not bekleyen:
            return {"matches": []}

    fis = []
    for ham in body.names:
        ad = str(ham or "").strip()
        if not ad:
            continue
        fis.append((ad, product_key(ad) or ad.casefold()))

    kullanilan: set = set()
    out = []
    for it in bekleyen:
        anahtar = product_key(it["text"]) or it["text"].casefold()
        if not anahtar:
            continue
        for ad, fanahtar in fis:
            if ad in kullanilan or not fanahtar:
                continue
            if fanahtar == anahtar:
                out.append({"item_id": it["item_id"], "text": it["text"],
                            "receipt_name": ad, "sure": True})
                kullanilan.add(ad)
                break
            # Iceren eslesme: "sut" ile "tam yagli sut".
            #
            # TAM KELIME araniyor, alt dize degil. Alt dize olsaydi "yag"
            # "yagli kagit"a eslesirdi; kelime sinirinda aranınca eslesmiyor.
            # Uc harf esigi de gerekli: "su" tek basina her seye eslesir.
            kisa, uzun = sorted((anahtar, fanahtar), key=len)
            if len(kisa) >= 3 and kisa in uzun.split():
                out.append({"item_id": it["item_id"], "text": it["text"],
                            "receipt_name": ad, "sure": False})
                kullanilan.add(ad)
                break
    return {"matches": out}


async def _get_writable_item(item_id: str, user: dict) -> dict:
    item = await db.shopping_items.find_one({"item_id": item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
    if item["scope"] == "self":
        if item["added_by"] != user["user_id"]:
            raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
    else:
        hh = await get_user_household(user["user_id"])
        if not hh or hh["household_id"] != item.get("household_id"):
            raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
    return item


@api.patch("/shopping/{item_id}")
async def update_shopping(item_id: str, body: ShoppingItemUpdate, user=Depends(get_current_user)):
    item = await _get_writable_item(item_id, user)
    patch: dict = {}
    if body.text is not None and body.text.strip():
        patch["text"] = body.text.strip()
    if body.note is not None:
        patch["note"] = body.note.strip() or None
    if body.done is not None:
        patch["done"] = bool(body.done)
        patch["done_by"] = user["user_id"] if body.done else None
        patch["done_at"] = now_utc() if body.done else None
    if patch:
        await db.shopping_items.update_one({"item_id": item_id}, {"$set": patch})
    updated = await db.shopping_items.find_one({"item_id": item_id}, {"_id": 0})
    return {"item": updated}


@api.delete("/shopping/{item_id}")
async def delete_shopping(item_id: str, user=Depends(get_current_user)):
    await _get_writable_item(item_id, user)
    await db.shopping_items.delete_one({"item_id": item_id})
    return {"ok": True}


@api.post("/shopping/clear-done")
async def clear_done_shopping(scope: str = "household", user=Depends(get_current_user)):
    """Sweep the ticked-off items away in one go."""
    hh = await get_user_household(user["user_id"])
    if scope == "self":
        q = {"scope": "self", "added_by": user["user_id"], "done": True}
    else:
        if not hh:
            return {"deleted": 0}
        q = {"scope": "household", "household_id": hh["household_id"], "done": True}
    res = await db.shopping_items.delete_many(q)
    return {"deleted": res.deleted_count}


# ---------- Settlements ----------
# Marking a payment records that money actually changed hands. It feeds the
# balance maths exactly like a roommate expense in reverse: paying off what
# you owe moves your net back towards zero. Without this, "Dönemi Kapat" is
# all-or-nothing — it assumes everyone squared up at the same moment.
@api.get("/settlements")
async def list_settlements(
    period_id: Optional[str] = None,
    all_periods: bool = False,
    user=Depends(get_current_user),
):
    """Ödeme kayıtları. Varsayılan: açık dönem. `all_periods=true`: hepsi.

    Ödeme geçmişinin dönemleri **aşması gerekiyor**: son ödeme dönemi
    kendiliğinden kapatıyor, yani ödeşen bir ev varsayılan görünümde tam da
    ilgilendiği anda **boş liste** görüyordu. Kayıtlar bir önceki, artık
    kapanmış dönemde kalıyor.
    """
    hh = await get_user_household(user["user_id"])
    if not hh:
        return {"settlements": []}
    q: dict = {"household_id": hh["household_id"]}
    if period_id:
        q["period_id"] = period_id
    elif not all_periods:
        active = await get_active_period(hh["household_id"])
        if not active:
            return {"settlements": []}
        q["period_id"] = active["period_id"]
    rows = await db.settlements.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"settlements": rows}


@api.post("/settlements")
async def create_settlement(body: SettlementCreate, user=Depends(get_current_user)):
    hh = await get_user_household(user["user_id"])
    if not hh:
        raise HTTPException(status_code=400, detail="Ev bulunamadı")
    period = await get_active_period(hh["household_id"])
    if not period:
        raise HTTPException(status_code=400, detail="Aktif dönem bulunamadı")

    members = hh["member_ids"]
    if body.from_user_id not in members or body.to_user_id not in members:
        raise HTTPException(status_code=400, detail="Geçersiz üye")
    if body.from_user_id == body.to_user_id:
        raise HTTPException(status_code=400, detail="Ödeme aynı kişiye olamaz")
    # Either side may record it — the payer knows they sent it, the receiver
    # knows it arrived. A bystander marking other people's debts settled is
    # not something anyone asked for.
    if user["user_id"] not in (body.from_user_id, body.to_user_id):
        raise HTTPException(status_code=403, detail="Sadece ödemenin taraflarından biri işaretleyebilir")

    doc = {
        "settlement_id": new_id("stl"),
        "household_id": hh["household_id"],
        "period_id": period["period_id"],
        "from_user_id": body.from_user_id,
        "to_user_id": body.to_user_id,
        "amount": round(body.amount, 2),
        "note": (body.note or "").strip() or None,
        "recorded_by": user["user_id"],
        "created_at": now_utc(),
    }
    await db.settlements.insert_one(doc.copy())

    other = body.to_user_id if user["user_id"] == body.from_user_id else body.from_user_id
    await notify(
        [other],
        "Ödeme kaydedildi",
        f"{user['name']} {money_str(doc['amount'], hh)} tutarında bir ödeme işaretledi.",
        "settlement",
        {"settlement_id": doc["settlement_id"]},
    )
    # Bu ödemeyle herkes ödeştiyse dönem kendiliğinden kapanır.
    #
    # Yalnızca BURADA çağrılıyor, harcama silme/düzenleme sonrasında değil:
    # çizgi "ödeştiniz" demek ve ödeşmek bir ödemenin gerçekleşmesidir. Son
    # borcu bir harcamayı silerek sıfırlamak ödeşmek değil, düzeltmedir.
    await _odesme_cizgisi(hh["household_id"])
    return {"settlement": doc}


@api.post("/settlements/all")
async def settle_all(user=Depends(get_current_user)):
    """"Ödeştik" — önerilen transferlerin hepsini tek hamlede kaydeder.

    Eski "Dönemi kapat" düğmesinin yerini alıyor ama işi tam tersi: o
    bakiyeleri **siliyordu**, bu **kaydediyor.** Nakit ödeşen bir ev için
    tek jest, ve defterde kimin kime ne ödediği yazılı kalıyor.

    Neden gerekli: ödeşme kaydını yalnızca tarafları girebiliyor, yani
    kapanma herkesin tek tek uygulamayı açmasına bağlı kalıyordu. Üç kişilik
    bu evde bugüne kadar **hiç ödeme işaretlenmemişti** (yedekte
    `settlements` sıfır kayıt) — yani o kapanma hiçbir zaman gerçekleşmezdi.

    Neden yönetici: ev adına yapılan bir beyan. Herkese bildirim gider,
    kimsenin haberi olmadan defter kapanmaz.

    Geri alınabilir: kaydedilen ödemelerden sonuncusunu silmek dönemi de
    geri açar (bkz. `DELETE /settlements/{id}`).
    """
    hh = await require_admin(user["user_id"])
    period = await get_active_period(hh["household_id"])
    if not period:
        raise HTTPException(status_code=400, detail="Aktif dönem yok")

    snap = await _compute_balances(hh["household_id"], period["period_id"])
    transfers = snap.get("transfers") or []
    if not transfers:
        raise HTTPException(status_code=400, detail="Ödeşilecek borç yok")

    simdi = now_utc()
    docs = [{
        "settlement_id": new_id("stl"),
        "household_id": hh["household_id"],
        "period_id": period["period_id"],
        "from_user_id": t["from"],
        "to_user_id": t["to"],
        "amount": round(float(t["amount"]), 2),
        "note": "Ödeştik",
        "recorded_by": user["user_id"],
        "toplu": True,
        "created_at": simdi,
    } for t in transfers]
    await db.settlements.insert_many([d.copy() for d in docs])

    await notify(
        [m for m in hh["member_ids"] if m != user["user_id"]],
        "Ev ödeşti",
        f"{user['name']} \"ödeştik\" dedi; {len(docs)} ödeme kaydedildi.",
        "settlement",
        {"household_id": hh["household_id"]},
    )
    # Bildirimi yukarıda kendimiz gönderdik; çizgi sessiz çizilsin.
    await _odesme_cizgisi(hh["household_id"], bildir=False)
    return {"settlements": docs, "count": len(docs)}


@api.delete("/settlements/{settlement_id}")
async def delete_settlement(settlement_id: str, user=Depends(get_current_user)):
    row = await db.settlements.find_one({"settlement_id": settlement_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
    hh = await get_user_household(user["user_id"])
    if not hh or hh["household_id"] != row["household_id"]:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
    if user["user_id"] not in (row["from_user_id"], row["to_user_id"]):
        raise HTTPException(status_code=403, detail="Sadece ödemenin taraflarından biri kaldırabilir")

    period = await db.periods.find_one({"period_id": row["period_id"]}, {"_id": 0})
    if period and period.get("status") == "closed":
        # Son ödeme dönemi KENDİLİĞİNDEN kapatmış olabilir (bkz.
        # `_odesme_cizgisi`). O ödemeyi geri almak, tetiklediği kapanmayı da
        # geri almalı — yoksa yanlış kaydedilmiş bir son ödeme hiçbir zaman
        # düzeltilemezdi. Geri alma ödeşme akışının bilinçli bir parçası.
        #
        # Yalnızca EN SON kapanan dönem ve yalnızca sonrasına hiç harcama
        # girilmemişse: daha eskisini açmak aradaki dönemleri sırasız bırakır.
        son = await db.periods.find(
            {"household_id": row["household_id"], "status": "closed"},
            {"_id": 0, "period_id": 1},
        ).sort("closed_at", -1).to_list(1)
        uygun = bool(son) and son[0]["period_id"] == row["period_id"]
        geri = await _donemi_geri_ac(row["household_id"]) if uygun else None
        if not geri:
            raise HTTPException(
                status_code=400,
                detail="Bu ödeme sonrasında yeni kayıtlar oluştu; geri alınamaz.",
            )

    await db.settlements.delete_one({"settlement_id": settlement_id})

    # Geri alma SESSIZ olamaz. Kayit olusturmak surpriz degil -- borcun zaten
    # oradaydi. Ama odenmis sanilan bir borcun geri gelmesi surpriz: karsi
    # tarafin bakiyesi habersiz artiyor ve bunu ancak ekrana bakarsa gorur.
    # Bildirimi hak eden iki olaydan asil bu.
    other = row["to_user_id"] if user["user_id"] == row["from_user_id"] else row["from_user_id"]
    await notify(
        [other],
        "Ödeme kaydı geri alındı",
        f"{user['name']} {money_str(row['amount'], hh)} tutarındaki ödeme kaydını kaldırdı; "
        "borç yeniden görünüyor.",
        "settlement",
        {"settlement_id": settlement_id},
    )
    return {"ok": True}


# ---------- Balances (Debt Simplification) ----------
def simplify_debts(net: Dict[str, float]) -> List[dict]:
    creditors = [(u, round(a, 2)) for u, a in net.items() if a > 0.01]
    debtors = [(u, round(-a, 2)) for u, a in net.items() if a < -0.01]
    creditors.sort(key=lambda x: -x[1])
    debtors.sort(key=lambda x: -x[1])
    ci = di = 0
    transfers: List[dict] = []
    while ci < len(creditors) and di < len(debtors):
        cu, ca = creditors[ci]
        du, da = debtors[di]
        pay = round(min(ca, da), 2)
        if pay > 0.01:
            transfers.append({"from": du, "to": cu, "amount": pay})
        ca -= pay
        da -= pay
        creditors[ci] = (cu, ca)
        debtors[di] = (du, da)
        if ca < 0.01:
            ci += 1
        if da < 0.01:
            di += 1
    return transfers


async def period_participants(household_id: str, period_id: str, member_ids: List[str]) -> List[str]:
    """Who this period's expenses are split between.

    A closed period carries its own frozen list (`participant_ids`) and that
    list wins. Without it the answer was computed from the household's *current*
    members, so somebody joining today changed the split of a period closed
    months ago — their share appeared retroactively in settled books.

    While a period is open the list is still derived, so that members joining
    or leaving mid-period are picked up without a write on every membership
    change. Anyone who actually took part is always included: a member who has
    since been removed still belongs in the maths for the periods they lived
    through.
    """
    period = await db.periods.find_one(
        {"period_id": period_id}, {"_id": 0, "participant_ids": 1, "status": 1}
    )
    if period and period.get("status") == "closed" and period.get("participant_ids"):
        return list(period["participant_ids"])

    # Açık dönemde liste yapışkan: dönem boyunca üye olmuş herkes içeride kalır.
    # Hiç harcama yapmamış, kimseye hedef olmamış, hiç ödeşmemiş bir üye evden
    # çıkarılınca aşağıdaki türetme onu bulamıyordu ve payı kalanlara dağılıyordu.
    sticky = list((period or {}).get("participant_ids") or [])

    rows = await db.expenses.find(
        {"household_id": household_id, "period_id": period_id},
        {"_id": 0, "added_by": 1, "target_user_id": 1, "split_with": 1},
    ).to_list(5000)
    extra = set()
    for r in rows:
        extra.add(r["added_by"])
        if r.get("target_user_id"):
            extra.add(r["target_user_id"])
        # Bölüşme listesindekiler de katılımcıdır. Evden çıkarılmış biri hâlâ
        # bir harcamanın listesinde olabilir; payı o kayda yazılı olduğu için
        # hesaba katılmazsa harcamanın toplamı bölüşülenden büyük kalırdı.
        extra.update((r.get("split_with") or {}).keys())
    # Someone can settle up and only then be removed from the household; their
    # payment still has to count in that period's maths.
    for s in await db.settlements.find(
        {"household_id": household_id, "period_id": period_id},
        {"_id": 0, "from_user_id": 1, "to_user_id": 1},
    ).to_list(1000):
        extra.add(s["from_user_id"])
        extra.add(s["to_user_id"])

    out = list(member_ids)
    for u in sticky + sorted(extra):
        if u not in out:
            out.append(u)
    return out


async def _compute_balances(household_id: str, period_id: str) -> dict:
    hh = await db.households.find_one({"household_id": household_id}, {"_id": 0})
    if not hh:
        return {"net": {}, "transfers": [], "totals_paid": {}}
    members = await period_participants(household_id, period_id, hh["member_ids"])
    net: Dict[str, float] = {m: 0.0 for m in members}
    totals_paid: Dict[str, float] = {m: 0.0 for m in members}
    roommate_paid: Dict[str, float] = {m: 0.0 for m in members}

    # Kişisel harcamalar dışında hepsi geliyor. Süzgeç `target_type` değil
    # etiket üzerinden: bölüşme listesi artık tek doğru kaynak ve "custom"
    # gibi yeni etiketler sorguya eklenmeyi unutulacak bir yer bırakmamalı.
    exps = await db.expenses.find(
        {"household_id": household_id, "period_id": period_id},
        {"_id": 0},
    ).to_list(5000)

    for e in exps:
        payer = e["added_by"]
        total = float(e["total"])
        shares = expense_shares(e, members)
        if not shares:
            continue
        # Kişisel harcama dengeye hiç girmez. Ödeyenin kendi payı zaten tutarın
        # tamamı — net etkisi sıfır — ama "ödenen toplam" gibi göstergelerde de
        # görünmemeli: kimseyi ilgilendirmiyor.
        if set(shares) == {payer} and e.get("target_type") == "self":
            continue
        # Ödeyen listede yoksa harcamanın tamamı başkaları için yapılmış demek.
        if payer in shares:
            totals_paid[payer] = totals_paid.get(payer, 0) + total
        else:
            roommate_paid[payer] = roommate_paid.get(payer, 0) + total
        net[payer] = net.get(payer, 0) + total
        for m, amount in shares.items():
            net[m] = net.get(m, 0) - amount

    # Recorded payments move the payer back towards zero and the receiver away
    # from it — the exact inverse of a roommate expense. Applied after the
    # expenses so the suggested transfers only cover what is still outstanding.
    settlements = await db.settlements.find(
        {"household_id": household_id, "period_id": period_id}, {"_id": 0}
    ).to_list(1000)
    settled_paid: Dict[str, float] = {m: 0.0 for m in members}
    for s in settlements:
        payer, receiver, amount = s["from_user_id"], s["to_user_id"], float(s["amount"])
        if payer not in net or receiver not in net:
            continue
        net[payer] = net.get(payer, 0) + amount
        net[receiver] = net.get(receiver, 0) - amount
        settled_paid[payer] = settled_paid.get(payer, 0) + amount

    net = {k: round(v, 2) for k, v in net.items()}
    totals_paid = {k: round(v, 2) for k, v in totals_paid.items()}
    roommate_paid = {k: round(v, 2) for k, v in roommate_paid.items()}
    settled_paid = {k: round(v, 2) for k, v in settled_paid.items()}
    transfers = simplify_debts(dict(net))
    return {
        "net": net, "transfers": transfers, "totals_paid": totals_paid,
        "roommate_paid": roommate_paid, "settled_paid": settled_paid,
        "settlements": settlements,
    }


async def _ekstre(household_id: str, period_id: str, user_id: str,
                  members: List[str], member_ids: List[str], bugun: date) -> dict:
    """Bir kişinin bakiyesinin AY AY dökümü.

    Kasa'nın ekstre bloğu ile borç dökümü sayfası **aynı hesaptan** besleniyor;
    iki ekran iki farklı sayı gösteremesin.

    Dayandığı kimlik uygulamanın omurgası (DEVAM.md):

        ödediğin − sana düşen = bakiyen

    Her ay için ikisi ayrı toplanıyor; farkı o ayda bakiyenin ne kadar
    değiştiği. Toplamları bugünkü bakiyeyi verir, yani **FIFO gerekmiyor** —
    hangi ödemenin hangi ayın borcuna gittiğini bilmeye ihtiyaç yok.

    **Dil önemli:** "Haziran'dan kalan 48 €" bir kurgudur, hangi euro'nun
    kaldığı bilinemez. "Haziran'da 48 € borçlandın" bir olgudur.

    `share` = sana düşen (borcu artıran) · `paid` = cebinden çıkan (azaltan).
    Etiketler yöne göre ekranda konuluyor: borçluda "ödediklerin", alacaklıda
    "senin payın".
    """
    aylar: Dict[str, dict] = {}

    # Hareket türleri — "bu para nereye gitti" sorusunun cevabı.
    #
    # İki sütun ("sana düşen" / "ödediklerin") yetmiyordu: "ödediklerin"
    # içinde birbirinden çok farklı üç şey vardı — ev alışverişlerinde
    # fatura ödediklerin, bir başkası İÇİN aldıkların, ve kaydettiğin
    # ödemeler. Tek satırda toplanınca "beni kim sübvanse etti, ben kimi
    # sübvanse ettim" görünmez oluyordu.
    #
    # İşaret kuralı tek: **artı borcunu artırır, eksi azaltır.**
    TURLER = ("ev_pay", "bana_pay", "baskasi_pay",
              "ev_odedigin", "baskasi_odedigin",
              "odemelerin", "sana_odenen")

    def kutu(ay: str) -> dict:
        return aylar.setdefault(ay, {
            "month": ay, "share": 0.0, "paid": 0.0,
            **{t: 0.0 for t in TURLER},
        })

    exps = await db.expenses.find(
        {"household_id": household_id, "period_id": period_id}, {"_id": 0}
    ).to_list(5000)
    for e in exps:
        shares = expense_shares(e, members)
        # Hangi satıra ne yazılacağını `akis_paylari` söylüyor; `/expenses?akis=`
        # de aynı fonksiyonu okuyor, yani ekstredeki satır ile o satıra
        # dokununca açılan fiş listesi aynı tanımdan geliyor.
        paylar = akis_paylari(e, shares, user_id, member_ids)
        if not paylar:
            continue
        k = kutu(_expense_day(e)[:7])
        if e["added_by"] == user_id:
            k["paid"] += float(e["total"])
        k["share"] += float(shares.get(user_id, 0.0))
        for tur, tutar in paylar.items():
            k[tur] += tutar

    # Ödemeler KAYIT tarihine göre aylanıyor: harcamanın tarihi geçmişe ait
    # olabilir ama ödeme gerçekleştiği anda gerçekleşir.
    for s in await db.settlements.find(
        {"household_id": household_id, "period_id": period_id}, {"_id": 0}
    ).to_list(1000):
        k = kutu(make_aware(s["created_at"]).date().isoformat()[:7])
        if s["from_user_id"] == user_id:
            k["paid"] += float(s["amount"])
            k["odemelerin"] += float(s["amount"])
        elif s["to_user_id"] == user_id:
            k["share"] += float(s["amount"])
            k["sana_odenen"] += float(s["amount"])

    sirali = sorted(aylar.values(), key=lambda x: x["month"])
    for k in sirali:
        k["share"] = round(k["share"], 2)
        k["paid"] = round(k["paid"], 2)
        k["delta"] = round(k["share"] - k["paid"], 2)
        # Sıfır olan tür hiç yazılmıyor: her ay aynı şeyi söyleyen satır
        # listeyi doldurup asıl değişeni gizler.
        k["lines"] = [
            {"tur": t, "tutar": round(k[t], 2),
             # Borcu ARTIRAN mı azaltan mı — ekranda işaret ve renk bundan.
             "artiran": t in ("ev_pay", "bana_pay", "baskasi_pay", "sana_odenen")}
            for t in TURLER if abs(k[t]) >= 0.005
        ]
        for t in TURLER:
            k.pop(t, None)

    bu_ay = month_key(bugun)
    return {
        # Değişimi sıfır olan ay hiç görünmüyor: her ay aynı şeyi söyleyen
        # satır listeyi doldurup asıl değişeni gizler.
        "months": [k for k in sirali if abs(k["delta"]) >= 0.005],
        # Ekstre bloğundaki tek satırlık devir: bu aydan öncekilerin toplamı.
        "carried": round(sum(k["delta"] for k in sirali if k["month"] < bu_ay), 2),
        "current_month": bu_ay,
    }


@api.get("/balances")
async def balances(period_id: Optional[str] = None, user=Depends(get_current_user)):
    hh = await get_user_household(user["user_id"])
    if not hh:
        return {"net": {}, "transfers": [], "totals_paid": {}, "members": []}
    if period_id:
        period = await db.periods.find_one({"period_id": period_id, "household_id": hh["household_id"]}, {"_id": 0})
    else:
        period = await get_active_period(hh["household_id"])
    if not period:
        return {"net": {}, "transfers": [], "totals_paid": {}, "members": []}

    # Kapalı dönem kapanışta ne yazdıysa onu gösterir, yeniden hesaplanmaz.
    # Anlık görüntü kapanışta zaten alınıyordu ama hiç okunmuyordu; her açılışta
    # baştan hesaplanınca bugünkü üye listesi geçmişi değiştirebiliyordu.
    # Kapalı dönemde harcama ve ödeme kaydı zaten değiştirilemiyor, yani
    # kayıtlı görüntü ile veri her zaman tutarlı.
    snap = period.get("final_balances") if period.get("status") == "closed" else None
    # dict(...) şart: `snap` doğrudan `period` içindeki alt sözlük. Kopyalamadan
    # kullanırsak aşağıdaki `result["period"] = period` kendine dönen bir halka
    # kurar ve yanıt JSON'a çevrilirken sonsuz özyinelemeye giriyor.
    result = dict(snap) if snap else await _compute_balances(hh["household_id"], period["period_id"])
    # Include former members who took part in this period, so archived views
    # show their name instead of an unresolved id.
    participants = await period_participants(
        hh["household_id"], period["period_id"], hh["member_ids"]
    )
    members = await db.users.find(
        {"user_id": {"$in": participants}}, PUBLIC_USER_PROJECTION
    ).to_list(50)
    # AYRILANLAR işaretleniyor. Ayrılmak borcu silmiyor — kişi dönemde
    # katılımcı olarak kalıyor ve borcu Kasa'da görünmeye devam ediyor. İsmi
    # rozetsiz durursa hâlâ ev arkadaşı sanılıyor ve "niye listede yok" ile
    # "niye borçlu görünüyor" aynı anda sorulmuş oluyor.
    bugunku = set(hh.get("member_ids", []))
    for m in members:
        m["ayrildi"] = m["user_id"] not in bugunku
    result["members"] = members
    result["period"] = period
    # Ekstre: bakiyenin ay ay dökümü. Kapalı dönemde hesaplanmıyor — orada
    # bakiye sıfır ve gösterilecek bir borç yok.
    result["statement"] = (
        {"months": [], "carried": 0, "current_month": month_key(ev_bugun(hh))}
        if snap else
        await _ekstre(hh["household_id"], period["period_id"], user["user_id"],
                      participants, hh["member_ids"], ev_bugun(hh))
    )
    return result


# ---------- Düzenli ödemeler ----------
# Kira, elektrik, internet: her ay tekrar eden giderler.
#
# **Takvim tarihli, dönem değil.** Dönem üç hafta da sürebilir yedi hafta da;
# elektrik faturası hep ayın 15'inde gelir. Şablon `day_of_month` taşır.
#
# **Kapatmak asla sessizce eklemez.** Vadesi gelen şablon bir *öneri* üretir,
# kayıt değil. Yanlış eklenen bir kira, arkadaşlar arasında yanlış borç demek;
# ve kimsenin görmediği bir borç en kötüsüdür. Onay hep insandan gelir.


class RecurringCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    amount: float = Field(gt=0)
    day_of_month: int = Field(ge=1, le=31)
    # Kira sabittir, elektrik değildir. Sabit olanda tutar hazır gelir ama
    # onay yine de istenir — "sabit" demek "sormadan ekle" demek değil.
    amount_fixed: bool = True
    scope: Literal["household", "self"] = "household"
    split_mode: Optional[Literal["equal", "exact"]] = None
    split_with: Optional[Dict[str, float]] = None
    category: Optional[str] = None
    merchant: Optional[str] = None
    notes: Optional[str] = None


class RecurringUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    amount: Optional[float] = Field(default=None, gt=0)
    day_of_month: Optional[int] = Field(default=None, ge=1, le=31)
    amount_fixed: Optional[bool] = None
    split_mode: Optional[Literal["equal", "exact"]] = None
    split_with: Optional[Dict[str, float]] = None
    category: Optional[str] = None
    merchant: Optional[str] = None
    notes: Optional[str] = None
    active: Optional[bool] = None


class RecurringConfirm(BaseModel):
    """Vadesi gelen bir şablonu harcamaya çevirir.

    Tutar ve bölüşüm burada değiştirilebilir: elektrik her ay farklı gelir ve
    kullanıcıyı önce şablonu düzenlemeye zorlamak, faturayı girmenin önüne
    fazladan bir ekran koyar.
    """
    period_key: str            # "2026-08" — hangi ay için
    # Onaylamak izin vermek değil, "bu ödendi" demek: oluşan harcamanın
    # ödeyeni bakiyede alacaklı çıkıyor. Uygulamayı açan kişi ile parayı veren
    # kişi çoğu zaman farklı ("kirayı Salih ödüyor, uygulamayı ben giriyorum"),
    # o yüzden ödeyen ayrıca seçilebiliyor. Boşsa onaylayan kişidir.
    paid_by: Optional[str] = None
    amount: Optional[float] = Field(default=None, gt=0)
    split_mode: Optional[Literal["equal", "exact"]] = None
    split_with: Optional[Dict[str, float]] = None
    expense_date: Optional[str] = None
    notes: Optional[str] = None


def month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def due_date_in(year: int, month: int, day_of_month: int) -> date:
    """Ayın kaçında vadesi geldiği — kısa aylarda son güne kırpılır.

    Ayın 31'i seçilmiş bir şablon şubatta hiç vadesi gelmemiş sayılırdı.
    """
    if month == 12:
        first_next = date(year + 1, 1, 1)
    else:
        first_next = date(year, month + 1, 1)
    last_day = (first_next - timedelta(days=1)).day
    return date(year, month, min(day_of_month, last_day))


def recurring_due_for(tpl: dict, today: date) -> Optional[str]:
    """Bu şablonun bekleyen ayı — yoksa None.

    Yalnızca **içinde bulunulan ay** bakılıyor. Geriye dönük kaçırılmış aylar
    üretilmiyor: iki ay uygulamayı açmayan bir eve girdiğinde altı tane onay
    kartı çıkması yardım değil, gürültü. Kaçırılan ay elle girilir.
    """
    if not tpl.get("active", True):
        return None
    key = month_key(today)
    if tpl.get("last_confirmed") == key or key in (tpl.get("skipped") or []):
        return None
    if today < due_date_in(today.year, today.month, int(tpl["day_of_month"])):
        return None
    return key


def _public_recurring(tpl: dict, today: date) -> dict:
    out = {k: v for k, v in tpl.items() if k != "_id"}
    out["due_period"] = recurring_due_for(tpl, today)

    # Siradaki vade tarihi ve kac gun kaldigi/gectigi. Once ekranda yalnizca
    # `day_of_month` (cıplak bir "1") duruyordu ve ne oldugu anlasilmiyordu.
    gun = int(tpl["day_of_month"])
    bu_ay = due_date_in(today.year, today.month, gun)
    if out["due_period"]:
        # Vadesi gelmis ve hala onaylanmamis: tarih BU ayin vadesi.
        sonraki = bu_ay
    elif today < bu_ay:
        sonraki = bu_ay
    else:
        y, m = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
        sonraki = due_date_in(y, m, gun)
    out["next_due"] = sonraki.isoformat()
    # Eksi = gecikti. Ekran "4 gun gecikti" diyebilsin diye burada hesaplaniyor;
    # istemcinin tarih aritmetigi yapmasi gereksiz ve saat dilimine acik.
    out["days_until"] = (sonraki - today).days

    # Kaydedilmemis GECMIS ay. `recurring_due_for` bilerek yalnizca icinde
    # bulunulan aya bakiyor (iki ay uygulamayi acmayan biri alti onay kartiyla
    # karsilasmasin diye) -- ama 1.200 EUR'luk kiranin sessizce kaybolmasina da
    # izin veriyordu. Kart uretmeden, tek satirlik bir not icin sayiyor.
    onceki = None
    if today.month == 1:
        oy, om = today.year - 1, 12
    else:
        oy, om = today.year, today.month - 1
    onceki_key = f"{oy:04d}-{om:02d}"
    if (tpl.get("active", True)
            and tpl.get("last_confirmed") != onceki_key
            and onceki_key not in (tpl.get("skipped") or [])
            and make_aware(tpl["created_at"]).date() <= due_date_in(oy, om, gun)):
        onceki = onceki_key
    out["missed_period"] = onceki
    return out


async def _visible_recurring(user_id: str, household_id: str) -> dict:
    """Ortak şablonları herkes görür, kişisel olanı yalnızca sahibi."""
    return {
        "household_id": household_id,
        "$or": [{"scope": "household"}, {"scope": "self", "created_by": user_id}],
    }


@api.get("/recurring")
async def list_recurring(user=Depends(get_current_user)):
    hh = await get_user_household(user["user_id"])
    if not hh:
        return {"recurring": [], "due": []}
    today = ev_bugun(hh)
    rows = await db.recurring.find(
        await _visible_recurring(user["user_id"], hh["household_id"]), {"_id": 0}
    ).sort("day_of_month", 1).to_list(200)
    items = [_public_recurring(r, today) for r in rows]
    return {"recurring": items, "due": [r for r in items if r["due_period"]]}


@api.post("/recurring")
async def create_recurring(body: RecurringCreate, user=Depends(get_current_user)):
    hh = await get_user_household(user["user_id"])
    if not hh:
        raise HTTPException(status_code=400, detail="Önce bir eve katılın")

    if body.scope == "self":
        # Kişisel gider dengeye girmez; listesi de yalnızca sahibinden oluşur.
        split_mode, split_with = "exact", {user["user_id"]: round(body.amount, 2)}
    else:
        split_mode, split_with = resolve_split(
            body, user["user_id"], body.amount, hh["member_ids"]
        )
    doc = {
        "recurring_id": new_id("rec"),
        "household_id": hh["household_id"],
        "created_by": user["user_id"],
        "scope": body.scope,
        "name": body.name.strip(),
        "amount": round(body.amount, 2),
        "amount_fixed": body.amount_fixed,
        "day_of_month": body.day_of_month,
        "split_mode": split_mode,
        "split_with": split_with,
        "category": (body.category or "").strip() or None,
        "merchant": await resolve_merchant(hh["household_id"], body.merchant),
        "notes": (body.notes or "").strip() or None,
        "currency": hh.get("currency", "EUR"),
        "active": True,
        "last_confirmed": None,
        "skipped": [],
        "created_at": now_utc(),
    }
    await db.recurring.insert_one(doc.copy())
    if body.scope == "household":
        await notify(
            [m for m in hh["member_ids"] if m != user["user_id"]],
            "Yeni düzenli gider",
            f"{user['name']} · {doc['name']} · her ayın {doc['day_of_month']}'i",
            "recurring", {"recurring_id": doc["recurring_id"]},
        )
    return {"recurring": _public_recurring(doc, ev_bugun(hh))}


async def _own_recurring(recurring_id: str, user: dict) -> dict:
    doc = await db.recurring.find_one({"recurring_id": recurring_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Düzenli gider bulunamadı")
    hh = await get_user_household(user["user_id"])
    if not hh or doc["household_id"] != hh["household_id"]:
        raise HTTPException(status_code=404, detail="Düzenli gider bulunamadı")
    if doc["scope"] == "self" and doc["created_by"] != user["user_id"]:
        raise HTTPException(status_code=404, detail="Düzenli gider bulunamadı")
    return doc


@api.patch("/recurring/{recurring_id}")
async def update_recurring(recurring_id: str, body: RecurringUpdate,
                           user=Depends(get_current_user)):
    doc = await _own_recurring(recurring_id, user)
    # Harcamalardaki kuralın aynısı: şablonu yalnızca kuran değiştirir.
    # Kirayı bir başkasının sessizce 50 € artırması, kimsenin fark etmediği
    # bir borç üretirdi.
    if doc["created_by"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Sadece kuran kişi değiştirebilir")
    hh = await get_user_household(user["user_id"])

    patch: dict = {}
    for field in ("name", "day_of_month", "amount_fixed", "category", "notes", "active"):
        val = getattr(body, field)
        if val is not None:
            patch[field] = val.strip() if isinstance(val, str) else val
    if body.amount is not None:
        patch["amount"] = round(body.amount, 2)
    if body.merchant is not None:
        patch["merchant"] = await resolve_merchant(hh["household_id"], body.merchant)
    if body.split_with is not None or body.split_mode is not None:
        if doc["scope"] == "self":
            raise HTTPException(status_code=400, detail="Kişisel gider bölüşülmez")
        mode, sw = resolve_split(
            body, doc["created_by"], patch.get("amount", doc["amount"]),
            hh["member_ids"], fallback=doc,
        )
        patch["split_mode"], patch["split_with"] = mode, sw
    elif doc["scope"] == "self" and "amount" in patch:
        patch["split_with"] = {doc["created_by"]: patch["amount"]}
    elif "amount" in patch and doc.get("split_mode") == "exact":
        # Kişiye özel bölüşüm eski toplama göre girilmişti. Bırakılsaydı şablon
        # bozuk kalır ve hata ancak aylar sonra, onay anında görünürdü.
        if abs(sum(doc["split_with"].values()) - patch["amount"]) > 0.01:
            raise HTTPException(
                status_code=400,
                detail="Tutar değişti, kişiye özel bölüşüm artık tutmuyor. Bölüşümü yeniden düzenleyin.",
            )

    if patch:
        patch["updated_at"] = now_utc()
        await db.recurring.update_one({"recurring_id": recurring_id}, {"$set": patch})
    updated = await db.recurring.find_one({"recurring_id": recurring_id}, {"_id": 0})
    return {"recurring": _public_recurring(updated, ev_bugun(hh))}


@api.delete("/recurring/{recurring_id}")
async def delete_recurring(recurring_id: str, user=Depends(get_current_user)):
    doc = await _own_recurring(recurring_id, user)
    if doc["created_by"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Sadece kuran kişi silebilir")
    await db.recurring.delete_one({"recurring_id": recurring_id})
    # Üretilmiş harcamalar duruyor: geçmiş ay gerçekten ödendi, şablonun
    # silinmesi onu geri almaz.
    return {"ok": True}


@api.post("/recurring/{recurring_id}/confirm")
async def confirm_recurring(recurring_id: str, body: RecurringConfirm,
                            user=Depends(get_current_user)):
    """Onayla → harcama oluşur. Tek yazma yolu burasıdır."""
    doc = await _own_recurring(recurring_id, user)
    hh = await get_user_household(user["user_id"])
    period = await get_active_period(hh["household_id"])
    if not period:
        raise HTTPException(status_code=400, detail="Aktif dönem bulunamadı")
    # Aynı ayı iki kez onaylamak iki kira demek. Kontrol sunucuda: iki telefon
    # aynı anda bildirimi görüp ikisi de onaylayabilir.
    if doc.get("last_confirmed") == body.period_key:
        raise HTTPException(status_code=409, detail="Bu ay zaten onaylanmış")

    payer = body.paid_by or user["user_id"]
    if payer not in hh["member_ids"]:
        raise HTTPException(status_code=400, detail="Ödeyen bu evin üyesi değil")
    if doc["scope"] == "self" and payer != user["user_id"]:
        # Kişisel gider başkası adına kaydedilemez: kimse görmüyor, dolayısıyla
        # yanlış girildiğinde düzeltecek kimse de yok.
        raise HTTPException(status_code=400, detail="Kişisel gider başkası adına kaydedilemez")

    amount = round(body.amount if body.amount is not None else doc["amount"], 2)
    if doc["scope"] == "self":
        split_mode, split_with = "exact", {user["user_id"]: amount}
    elif body.split_with is not None:
        split_mode = body.split_mode or "equal"
        split_with = validate_split(
            split_mode, body.split_with, amount,
            list(dict.fromkeys(list(hh["member_ids"]) + [payer])),
        )
    else:
        split_mode, split_with = doc["split_mode"], dict(doc["split_with"])
        # Şablondaki kişiye özel tutarlar eski toplama göre girilmişti.
        if split_mode == "exact" and abs(sum(split_with.values()) - amount) > 0.01:
            raise HTTPException(
                status_code=400,
                detail="Tutar şablondakinden farklı, bölüşümü bu ay için düzenleyin",
            )
    target_type = derive_target_type(payer, split_with, hh["member_ids"])

    expense_id = new_id("exp")
    exp = {
        "expense_id": expense_id,
        "household_id": hh["household_id"],
        "period_id": period["period_id"],
        # Parayi veren kisi. Bakiyede alacakli cikan bu.
        "added_by": payer,
        "target_type": target_type,
        "target_user_id": next(iter(split_with)) if target_type == "roommate" else None,
        "split_mode": split_mode,
        "split_with": split_with,
        "items": [{"name": doc["name"], "price": amount, "quantity": 1,
                   "unit": "adet", "size_amount": None, "size_unit": None,
                   "category": "diger"}],
        "total": amount,
        "source": "manual",
        "category": doc.get("category"),
        "merchant": doc.get("merchant"),
        "notes": body.notes if body.notes is not None else doc.get("notes"),
        "currency": hh.get("currency", "EUR"),
        "expense_date": parse_date(body.expense_date) or ev_bugun(hh).isoformat(),
        "created_at": now_utc(),
        # Hangi şablondan geldiği kayıtta duruyor: "bu kirayı kim ekledi"
        # sorusunun cevabı aylar sonra da bulunabilsin.
        "recurring_id": recurring_id,
        "recurring_period": body.period_key,
        # Kaydı giren, ödeyenden farklı olabilir. Ödeyen `added_by`; bu alan
        # yalnızca izlenebilirlik için ve farklıysa yazılıyor.
        "recorded_by": user["user_id"] if payer != user["user_id"] else None,
    }
    await db.expenses.insert_one(exp.copy())
    await db.recurring.update_one(
        {"recurring_id": recurring_id},
        {"$set": {"last_confirmed": body.period_key, "last_amount": amount}},
    )

    # Ödeyen de haber almalı: başkası onun adına bir ödeme kaydetti ve bakiyesi
    # değişti. Bunu ancak kendisi ekrana bakıp fark ederse öğrenirdi.
    audience = [u for u in dict.fromkeys(list(split_with) + [payer])
                if u != user["user_id"]]
    if audience:
        txt = f"{doc['amount']:.2f}".replace(".", ",")
        got = f"{amount:.2f}".replace(".", ",")
        extra = "" if abs(amount - doc["amount"]) < 0.01 else f" (şablonda {txt} €)"
        if payer == user["user_id"]:
            body_txt = f"{user['name']} ödedi · {doc['name']} · {got} €{extra}"
        else:
            payer_doc = await db.users.find_one({"user_id": payer}, {"_id": 0, "name": 1})
            who = (payer_doc or {}).get("name", "biri")
            body_txt = f"{who} ödedi · {doc['name']} · {got} €{extra} · {user['name']} kaydetti"
        await notify(audience, "Düzenli gider eklendi", body_txt,
                     "recurring", {"expense_id": expense_id, "ay": exp["expense_date"][:7]})
    return {"expense": exp}


@api.post("/recurring/{recurring_id}/skip")
async def skip_recurring(recurring_id: str, body: RecurringConfirm,
                         user=Depends(get_current_user)):
    """Bu ay atla. "Sonra" değil — o istemcide kalır, kart yine çıkar."""
    doc = await _own_recurring(recurring_id, user)
    await db.recurring.update_one(
        {"recurring_id": recurring_id},
        {"$addToSet": {"skipped": body.period_key}},
    )
    return {"ok": True}


# ---------- Fiyat hafızası ----------
class PriceMemoryReq(BaseModel):
    # Market ZORUNLU: karşılaştırma yalnızca aynı marketin içinde yapılıyor.
    merchant: str
    # Kalemin tamamı geliyor, sadece adı değil: birim fiyat hesabı burada
    # kalmalı. İstemcide ikinci bir kopyası olsaydı iki taraf farklı sonuç
    # verdiğinde kullanıcı yanlış bir "fiyat arttı" uyarısı görürdü.
    items: List[ExpenseItem] = Field(default_factory=list, max_length=200)


@api.post("/price-memory")
async def price_memory(body: PriceMemoryReq, user=Depends(get_current_user)):
    """Bu evin KENDİ fişlerinden ürün fiyatı geçmişi — **aynı market içinde.**

    Anonim `price_points` koleksiyonuna dokunmuyor: kaynak evin kendi
    harcamaları, yani kullanıcı zaten görebildiği veriyi derlenmiş hâlde
    görüyor.

    ### Neden marketler arası karşılaştırma yok

    "REWE'de 2 €, ALDI'de 1 €" cümlesi çoğu zaman fiyat farkını değil **ürün
    farkını** ölçer. Süt her markette kendi markası altında satılıyor
    (`MILSANI`, `MILBONA`, `JA!`) — bunlar farklı ürünler. Aynı gramajlı biber
    birinde tepside, ötekinde açık. Fiş metinleri de her kasa sisteminde başka
    türlü yazılıyor.

    Aynı marketin içinde ise metni o marketin kendi kasası üretiyor:
    `MILSANI H-MILCH 3,5% 1L` bu hafta da gelecek hafta da aynı dizgi. Yani
    karşılaştırılan şey gerçekten aynı ürün, tahmin değil.

    Marketler arası karşılaştırma ancak barkod (EAN) ile sağlam olurdu; Alman
    fişleri onu genelde basmıyor. Yapısal olarak zor, bilerek yapılmıyor.

    Ayrıca **paket sınıfı** da ayrı tutuluyor: açık alınan üzümle paketli
    üzümü aynı seriye koymak "fiyat iki katına çıktı" der, oysa değişen
    ambalajdır.
    """
    hh = await get_user_household(user["user_id"])
    mkey = normalize_merchant(body.merchant)
    if not hh or not mkey:
        return {"memory": {}}

    # Sorulan kalemlerin kendi birim fiyatı da aynı fonksiyondan geçiyor,
    # böylece karşılaştırma elma ile elma.
    asked: Dict[str, list] = {}
    now_price: Dict[str, dict] = {}
    for it in body.items[:200]:
        p = price_of_item(it.model_dump())
        if not p:
            continue
        asked.setdefault(p["product_key"], []).append(it.name)
        now_price[it.name] = p
    if not asked:
        return {"memory": {}}
    wanted = asked

    exps = await db.expenses.find(
        {"household_id": hh["household_id"], "source": "receipt",
         "merchant": {"$ne": None}},
        {"_id": 0, "merchant": 1, "expense_date": 1, "items": 1},
    ).sort("expense_date", -1).to_list(2000)
    # Aynı markete ait fişler — yazım farkları normalleştiriliyor
    # ("Bizim Fleisher GmbH" ile "Bizim Fleischer" aynı yer).
    exps = [e for e in exps if normalize_merchant(e.get("merchant")) == mkey]

    found: Dict[str, list] = {}
    for e in exps:
        for item in e.get("items") or []:
            p = price_of_item(item)
            if not p or p["product_key"] not in wanted:
                continue
            found.setdefault(p["product_key"], []).append({
                "merchant": e["merchant"],
                "expense_date": e.get("expense_date"),
                "unit_price": p["unit_price"],
                "price_unit": p["price_unit"],
                "pack_type": p["pack_type"],
                "product": p["product"],
            })

    memory: Dict[str, dict] = {}
    for key, rows in found.items():
        rows.sort(key=lambda r: r["expense_date"] or "", reverse=True)
        for raw in wanted[key]:
            cur = now_price.get(raw)
            if not cur:
                continue
            # Karşılaştırma yalnızca AYNI paket sınıfı içinde. Açık alınan
            # üzümle paketli üzümü aynı seriye koymak "fiyat iki katına çıktı"
            # der; oysa değişen fiyat değil ambalajdır.
            same = [r for r in rows if r["pack_type"] == cur["pack_type"]]
            if not same:
                continue
            # "En ucuz" artık bir market önerisi değil, bu markette görülmüş
            # en düşük fiyat: "bunu burada 2,98'e de görmüştük".
            cheapest = min(same, key=lambda r: r["unit_price"])
            prev = same[0]
            delta = None
            if prev["unit_price"] > 0:
                delta = round(
                    (cur["unit_price"] - prev["unit_price"]) / prev["unit_price"] * 100
                )
            memory[raw] = {
                "unit_price": cur["unit_price"],
                "price_unit": cur["price_unit"],
                "pack_type": cur["pack_type"],
                "previous": prev,
                "cheapest": cheapest,
                "delta_pct": delta,
                "count": len(same),
                "history": same[:8],
            }
    return {"memory": memory}


# ---------- Stats ----------
# Ev ya da dönem yoksa dönen iskelet. Alanların hepsi burada da bulunmalı:
# istemci eksik anahtarı undefined okuyup grafiği boş yerine çökmüş çiziyordu.
EMPTY_STATS = {
    "total": 0, "per_person": 0, "my_share": 0, "my_paid": 0,
    "daily_average": 0, "projected_30d": 0,
    "change_pct": None, "expense_count": 0, "item_count": 0, "avg_expense": 0,
    "member_count": 0, "by_member": [], "daily_series": [],
    "categories": [], "merchants": [],
}


@api.get("/stats")
async def stats(period_id: Optional[str] = None, user=Depends(get_current_user)):
    """Household numbers for the home screen.

    Ortak harcanan para sayılıyor: `household` (herkes) ve `custom` (evin bir
    bölümü, örneğin fişteki yumurtayı iki kişinin bölüşmesi). Dışarıda kalan
    ikisi ortak harcama değil — `self` kişiseldir, `roommate` iki kişi
    arasındaki borçtur.
    """
    hh = await get_user_household(user["user_id"])
    if not hh:
        return EMPTY_STATS

    period = (
        await db.periods.find_one({"period_id": period_id, "household_id": hh["household_id"]}, {"_id": 0})
        if period_id else await get_active_period(hh["household_id"])
    )
    if not period:
        return EMPTY_STATS

    # Kapsam ETIKETTEN degil bolusme LISTESINDEN cikiyor.
    #
    # Once `target_type in ["household", "custom"]` suzuluyordu. Uc kisilik bir
    # evde "sen + Salih" bolusmesi `custom` etiketi tasidigi icin EV harcamasi
    # sayiliyordu -- oysa ev onu almadi. `/stats/monthly` Tur 9'da bu kurala
    # gecmisti, burasi kalmisti; iki uc ayni olayi farkli sayiyordu.
    #
    # Ekranda IKI ayri kapsam var ve ikisi de dogru:
    #   `total`, kategoriler, marketler, kim-ne-odedi -> yalnizca EVIN
    #     tamaminin bolustugu harcamalar ("BU DONEM EV HARCAMASI" o demek)
    #   `my_paid`, `my_share` -> bakiyeyi ilgilendiren her sey; Salih icin
    #     aldigin parayi sen cikardin, o satirda gorunmeli
    tumu = await db.expenses.find(
        {"household_id": hh["household_id"], "period_id": period["period_id"]},
        {"_id": 0},
    ).to_list(5000)
    members = await period_participants(hh["household_id"], period["period_id"], hh["member_ids"])
    uyeler = set(members)
    me_id = user["user_id"]

    exps: List[dict] = []
    my_paid = 0.0
    my_share = 0.0
    for e in tumu:
        shares = expense_shares(e, members)
        if not shares:
            continue
        # Kisisel harcama hicbir yere girmez: dengeye de, istatistige de.
        if e.get("target_type") == "self" and set(shares) == {e["added_by"]}:
            continue
        if uyeler and uyeler <= set(shares):
            exps.append(e)
        if e["added_by"] == me_id:
            my_paid += float(e["total"])
        my_share += shares.get(me_id, 0.0)

    total = round(sum(float(e["total"]) for e in exps), 2)
    per_person = round(total / max(len(members), 1), 2)
    my_paid = round(my_paid, 2)
    my_share = round(my_share, 2)

    cats: Dict[str, float] = {}
    for e in exps:
        items = e.get("items") or []
        item_sum = sum(float(i.get("price", 0)) * float(i.get("quantity", 1) or 1) for i in items)
        for i in items:
            line = float(i.get("price", 0)) * float(i.get("quantity", 1) or 1)
            key = i.get("category") or "diger"
            # Scale line values to the recorded total so discounts and rounding
            # on the receipt do not make the breakdown disagree with the header.
            share = (line / item_sum * float(e["total"])) if item_sum else 0
            cats[key] = cats.get(key, 0) + share
        if not items:
            cats["diger"] = cats.get("diger", 0) + float(e["total"])

    merchants: Dict[str, float] = {}
    merchant_names: Dict[str, str] = {}
    for e in exps:
        ham = (e.get("merchant") or "Diğer").strip() or "Diğer"
        anahtar = normalize_merchant(ham) or ham.casefold()
        onceki = merchant_names.get(anahtar)
        if onceki is None or len(ham) < len(onceki):
            merchant_names[anahtar] = ham
        merchants[anahtar] = merchants.get(anahtar, 0) + float(e["total"])

    # Kim ne kadar ödedi. Aynı listeden çıkıyor — ek sorgu yok.
    by_member: Dict[str, float] = {m: 0.0 for m in members}
    for e in exps:
        payer = e.get("added_by")
        if payer in by_member:
            by_member[payer] += float(e["total"])

    # Son 14 günün günlük dökümü. Grafiğin her zaman çubuğu olsun diye harcama
    # olmayan günler de 0 ile dizide duruyor — aksi halde grafik gün atlıyor
    # ve aralar eşit görünmüyordu.
    item_count = 0
    days_of: List[str] = []
    for e in exps:
        item_count += len(e.get("items") or [])
        d = (e.get("expense_date") or "")[:10]
        days_of.append(d or make_aware(e["created_at"]).date().isoformat())

    # Pencerenin sonu EVİN bugünü ile en yeni harcama tarihinin büyüğü.
    #
    # Buradaki "en yeni harcamayla da karşılaştır" kuralı, saat dilimi hatasına
    # karşı elle yazılmış bir yamaydı: UTC "bugün" yerel gece yarısından sonra
    # bir gün geride kalıyor ve o gece girilen harcama grafiğin dışında
    # kalıyordu. Kök sebep `ev_bugun()` ile kalktı; kural yine de duruyor
    # çünkü GELECEK tarihli bir fiş (kullanıcı elle ileri tarih girebilir) hâlâ
    # pencerenin dışına düşerdi.
    last = max([ev_bugun(hh).isoformat()] + days_of)
    end = date.fromisoformat(last)
    span = [end - timedelta(days=i) for i in range(13, -1, -1)]
    daily_map: Dict[str, float] = {d.isoformat(): 0.0 for d in span}
    for e, day in zip(exps, days_of):
        if day in daily_map:
            daily_map[day] += float(e["total"])

    started = make_aware(period["started_at"])
    days = max((now_utc() - started).days + 1, 1)
    daily = round(total / days, 2)
    # Straight-line projection to 30 days — the question people actually ask
    # mid-period is "where does this land if we carry on like this".
    projected = round(daily * 30, 2)

    previous = await db.periods.find(
        {"household_id": hh["household_id"], "status": "closed"}, {"_id": 0}
    ).sort("closed_at", -1).to_list(1)
    change_pct = None
    if previous:
        prev_exps = await db.expenses.find(
            {"household_id": hh["household_id"], "period_id": previous[0]["period_id"],
             "target_type": {"$in": ["household", "custom"]}},
            {"_id": 0, "total": 1},
        ).to_list(5000)
        prev_total = sum(float(e["total"]) for e in prev_exps)
        if prev_total > 0:
            change_pct = round((total - prev_total) / prev_total * 100)

    return {
        "period_id": period["period_id"],
        "started_at": period["started_at"],
        "days": days,
        "total": total,
        "per_person": per_person,
        "my_share": my_share,
        "my_paid": my_paid,
        "daily_average": daily,
        "projected_30d": projected,
        "change_pct": change_pct,
        "expense_count": len(exps),
        "item_count": item_count,
        "avg_expense": round(total / len(exps), 2) if exps else 0,
        "member_count": len(members),
        "by_member": [
            {"user_id": uid, "total": round(v, 2)}
            for uid, v in sorted(by_member.items(), key=lambda x: -x[1])
        ],
        "daily_series": [{"day": d, "total": round(v, 2)} for d, v in daily_map.items()],
        "categories": sorted(
            [{"key": k, "total": round(v, 2)} for k, v in cats.items() if v > 0.005],
            key=lambda x: -x["total"],
        ),
        "merchants": sorted(
            [{"name": merchant_names.get(k, k), "total": round(v, 2)}
             for k, v in merchants.items()],
            key=lambda x: -x["total"],
        )[:6],
    }


# ---------- Aylık istatistik ----------
# **Takvim ayı, dönem değil.** Dönem üç hafta da sürebilir yedi hafta da;
# "bu ay ne kadar harcadık" sorusunun cevabı dönemle değişmemeli. Mevcut
# `/stats` dönem bazlıdır ve Anasayfa'nın başlığını besler; burası ayrı.
#
# Her sayı birinin gerçekten sorduğu bir soruya cevap veriyor. "Koymak için"
# konan tek bir gösterge yok — özellikle kişi başına tüketim karşılaştırması
# bilinçli olarak dışarıda: kimin daha çok tükettiğini değil kimin daha müsait
# olduğunu ölçer ve ev arkadaşları arasında gereksiz sürtüşme üretir.


def _month_bounds(month: str) -> tuple:
    y, m = int(month[:4]), int(month[5:7])
    start = date(y, m, 1)
    end = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
    return start.isoformat(), end.isoformat()


def _prev_month(month: str) -> str:
    y, m = int(month[:4]), int(month[5:7])
    return f"{y - 1}-12" if m == 1 else f"{y}-{m - 1:02d}"


def _expense_day(e: dict) -> str:
    d = (e.get("expense_date") or "")[:10]
    return d or make_aware(e["created_at"]).date().isoformat()


async def _month_expenses(
    household_id: str, month: str, scope: str, user_id: str, members: List[str]
) -> List[dict]:
    """Bir ayın harcamaları, kapsamına göre süzülmüş.

    **Kapsam `target_type` etiketinden değil bölüşme LİSTESİNDEN çıkar.**
    Önceden `self` yalnızca `target_type == "self"`, `household` ise
    `["household", "custom"]` demekti — yani `roommate` hiçbirine girmiyordu
    ve **hiçbir istatistikte görünmüyordu**: Salih senin için bir şey aldıysa
    o harcama kayıptı. `custom` de (evin bir bölümünün bölüştüğü şey) ev
    harcaması sayılıyor, evin almadığı şey ev toplamını şişiriyordu.

    Kural: **ev bölüşmüyorsa ev harcaması değildir.** Evin tamamı listedeyse
    ev, değilse kişisel. Kişiselde tutar harcamanın toplamı değil **senin
    payın** — Salih'in senin için aldığı 20 €'yu sen ödeyeceksin, ama üçe
    bölünen bir akşam yemeğinin sana düşeni yalnızca payın kadar.

    "Evin tamamı listede mi" testi `members <= shares` biçiminde: evden ayrılan
    biri eski bir ev harcamasının listesinde durmaya devam ettiği için eşitlik
    araması o kayıtları yanlışlıkla kişisele düşürürdü.
    """
    lo, hi = _month_bounds(month)
    rows = await db.expenses.find({"household_id": household_id}, {"_id": 0}).to_list(5000)
    rows = [e for e in rows if lo <= _expense_day(e) < hi]
    return _kapsa(rows, scope, user_id, members)


def _kapsa(rows: List[dict], scope: str, user_id: str, members: List[str]) -> List[dict]:
    """Kapsam süzgeci — `_month_expenses`'ten ayrıldı ki seri hesabı da
    aynı kuralı kullansın. İki kopya olsaydı "Son 6 Ay" çubuğu ile o ayın
    kendi toplamı ayrışırdı."""
    out: List[dict] = []
    uyeler = set(members)
    for e in rows:
        shares = expense_shares(e, members)
        if not shares:
            continue
        # `target_type == "self"` acik bir beyandir ve korunur: tek kisilik bir
        # evde "evin tamami" testi her seyi ev harcamasi yapardi.
        kisisel = e.get("target_type") == "self" or not (uyeler and uyeler <= set(shares))
        if scope == "self":
            if kisisel and user_id in shares:
                # `_breakdown` kalemleri harcamanin toplamina olcekliyor, yani
                # toplami degistirmek kategori dokumunu de dogru olcekliyor.
                out.append({**e, "total": round(float(shares[user_id]), 2)})
        elif not kisisel:
            out.append(e)
    return out


async def _aylik_seri(household_id: str, son_ay: str, scope: str, user_id: str,
                      members: List[str], adet: int = 6) -> List[dict]:
    """Son `adet` ayın toplamı — **tek veritabanı okumasıyla.**

    `_month_expenses`'i altı kez çağırmak koleksiyonu altı kez okumak
    demekti. Seri tek okumadan kovalanıyor; kapsam kuralı `_kapsa` ile
    ortak, yani çubuktaki ay ile o aya girildiğindeki toplam ayrışamaz.

    **İki farklı "sıfır" var ve ayrımı önemli.** Veri geçmişinin İÇİNDEKİ boş
    ay bir bilgidir ("Temmuz'da hiç harcama girilmemiş") ve çubuğu sıfır
    yüksekliğinde çizilir. Ama evin ilk harcamasından ÖNCEKİ aylar hiç
    dönmüyor: Ağustos'ta kurulan bir eve "Mart 0 €" yazmak, o ay hiç
    harcamadığını söylemek olur — oysa o ay ortada yoktun. Ekran da başlığı
    buna göre düzeltiyor ("Son 3 Ay").
    """
    ilk = await db.expenses.find(
        {"household_id": household_id, "expense_date": {"$ne": None}},
        {"_id": 0, "expense_date": 1},
    ).sort("expense_date", 1).limit(1).to_list(1)
    alt_sinir = ilk[0]["expense_date"][:7] if ilk and ilk[0].get("expense_date") else None

    aylar = []
    y, m = int(son_ay[:4]), int(son_ay[5:7])
    for _ in range(adet):
        ay = f"{y:04d}-{m:02d}"
        if alt_sinir and ay < alt_sinir:
            break
        aylar.append(ay)
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    aylar.reverse()
    if not aylar:
        return []

    lo, _ = _month_bounds(aylar[0])
    _, hi = _month_bounds(aylar[-1])
    rows = await db.expenses.find({"household_id": household_id}, {"_id": 0}).to_list(5000)
    rows = [e for e in rows if lo <= _expense_day(e) < hi]

    kovalar: Dict[str, List[dict]] = {a: [] for a in aylar}
    for e in _kapsa(rows, scope, user_id, members):
        kova = kovalar.get(_expense_day(e)[:7])
        if kova is not None:
            kova.append(e)
    return [{"month": a,
             "total": round(sum(float(e["total"]) for e in kovalar[a]), 2),
             "expense_count": len(kovalar[a])}
            for a in aylar]


def _breakdown(exps: List[dict]) -> dict:
    cats: Dict[str, float] = {}
    merchants: Dict[str, float] = {}
    merchant_names: Dict[str, str] = {}
    for e in exps:
        total = float(e["total"])
        items = e.get("items") or []
        item_sum = sum(float(i.get("price", 0)) * float(i.get("quantity", 1) or 1) for i in items)
        if items and item_sum:
            for i in items:
                line = float(i.get("price", 0)) * float(i.get("quantity", 1) or 1)
                key = i.get("category") or "diger"
                # Kalemler fişin toplamına ölçekleniyor: indirim satırları ve
                # yuvarlama yüzünden kalem toplamı fiş toplamını tutmuyor ve
                # ölçeklenmezse döküm başlıktaki rakamla çelişiyor.
                cats[key] = cats.get(key, 0) + line / item_sum * total
        else:
            cats["diger"] = cats.get("diger", 0) + total
        # Gruplama NORMALIZE anahtarla; ekranda gosterilen ad ham hali.
        # Once ham adla gruplaniyordu, yani "BIZIM FLEISCHER GMBH" ile
        # "BIZIM FLEISCHER" ayri satirlar halinde duruyordu -- birlestirme
        # `normalize_merchant()` icinde zaten vardi, burada cagrilmiyordu.
        ham = (e.get("merchant") or "Diğer").strip() or "Diğer"
        anahtar = normalize_merchant(ham) or ham.casefold()
        # Gosterilecek ad: en KISA hali. Ticari unvan ekleri temizlenmis
        # olani insanlarin kullandigi addir ("BIZIM FLEISCHER", "… GMBH" degil).
        onceki = merchant_names.get(anahtar)
        if onceki is None or len(ham) < len(onceki):
            merchant_names[anahtar] = ham
        merchants[anahtar] = merchants.get(anahtar, 0) + total
    return {"cats": cats, "merchants": merchants, "merchant_names": merchant_names}


def _urunler(exps: List[dict]) -> List[dict]:
    """Ürün bazlı aylık toplam — "Süt · 14 lt · 3 markette · 17,20 €".

    Tur 8'in **genel ürün adı** işinin üstüne kuruluyor: `product_key`
    `MILSANI`, `MILBONA` ve `JA! MILCH`'i aynı anahtara indiriyor, yani üç
    marketin kendi markası tek satırda toplanıyor. **Rakiplerin hiçbiri bunu
    üretemez, çünkü hiçbiri fişi kalem kalem okumuyor.**

    Karşılaştırmaya ihtiyacı yok: ilk aydan itibaren dolu geliyor.

    Gösterilecek ad, o anahtara düşen adların **en kısası** — market markası
    değil insanın kullandığı kelime ("Süt", "MILBONA VOLLMILCH 3,5%" değil).
    Aynı kural `_breakdown`'daki market adında da var.

    Adet birimiyle birlikte toplanıyor ama **birimler karıştırılmıyor**: 2 kg
    un ile 3 paket un aynı sayıya eklenirse çıkan şey hiçbir şey demek olmaz.
    Baskın birim (en çok tekrar eden) yazılıyor, karışıksa birim hiç
    gösterilmiyor.
    """
    kova: Dict[str, dict] = {}
    for e in exps:
        items = e.get("items") or []
        if not items:
            continue
        ham_market = (e.get("merchant") or "").strip()
        market = normalize_merchant(ham_market) or ham_market.casefold() or "?"
        item_sum = sum(float(i.get("price", 0)) * float(i.get("quantity", 1) or 1) for i in items)
        toplam = float(e["total"])
        for i in items:
            ad = (i.get("name") or "").strip()
            # GENEL AD önce: Tur 8'de fiş okunurken her kaleme "bu ürün
            # aslında NE" diye kısa bir ad yazılıyor (`generic`), markadan ve
            # ambalajdan bağımsız. Gruplama onunla yapılınca `MILSANI`,
            # `MILBONA` ve `JA! MILCH` tek satırda "süt" olarak toplanıyor.
            #
            # `product_key(ad)` tek başına YETMİYOR ve bu ölçüldü: marka adını
            # temizlemiyor, yalnızca boyutu ayırıyor — üç market markası üç
            # ayrı satır olarak kalıyordu.
            genel = (i.get("generic") or "").strip()
            anahtar = product_key(genel) if genel else product_key(ad)
            if not anahtar:
                continue
            satir = float(i.get("price", 0)) * float(i.get("quantity", 1) or 1)
            # Fişin toplamına ölçekle: indirim satırları ve yuvarlama yüzünden
            # kalem toplamı fiş toplamını tutmuyor.
            tutar = satir / item_sum * toplam if item_sum else satir
            k = kova.setdefault(anahtar, {
                "key": anahtar, "name": genel or ad, "generic": bool(genel),
                "total": 0.0, "count": 0,
                "markets": set(), "units": {}, "qty": 0.0, "bozuk_birim": False,
            })
            # Genel ad varsa ekranda O yazılıyor ("Süt"), market markası değil.
            # Yoksa ham adların en kısası — ticari ek taşımayan hâli insanların
            # kullandığı addır (`_breakdown`'daki market adı kuralının aynısı).
            if genel:
                k["name"], k["generic"] = genel, True
            elif not k["generic"] and len(ad) < len(k["name"]):
                k["name"] = ad
            k["total"] += tutar
            k["count"] += 1
            k["markets"].add(market)
            birim = (i.get("unit") or "adet").strip() or "adet"
            miktar = float(i.get("quantity", 1) or 1)
            # KESİRLİ "adet" imkânsız (7,105 adet tavuk diye bir şey yok) ve
            # birimin yanlış olduğunu kanıtlar. Sayının kendisi doğru ama
            # neyin sayısı olduğu bilinmiyor — kilo mu, litre mi? Uydurmak
            # yerine miktar hiç gösterilmiyor, satır "3 kez"e düşüyor.
            # Geçmiş kayıtlar `tests/birim-duzelt.py` ile onarıldı; bu,
            # bundan sonrası için sessiz bir güvenlik ağı.
            if birim == "adet" and abs(miktar - round(miktar)) > 1e-9:
                k["bozuk_birim"] = True
            k["units"][birim] = k["units"].get(birim, 0) + 1
            k["qty"] += miktar

    out = []
    for k in kova.values():
        birimler = k["units"]
        baskin = max(birimler, key=birimler.get) if birimler else None
        # Birim karışıksa (kg + paket) miktar toplamı anlamsız; gizleniyor.
        karisik = len(birimler) > 1 or k.get("bozuk_birim", False)
        out.append({
            "key": k["key"],
            # Genel ad küçük harfle geliyor ("süt"); ekranda satır başı büyük.
            "name": k["name"][:1].upper() + k["name"][1:] if k["name"] else "?",
            "total": round(k["total"], 2),
            "count": k["count"],
            "market_count": len(k["markets"]),
            "qty": None if karisik else round(k["qty"], 2),
            "unit": None if karisik else baskin,
        })
    out.sort(key=lambda x: -x["total"])
    return out


def _cumulative(exps: List[dict], lo: str, days: int) -> List[dict]:
    """Ayın başından itibaren biriken toplam.

    Günlük çubukların yerine geçiyor. Çubuklar az harcamada seyrek ve çirkin
    duruyordu; biriken eğri tek harcamada bile düzgün. Daha iyi bir soruya da
    cevap veriyor: "geçen ayın bu gününde neredeydik?"
    """
    daily = {(date.fromisoformat(lo) + timedelta(days=i)).isoformat(): 0.0
             for i in range(days)}
    for e in exps:
        d = _expense_day(e)
        if d in daily:
            daily[d] += float(e["total"])
    out, run = [], 0.0
    for day in sorted(daily):
        run += daily[day]
        out.append({"day": day, "total": round(run, 2)})
    return out


@api.get("/stats/monthly")
async def monthly_stats(
    month: Optional[str] = None,
    scope: str = "household",
    user=Depends(get_current_user),
):
    hh = await get_user_household(user["user_id"])
    today = ev_bugun(hh)
    month = month if (month and len(month) == 7) else month_key(today)
    empty = {
        "month": month, "scope": scope, "total": 0, "expense_count": 0,
        "prev_total": 0, "change_pct": None, "fixed": 0, "variable": 0,
        "categories": [], "merchants": [], "by_member": [],
        "cumulative": [], "prev_cumulative": [], "bills": [],
        "months": [], "son_aylar": [], "products": [], "products_frequent": [],
        "product_count": 0,
        "member_count": 0, "per_person": 0,
        "my_share": 0, "my_personal": 0,
        "prev_same_day": 0, "days": 0, "elapsed_days": 0,
    }
    if not hh:
        return empty

    uyeler = await period_participants(
        hh["household_id"],
        (await get_active_period(hh["household_id"]) or {}).get("period_id", ""),
        hh["member_ids"],
    )
    exps = await _month_expenses(hh["household_id"], month, scope, user["user_id"], uyeler)
    prev = await _month_expenses(
        hh["household_id"], _prev_month(month), scope, user["user_id"], uyeler)

    total = round(sum(float(e["total"]) for e in exps), 2)
    prev_total = round(sum(float(e["total"]) for e in prev), 2)

    # Düzenli ödemeden gelen toplam. Ekranda ayrı bir kart olarak
    # gösterilmiyor: kira aydan aya değişmediği için o kart her ay aynı şeyi
    # söylüyordu. Alan duruyor çünkü asıl ilginç kesit -- DEĞİŞKEN tutarlı
    # faturaların (elektrik, su, doğalgaz) ay ay seyri -- buradan çıkacak,
    # ama anlamlı olması için iki üç aylık veri birikmesi gerekiyor.
    fixed = round(sum(float(e["total"]) for e in exps if e.get("recurring_id")), 2)

    by_member: Dict[str, float] = {}
    if scope == "household":
        for e in exps:
            by_member[e["added_by"]] = by_member.get(e["added_by"], 0) + float(e["total"])

    lo, hi = _month_bounds(month)
    days = (date.fromisoformat(hi) - date.fromisoformat(lo)).days
    plo, phi = _month_bounds(_prev_month(month))
    pdays = (date.fromisoformat(phi) - date.fromisoformat(plo)).days
    prev_cum = _cumulative(prev, plo, pdays)

    # ---- Karşılaştırma AYNI GÜNE kadar ----
    #
    # Önceki hesap bu ayın **şu ana kadarki** toplamını geçen ayın **tam**
    # toplamıyla karşılaştırıyordu: ayın 5'inde bakan herkes "%80 azalış"
    # görüyordu, ay bitmediği için. Ancak ayın son gününde düzeliyordu.
    #
    # Doğrusu kümülatif eğrinin zaten yaptığı şey: geçen ayın aynı gününde
    # neredeydik. Geçmiş bir aya bakılıyorsa iki ay da tamdır, kesit gerekmez.
    #
    # Geçen ay kısaysa (31 → 30) son gün kullanılır; eksik gün uydurulmaz.
    prev_same_day = prev_total
    if month == month_key(today):
        kesit = [r for r in prev_cum if r["day"][8:10] <= f"{today.day:02d}"]
        prev_same_day = kesit[-1]["total"] if kesit else 0.0
    change = (
        round((total - prev_same_day) / prev_same_day * 100)
        if prev_same_day > 0.005 else None
    )
    # Gün sayısı: geçmiş ayda ayın tamamı, içinde bulunulan ayda bugüne kadar.
    # "Günde ortalama" Anasayfa'dan kalktı ama eğri ve kıyas metni bunu okuyor.
    elapsed = today.day if month == month_key(today) else days

    # Ay seçicisinin dolaşabileceği aylar: veri olan aylar + içinde bulunulan.
    all_rows = await db.expenses.find(
        {"household_id": hh["household_id"]},
        {"_id": 0, "expense_date": 1, "created_at": 1},
    ).to_list(5000)
    months = sorted({_expense_day(e)[:7] for e in all_rows} | {month_key(today)}, reverse=True)

    members = uyeler if scope == "household" else [user["user_id"]]

    bd = _breakdown(exps)
    pbd = _breakdown(prev)
    # Kategori ay-ay değişimi. Geçen ay hiç yoksa "yeni", vardı ve şimdi yoksa
    # listede görünmüyor -- olmayan bir şeyin yüzdesi yanıltıcı olur.
    # Rozet ISTISNA icindir. Gecen ay hic veri yoksa her kategori "yeni"
    # olurdu ve sekiz satirin sekizinde rozet gorunurdu; o noktada rozet
    # bilgi tasimayi birakip gurultuye donusuyor.
    gecmis_var = prev_total > 0.005
    cat_rows = []
    for k, v in bd["cats"].items():
        if v <= 0.005:
            continue
        pv = pbd["cats"].get(k, 0.0)
        cat_rows.append({
            "key": k, "total": round(v, 2), "prev_total": round(pv, 2),
            "change_pct": round((v - pv) / pv * 100) if pv > 0.005 else None,
            # Yalnizca karsilastirilacak bir gecmis varken "yeni" denebilir.
            "is_new": bool(gecmis_var and pv <= 0.005),
        })
    cat_rows.sort(key=lambda x: -x["total"])

    # Düzenli giderlerin ay ay seyri. Asıl merak edilen kesit bu: kira zaten
    # değişmiyor, ama elektrik geçen ay 60 iken bu ay 90 olduysa insan sebebini
    # sorar. Kategori değişimiyle aynı dil, farklı kaynak.
    #
    # Tutarı değişmeyen şablonlar listeden düşüyor: "kira 1200, geçen ay da
    # 1200" satırı her ay aynı şeyi söyler ve listeyi doldurup asıl değişeni
    # gizler. Zam gelirse kendiliğinden görünür hale geliyor.
    bills = []
    if scope == "household":
        tpl_names = {
            t["recurring_id"]: t
            for t in await db.recurring.find(
                {"household_id": hh["household_id"]},
                {"_id": 0, "recurring_id": 1, "name": 1, "amount_fixed": 1},
            ).to_list(200)
        }
        cur_by: Dict[str, float] = {}
        prev_by: Dict[str, float] = {}
        for e in exps:
            if e.get("recurring_id"):
                cur_by[e["recurring_id"]] = cur_by.get(e["recurring_id"], 0) + float(e["total"])
        for e in prev:
            if e.get("recurring_id"):
                prev_by[e["recurring_id"]] = prev_by.get(e["recurring_id"], 0) + float(e["total"])
        for rid, v in cur_by.items():
            pv = prev_by.get(rid, 0.0)
            change = round((v - pv) / pv * 100) if pv > 0.005 else None
            if change == 0:
                continue
            tpl = tpl_names.get(rid) or {}
            bills.append({
                "recurring_id": rid,
                "name": tpl.get("name") or "Düzenli gider",
                "amount_fixed": bool(tpl.get("amount_fixed", True)),
                "total": round(v, 2), "prev_total": round(pv, 2),
                "change_pct": change,
            })
        bills.sort(key=lambda b: -abs(b["change_pct"] or 0))

    son_aylar = await _aylik_seri(
        hh["household_id"], month, scope, user["user_id"], uyeler, 6)
    urunler = _urunler(exps)

    # Ev harcamalarında bu kişinin payı
    my_share = 0.0
    if scope == "household":
        for e in exps:
            my_share += expense_shares(e, members).get(user["user_id"], 0.0)
    my_personal = round(sum(
        float(e["total"]) for e in await _month_expenses(
            hh["household_id"], month, "self", user["user_id"], uyeler)), 2)

    return {
        **empty,
        "total": total,
        "expense_count": len(exps),
        "prev_total": prev_total,
        "prev_month": _prev_month(month),
        "change_pct": change,
        # Karşılaştırılan sayı ekranda YAZILIYOR ("geçen ayın 16'sında
        # 1.108 €"), çünkü "%12" tek başına neyin yüzdesi olduğunu
        # söylemiyordu. Görünen sayı doğrulanabilir olmalı.
        "prev_same_day": round(prev_same_day, 2),
        "days": days,
        "elapsed_days": elapsed,
        "fixed": fixed,
        "variable": round(total - fixed, 2),
        "member_count": len(members),
        "per_person": round(total / max(len(members), 1), 2),
        "by_member": sorted(
            [{"user_id": k, "total": round(v, 2)} for k, v in by_member.items()],
            key=lambda x: -x["total"]),
        "cumulative": _cumulative(exps, lo, days),
        # Geçen ayın eğrisi yukarıda bir kez hesaplandı; karşılaştırma da
        # oradan çıkıyor, iki yerde ayrı hesaplanmıyor.
        # Geçen ayın eğrisi arkada gölge olarak çiziliyor. Ayları aynı gün
        # sayısına indirgemiyoruz: 28 günlük şubatı 31'e germek yanlış bir
        # eğri üretir, kısa ay kısa çizilsin.
        "prev_cumulative": prev_cum,
        "months": months,
        # Son 6 ay — TEK okumadan. `_month_expenses`'i altı kez çağırmak
        # koleksiyonu altı kez okumak demekti; `_aylik_seri` bunu bir okumaya
        # indiriyor ve kapsam kuralını `_kapsa` ile paylaşıyor, yani
        # çubuktaki ay ile o aya girildiğindeki toplam ayrışamaz.
        "son_aylar": son_aylar,
        # Ürün bazlı toplam. Tur 8'in genel ürün adı işi sayesinde üç
        # marketin kendi markası ("MILSANI", "MILBONA", "JA!") tek satırda
        # toplanıyor. Karşılaştırmaya ihtiyacı yok, ilk aydan itibaren dolu.
        # İKİ SIRALAMA da gönderiliyor, biri kesilip istemcide yeniden
        # sıralanmıyor: ucuz ama sık alınan bir ürün (ekmek) tutar
        # sıralamasının ilk sekizinde hiç olmayabilir. Tek liste gönderip
        # istemcide sıklığa göre dizmek o ürünü kaybederdi.
        "products": urunler[:5],
        "products_frequent": sorted(
            urunler, key=lambda x: (-x["count"], -x["total"]))[:5],
        "product_count": len(urunler),
        "categories": cat_rows,
        # `key` NORMALİZE anahtar, `name` ekranda görünen ad. Market sayfası
        # anahtarla açılıyor: "BIZIM FLEISCHER GMBH" ile "BIZIM FLEISCHER"
        # aynı market ve ham adla açılsaydı ikisi ayrı sayfa olurdu.
        #
        # `prev_total` kategori kartındaki değişim diliyle aynı işi yapıyor:
        # "markete geçen aydan çok mu gidiyoruz" sorusu, kategoriler için
        # sorulan sorunun aynısı.
        "merchants": sorted(
            [{"key": k, "name": bd["merchant_names"].get(k, k),
              "total": round(v, 2),
              "prev_total": round(pbd["merchants"].get(k, 0.0), 2)}
             for k, v in bd["merchants"].items()],
            key=lambda x: -x["total"])[:8],
        # Senin toplam çıkışın: ev harcamalarındaki payın + kişisel harcaman.
        # Oran değil toplam: "kişiselin evin %35'i" garip bir sayı, "bu ay
        # toplam 720 € harcadın" gerçek bir soruya cevap.
        "bills": bills,
        "my_share": round(my_share, 2),
        "my_personal": my_personal,
    }


@api.get("/stats/products")
async def product_stats(
    month: Optional[str] = None,
    scope: str = "household",
    user=Depends(get_current_user),
):
    """Bir ayın TÜM ürünleri — "En Çok Aldıklarımız"ın arkasındaki liste.

    `/stats/monthly` ilk sekizi gönderiyor; bu uç tamamını veriyor. Ayrı
    durmasının sebebi maliyet: her açılışta yüzlerce satır taşımanın anlamı
    yok, ama "tüm ürünler" sayfasına giren de kesilmiş bir liste istemiyor.
    """
    hh = await get_user_household(user["user_id"])
    if not hh:
        return {"month": month, "products": []}
    month = month if (month and len(month) == 7) else month_key(ev_bugun(hh))
    uyeler = await period_participants(
        hh["household_id"],
        (await get_active_period(hh["household_id"]) or {}).get("period_id", ""),
        hh["member_ids"],
    )
    exps = await _month_expenses(hh["household_id"], month, scope, user["user_id"], uyeler)
    return {"month": month, "scope": scope, "products": _urunler(exps)}


def _arama_anahtari(s: str) -> str:
    """Serbest metni, ürün ve market anahtarlarıyla AYNI biçime indirger.

    Yol bilerek `product_key()` ile aynı: `_fold_german` + `_FOLD` + harf/rakam
    dışını boşluğa çevir. Böylece "sut" → "süt", "SUTU" → "sutu", "Kaufland"
    → "kaufland" oluyor ve kullanıcı Türkçe karakterleri yazmak zorunda
    kalmıyor. Aramada bu şart: telefon klavyesinde "ü" bulmak bir engel ve
    engelin ödülü sıfır.

    `product_key`'den tek farkı boyutu SÖKMEMESİ — "1 lt süt" yazan biri
    "lt"yi de kastediyor olabilir ve elemek yerine eşleşmeye bırakmak daha az
    varsayım.
    """
    t = _fold_german(s or "").translate(_FOLD)
    t = "".join(ch if ch.isalnum() or ch.isspace() else " " for ch in t)
    return " ".join(t.split())


def _eslesme_sirasi(anahtar: str, q: str) -> Optional[int]:
    """Sorgu bu anahtarla eşleşiyor mu, ne kadar iyi? Küçük olan daha iyi.

    Üç kademe var ve sırası önemli: "su" yazan biri önce **Su**'yu görmeli,
    sonra **Su**cuk'u, en sonda Ku**şsu**yu'nu. Baştan eşleşme insanın
    aklındaki kelimedir; ortadan eşleşme çoğu zaman tesadüftür.

    **Bulanık (fuzzy) eşleşme YOK.** Yazım hatasını tolere etmek 400 ürünlük
    bir listede yanlış satırları da yukarı taşır ve bu projede kural zaten
    yazılı: *yanlış birleştirmek, birleştirmemekten pahalı.* Kullanıcı bir
    harf eksik yazdığında hiçbir şey bulamaz ve harfi ekler — yanlış ürünü
    doğru sanmasından iyidir.
    """
    if not q:
        return None
    if anahtar.startswith(q):
        return 0
    if any(w.startswith(q) for w in anahtar.split()):
        return 1
    if q in anahtar:
        return 2
    return None


def _ay_araligi(exps: List[dict]) -> tuple:
    """Bu kayıtların ilk ve son ayı — `("2026-03", "2026-08")`."""
    aylar = sorted({(_expense_day(e) or "")[:7] for e in exps if _expense_day(e)})
    return (aylar[0], aylar[-1]) if aylar else (None, None)


@api.get("/search")
async def search(q: str = "", user=Depends(get_current_user)):
    """Ürün · market · kişi araması — **bütün geçmişte.**

    ### Neden var

    Her ekran takvim ayına kilitli. "Sütü en son ne zaman aldık, kaça?"
    sorusunun bugün cevabı yok: kullanıcı ayları tek tek gezmek zorunda ve 49
    ürün 400 olduğunda bu imkânsızlaşıyor. Aramanın varlık sebebi **ayı
    aşması**; yalnızca bulunduğu ayı süzseydi zaten var olan listeye ikinci
    bir yol olurdu.

    Bu yüzden her satır bir ZAMAN ARALIĞI taşıyor ("Mart – Ağustos"), tek bir
    ay değil.

    ### Neden Mongo metin indeksi değil

    Eşleştirme Python'da, evin tüm kayıtları üzerinde. Ölçek bunu kaldırıyor:
    bir ev yılda ~600 fiş üretiyor. Metin indeksi ürün adlarını **ham** hâliyle
    indeksler, oysa gruplama `generic` + `product_key` üzerinden yapılıyor —
    indeks "MILBONA VOLLMILCH" bulur, kullanıcının aradığı "Süt" ise
    veritabanında hiçbir belgede yazmıyor. Yani indeks daha hızlı ama **yanlış
    şeyi** arardı.

    Ürün ve market toplamları `_urunler()` ve `_breakdown()`'dan geliyor —
    Analiz sayfasıyla aynı fonksiyonlar. Arama sonucundaki "Süt 62,40 €" ile
    Tüm Ürünler'deki satırın ayrışması bu yüzden mümkün değil.
    """
    hh = await get_user_household(user["user_id"])
    anahtar = _arama_anahtari(q)
    bos = {"q": q, "products": [], "merchants": [], "members": []}
    # İki harften kısa sorgu her şeyle eşleşiyor ve sonuç listesi rastgele
    # görünüyor; kullanıcı "arama bozuk" diye okuyor.
    if not hh or len(anahtar) < 2:
        return bos

    exps = await db.expenses.find(
        {"household_id": hh["household_id"], **_visible_filter(user["user_id"])},
        {"_id": 0},
    ).sort("expense_date", -1).to_list(3000)

    # --- Ürünler ---
    urunler = []
    for u in _urunler(exps):
        sira = _eslesme_sirasi(_arama_anahtari(u["name"]), anahtar)
        if sira is None:
            sira = _eslesme_sirasi(u["key"], anahtar)
        if sira is None:
            continue
        ilgili = [
            e for e in exps
            if any(
                (product_key((i.get("generic") or "").strip())
                 if (i.get("generic") or "").strip()
                 else product_key((i.get("name") or "").strip())) == u["key"]
                for i in (e.get("items") or [])
            )
        ]
        ilk, son = _ay_araligi(ilgili)
        urunler.append({**u, "sira": sira, "first_month": ilk, "last_month": son})
    urunler.sort(key=lambda x: (x["sira"], -x["total"]))

    # --- Marketler ---
    bd = _breakdown(exps)
    marketler = []
    for mkey, tutar in bd["merchants"].items():
        ad = bd["merchant_names"].get(mkey, mkey)
        sira = _eslesme_sirasi(_arama_anahtari(ad), anahtar)
        if sira is None:
            sira = _eslesme_sirasi(_arama_anahtari(mkey), anahtar)
        if sira is None:
            continue
        ilgili = [
            e for e in exps
            if (normalize_merchant((e.get("merchant") or "Diğer").strip() or "Diğer")
                or ((e.get("merchant") or "Diğer").strip() or "Diğer").casefold()) == mkey
        ]
        ilk, son = _ay_araligi(ilgili)
        marketler.append({
            "key": mkey, "name": ad, "total": round(tutar, 2),
            "receipts": len(ilgili), "first_month": ilk, "last_month": son,
            "sira": sira,
        })
    marketler.sort(key=lambda x: (x["sira"], -x["total"]))

    # --- Kişiler ---
    # Ev arkadaşları isimden aranıyor; sonuç o kişinin ay dökümüne götürüyor.
    uyeler = await db.users.find(
        {"user_id": {"$in": hh.get("member_ids", [])}},
        {"_id": 0, "user_id": 1, "name": 1},
    ).to_list(50)
    kisiler = []
    for m in uyeler:
        sira = _eslesme_sirasi(_arama_anahtari(m.get("name") or ""), anahtar)
        if sira is not None:
            kisiler.append({"user_id": m["user_id"], "name": m.get("name") or "?", "sira": sira})
    kisiler.sort(key=lambda x: x["sira"])

    return {
        "q": q,
        "products": urunler[:12],
        "merchants": marketler[:8],
        "members": kisiler[:5],
    }


def _urun_anahtari(item: dict) -> Optional[str]:
    """Bir fiş kaleminin ürün anahtarı — `_urunler()` ile birebir aynı kural.

    Genel ad önce (`generic`), yoksa ham ad. Üç yerde tekrarlanıyordu; ayrışsa
    arama sonucu ile ürün sayfası farklı ürünleri "aynı" sayardı.
    """
    genel = (item.get("generic") or "").strip()
    return product_key(genel) if genel else product_key((item.get("name") or "").strip())


@api.get("/stats/product")
async def product_detail(key: str, user=Depends(get_current_user)):
    """Tek bir ürünün BÜTÜN geçmişi — aramanın varış yeri.

    Bugün ürünlerin gideceği bir yer yok: "Tüm Ürünler" sayfasındaki satırlar
    dokunulamıyor ve her ekran tek aya bakıyor. Oysa ürün hakkında insanın
    sorduğu üç soru da zamanın içinde: **ne zaman aldık · nereden aldık ·
    kaça.**

    Aylar listesi BOŞ ayları da taşıyor. "Nisan'da hiç almadık" bir bilgi;
    yalnızca dolu ayları göndermek çubukları yan yana dizip aralarındaki
    boşluğu siler ve düzenli alınan bir ürünle iki kez alınan ürün aynı
    görünür.

    Birim fiyat MEDYAN: bir kampanyalı alışveriş ortalamayı aşağı çekip
    "ucuzladı" dedirtiyor. Birimler karışıksa (kg + paket) hiç
    gösterilmiyor — 2 kg un ile 3 paket unu toplayan sayı hiçbir şey demek
    değil.
    """
    hh = await get_user_household(user["user_id"])
    if not hh or not key:
        return {"key": key, "name": None, "months": [], "merchants": []}

    exps = await db.expenses.find(
        {"household_id": hh["household_id"], **_visible_filter(user["user_id"])},
        {"_id": 0},
    ).sort("expense_date", -1).to_list(3000)

    ad, toplam, adet, miktar = None, 0.0, 0, 0.0
    birimler: Dict[str, int] = {}
    aylar: Dict[str, dict] = {}
    marketler: Dict[str, dict] = {}
    # Birim fiyatlar PAKET SINIFINA göre ayrı kovalarda. Açık (kilo fiyatı)
    # ile paketliyi aynı seride toplamak "fiyat iki katına çıktı" gibi yalan
    # üretir — değişen fiyat değil ambalajdır. `adet` sınıfı hiç alınmıyor:
    # boyutu bilinmeyen sayılabilir ürün, iki farklı boy karpuzu
    # karşılaştırılabilir sanıyordu (Tur 11'de fiyat kartından da çıkarıldı).
    birim_fiyatlar: Dict[str, List[float]] = {}
    genel_gorulmus = False

    for e in exps:
        items = e.get("items") or []
        if not items:
            continue
        gun = _expense_day(e) or ""
        ay = gun[:7]
        item_sum = sum(float(i.get("price", 0)) * float(i.get("quantity", 1) or 1) for i in items)
        fis_toplam = float(e["total"])
        ham_market = (e.get("merchant") or "Diğer").strip() or "Diğer"
        mkey = normalize_merchant(ham_market) or ham_market.casefold()

        for i in items:
            if _urun_anahtari(i) != key:
                continue
            satir = float(i.get("price", 0)) * float(i.get("quantity", 1) or 1)
            tutar = satir / item_sum * fis_toplam if item_sum else satir
            genel = (i.get("generic") or "").strip()
            ham = (i.get("name") or "").strip()
            # Gösterilecek ad: genel ad varsa o, yoksa ham adların en kısası —
            # `_urunler()` ile aynı kural.
            if genel:
                ad, genel_gorulmus = genel, True
            elif not genel_gorulmus and (ad is None or len(ham) < len(ad)):
                ad = ham

            toplam += tutar
            adet += 1
            mik = float(i.get("quantity", 1) or 1)
            miktar += mik
            birim = (i.get("unit") or "adet").strip() or "adet"
            birimler[birim] = birimler.get(birim, 0) + 1

            a = aylar.setdefault(ay, {"month": ay, "total": 0.0, "qty": 0.0, "count": 0})
            a["total"] += tutar; a["qty"] += mik; a["count"] += 1

            m = marketler.setdefault(mkey, {"key": mkey, "name": ham_market,
                                            "total": 0.0, "qty": 0.0, "count": 0})
            if len(ham_market) < len(m["name"]):
                m["name"] = ham_market
            m["total"] += tutar; m["qty"] += mik; m["count"] += 1

            p = price_of_item(i)
            if p and p.get("unit_price") and p.get("price_unit") in ("kg", "lt"):
                birim_fiyatlar.setdefault(p["price_unit"], []).append(float(p["unit_price"]))

    if not aylar:
        return {"key": key, "name": None, "months": [], "merchants": []}

    # Aradaki BOŞ aylar da dolduruluyor (yukarıdaki gerekçe).
    ilk, son = min(aylar), max(aylar)
    dizi, imleç = [], date.fromisoformat(ilk + "-01")
    bitis = date.fromisoformat(son + "-01")
    while imleç <= bitis:
        k = imleç.strftime("%Y-%m")
        v = aylar.get(k)
        dizi.append({"month": k,
                     "total": round(v["total"], 2) if v else 0.0,
                     "qty": round(v["qty"], 2) if v else 0.0,
                     "count": v["count"] if v else 0})
        imleç = (imleç.replace(day=28) + timedelta(days=8)).replace(day=1)

    karisik = len(birimler) > 1
    baskin = max(birimler, key=birimler.get) if birimler else None
    return {
        "key": key,
        "name": (ad[:1].upper() + ad[1:]) if ad else "?",
        "total": round(toplam, 2),
        "count": adet,
        "qty": None if karisik else round(miktar, 2),
        "unit": None if karisik else baskin,
        # Yalnızca TEK bir fiyat birimi varsa gösteriliyor. Bir ürün hem kilo
        # hem litre olarak alındıysa (nadir ama mümkün) hangisini yazacağımız
        # belirsiz; uydurmak yerine satır hiç çizilmiyor.
        "unit_price": (round(_medyan(next(iter(birim_fiyatlar.values()))), 2)
                       if len(birim_fiyatlar) == 1 else None),
        "price_unit": next(iter(birim_fiyatlar)) if len(birim_fiyatlar) == 1 else None,
        "first_month": ilk,
        "last_month": son,
        "months": dizi,
        "merchants": sorted(
            [{**m, "total": round(m["total"], 2), "qty": round(m["qty"], 2)}
             for m in marketler.values()],
            key=lambda x: -x["total"]),
    }


def _medyan(sayilar: List[float]) -> float:
    """Ortanca. Ortalama DEĞİL, ve fark burada kritik.

    Bir ürün ay içinde iki kez alınıp biri kampanyalıysa ortalama o kampanyayı
    fiyata karıştırır: ay "ucuzladı" der, ertesi ay kampanya bitince
    "zamlandı" der. İkisi de yalan. Medyan tek bir kampanyalı alışverişten
    etkilenmiyor.
    """
    s = sorted(sayilar)
    n = len(s)
    if n == 0:
        return 0.0
    orta = n // 2
    return s[orta] if n % 2 else (s[orta - 1] + s[orta]) / 2


@api.get("/stats/prices")
async def price_moves(
    month: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Zamlananlar ve ucuzlayanlar — **evin kendi sepetinin enflasyonu.**

    Resmî enflasyon herkesin sepetidir; bu, sizinki. Rakiplerin hiçbirinde
    yok çünkü hiçbiri fişi kalem kalem okumuyor.

    ### Karşılaştırma AYNI MARKET içinde

    Marketler arası karşılaştırma yapısal olarak sağlam değil: barkod
    olmadan fiyat farkını değil *ürün farkını* ölçersiniz (süt her markette
    kendi markası altında, aynı gramajlı biber birinde tepside ötekinde
    açık). Aynı marketin içinde ise fiş metnini o marketin kasası üretir,
    yani dizgi haftadan haftaya sabittir ve karşılaştırma anlamlıdır.

    ### Ayın son fiyatı değil MEDYANI

    Kampanyalı bir hafta "ucuzladı" deyip ertesi ay "zamlandı" demesin diye.

    ### Ambalaj sınıfı ayrı tutuluyor

    `price_of_item` üç sınıf üretiyor — açık (tartılan), paketli, adet.
    Açık ile paketliyi aynı seride toplamak "fiyat iki katına çıktı" gibi
    yanlış uyarılar üretir: değişen fiyat değil ambalajdır.

    ### Kaynak `price_points` DEĞİL

    O koleksiyon bilerek kimlik alanı taşımıyor, yani "bu evin fiyat
    geçmişi" oradan çıkarılamaz. Kaynak evin kendi `expenses` kayıtları.
    """
    hh = await get_user_household(user["user_id"])
    bos = {"month": month, "up": [], "down": [], "threshold": 8}
    if not hh:
        return bos
    month = month if (month and len(month) == 7) else month_key(ev_bugun(hh))
    onceki = _prev_month(month)

    lo, _ = _month_bounds(onceki)
    _, hi = _month_bounds(month)
    rows = await db.expenses.find(
        {"household_id": hh["household_id"], "source": "receipt"}, {"_id": 0}
    ).to_list(5000)
    rows = [e for e in rows if lo <= _expense_day(e) < hi]

    # (market, ürün anahtarı, ambalaj sınıfı) -> ay -> [birim fiyatlar]
    kova: Dict[tuple, Dict[str, List[float]]] = {}
    adlar: Dict[tuple, str] = {}
    for e in rows:
        ham = (e.get("merchant") or "").strip()
        if not ham:
            continue
        market = normalize_merchant(ham) or ham.casefold()
        ay = _expense_day(e)[:7]
        for it in e.get("items") or []:
            p = price_of_item(it)
            if not p:
                continue
            # `adet` SINIFI DIŞARIDA — gerçek veride ölçülüp öyle karar
            # verildi. O sınıfta boyut bilinmiyor, yani fiyat farkı ÜRÜN
            # farkı olabiliyor. Bu evin verisinde çıkan satırlar birebir
            # şunlardı ve hiçbiri zam değildi:
            #
            #   Wassermel. XXL   6,00 -> 10,60  (+%77)  iki farklı boy karpuz
            #   Tomaten Strauch  1,11 ->  1,85  (+%67)  tartılan, adet yazılmış
            #   Banane lose      0,73 ->  0,59  (-%19)  tartılan, adet yazılmış
            #
            # Yanlış uyarı vermek, hiç uyarmamaktan pahalı: bir kez "zam"
            # deyip yanılan kart bir daha okunmaz. `paketli` (boyut adın
            # içinde) ve `acik` (kasada tartılan, fiyat zaten kilo fiyatı)
            # sınıflarında böyle bir belirsizlik yok.
            if p["pack_type"] == "adet":
                continue
            # Genel ad varsa onunla, yoksa ham addan üretilen anahtarla:
            # marka değişse bile aynı seri.
            urun = p.get("generic_key") or p["product_key"]
            k = (market, urun, p["pack_type"], p["price_unit"])
            kova.setdefault(k, {}).setdefault(ay, []).append(p["unit_price"])
            # Ekranda gösterilecek ad: genel ad varsa o, yoksa en kısa ham ad.
            gorunen = p.get("generic") or p["product"]
            onceki_ad = adlar.get(k)
            if onceki_ad is None or len(gorunen) < len(onceki_ad):
                adlar[k] = gorunen

    ESIK = 8  # yüzde. Altındaki oynamalar yuvarlama ve kampanya gürültüsü.
    yukari, asagi = [], []
    for k, aylar in kova.items():
        simdi, gecen = aylar.get(month), aylar.get(onceki)
        # İKİ AYDA DA alınmış olmalı: tek ayda görülen üründe değişim
        # hesaplanamaz ve "yeni" demek de bir fiyat hareketi değildir.
        if not simdi or not gecen:
            continue
        y = _medyan(simdi)
        o = _medyan(gecen)
        if o <= 0.0001:
            continue
        fark = round((y - o) / o * 100)
        if abs(fark) < ESIK:
            continue
        market, urun, ambalaj, birim = k
        satir = {
            "key": urun, "name": adlar.get(k, urun),
            "merchant": market, "pack_type": ambalaj,
            "unit": birim, "now": round(y, 2), "prev": round(o, 2),
            "change_pct": fark,
            # Kaç ölçüme dayandığı ekranda gösterilmiyor ama az ölçüme
            # dayanan satır listenin dibine düşsün diye sıralamada var.
            "samples": len(simdi) + len(gecen),
        }
        (yukari if fark > 0 else asagi).append(satir)

    yukari.sort(key=lambda x: -x["change_pct"])
    asagi.sort(key=lambda x: x["change_pct"])
    return {"month": month, "prev_month": onceki,
            "up": yukari, "down": asagi, "threshold": ESIK}


@api.get("/stats/merchant")
async def merchant_stats(
    name: str,
    month: Optional[str] = None,
    scope: str = "household",
    user=Depends(get_current_user),
):
    """Bir marketin içi: **ne kadar · kaç fiş · ortalama fiş · ne aldık.**

    `name` NORMALİZE anahtar bekliyor (`normalize_merchant` çıktısı), ham ad
    değil. Sebebi somut: "BIZIM FLEISCHER GMBH" ile "BIZIM FLEISCHER" aynı
    market ve ham adla sorulsaydı ikisi ayrı sayfa açardı.

    **Ortalama fiş** burada anlamlı bir sayı: aynı markete 40 € bırakmak,
    dört kez 10 € bırakmakla aynı şey değil. Toplam ikisinde de aynı ama
    alışkanlık farklı.
    """
    hh = await get_user_household(user["user_id"])
    bos = {"name": name, "month": month, "total": 0, "expense_count": 0,
           "avg_expense": 0, "series": [], "categories": [], "products": [],
           "expenses": []}
    if not hh:
        return bos
    month = month if (month and len(month) == 7) else month_key(ev_bugun(hh))
    uyeler = await period_participants(
        hh["household_id"],
        (await get_active_period(hh["household_id"]) or {}).get("period_id", ""),
        hh["member_ids"],
    )

    def bu_market(exps: List[dict]) -> List[dict]:
        out = []
        for e in exps:
            ham = (e.get("merchant") or "").strip()
            if not ham:
                continue
            if (normalize_merchant(ham) or ham.casefold()) == name:
                out.append(e)
        return out

    ilk = await db.expenses.find(
        {"household_id": hh["household_id"], "expense_date": {"$ne": None}},
        {"_id": 0, "expense_date": 1},
    ).sort("expense_date", 1).limit(1).to_list(1)
    alt_sinir = ilk[0]["expense_date"][:7] if ilk and ilk[0].get("expense_date") else None

    aylar = []
    y, m = int(month[:4]), int(month[5:7])
    for _ in range(6):
        a = f"{y:04d}-{m:02d}"
        if alt_sinir and a < alt_sinir:
            break
        aylar.append(a)
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    aylar.reverse()

    seri, bu_ay = [], []
    for a in aylar:
        kayit = bu_market(
            await _month_expenses(hh["household_id"], a, scope, user["user_id"], uyeler))
        seri.append({"month": a, "total": round(sum(float(e["total"]) for e in kayit), 2)})
        if a == month:
            bu_ay = kayit

    toplam = round(sum(float(e["total"]) for e in bu_ay), 2)
    dokum = _breakdown(bu_ay)
    return {
        "name": name, "month": month, "scope": scope,
        "total": toplam,
        "expense_count": len(bu_ay),
        # Ortalama fiş: aynı markete 40 € bırakmak ile dört kez 10 € bırakmak
        # toplamda aynı, alışkanlıkta değil.
        "avg_expense": round(toplam / len(bu_ay), 2) if bu_ay else 0,
        "series": seri,
        "categories": sorted(
            [{"key": k, "total": round(v, 2)} for k, v in dokum["cats"].items()],
            key=lambda x: -x["total"]),
        "products": _urunler(bu_ay)[:12],
        # Kalemler de geliyor: fiş market sayfasında YERİNDE açılıyor, ayrı
        # bir istek atmıyor. Bir ayda tek markette az sayıda fiş oluyor, yük
        # ihmal edilebilir.
        "expenses": sorted(
            [{"expense_id": e["expense_id"], "total": round(float(e["total"]), 2),
              "expense_date": _expense_day(e), "added_by": e["added_by"],
              "item_count": len(e.get("items") or []),
              "items": e.get("items") or []} for e in bu_ay],
            key=lambda x: x["expense_date"], reverse=True),
    }


@api.get("/stats/category")
async def category_stats(
    key: str,
    month: Optional[str] = None,
    scope: str = "household",
    user=Depends(get_current_user),
):
    """Bir kategorinin içi: **6 aylık seyir · ne alındı · nereden.**

    Halkanın dilimine dokununca açılıyor. Üç soruya birden cevap veriyor
    çünkü üçü de aynı merakın parçası: "market kategorisine 312 € gitmiş" ->
    *artıyor mu*, *ne aldık*, *nereden aldık*.

    Kalemler fişin toplamına ölçekleniyor (`_breakdown` ile aynı kural):
    indirim satırları ve yuvarlama yüzünden kalem toplamı fiş toplamını
    tutmuyor ve ölçeklenmezse kategori sayfası halkadaki dilimle çelişir.
    """
    hh = await get_user_household(user["user_id"])
    bos = {"key": key, "month": month, "total": 0, "series": [],
           "products": [], "merchants": [], "expense_count": 0}
    if not hh:
        return bos
    month = month if (month and len(month) == 7) else month_key(ev_bugun(hh))
    uyeler = await period_participants(
        hh["household_id"],
        (await get_active_period(hh["household_id"]) or {}).get("period_id", ""),
        hh["member_ids"],
    )

    def kategoriye_indir(exps: List[dict]) -> List[dict]:
        """Harcamaları bu kategoriye düşen KISMA indirger.

        Bir fişin yalnızca bir bölümü bu kategoride olabilir (markette hem
        süt hem deterjan). Fişi olduğu gibi saymak kategori toplamını şişirir;
        `total` o fişin bu kategorideki payına ayarlanıyor ve `items` da
        yalnızca o kategorinin kalemleriyle kalıyor.
        """
        out = []
        for e in exps:
            items = e.get("items") or []
            tam = float(e["total"])
            item_sum = sum(float(i.get("price", 0)) * float(i.get("quantity", 1) or 1)
                           for i in items)
            if items and item_sum:
                benim = [i for i in items if (i.get("category") or "diger") == key]
                if not benim:
                    continue
                pay = sum(float(i.get("price", 0)) * float(i.get("quantity", 1) or 1)
                          for i in benim)
                out.append({**e, "items": benim,
                            "total": round(pay / item_sum * tam, 2)})
            elif key == "diger":
                # Kalemi olmayan harcama (elle giriş, düzenli ödeme) "diğer"e
                # düşüyor — `_breakdown` ile aynı kural.
                out.append(e)
        return out

    # Seri evin ilk harcamasından öncesine inmiyor — `_aylik_seri` ile aynı
    # kural. Ağustos'ta kurulan bir eve "Mart 0 €" yazmak o ay hiç
    # harcamadığını söylemek olur, oysa o ay ortada yoktun; üstelik ortalama
    # da o sahte sıfırlarla aşağı çekiliyordu.
    ilk = await db.expenses.find(
        {"household_id": hh["household_id"], "expense_date": {"$ne": None}},
        {"_id": 0, "expense_date": 1},
    ).sort("expense_date", 1).limit(1).to_list(1)
    alt_sinir = ilk[0]["expense_date"][:7] if ilk and ilk[0].get("expense_date") else None

    aylar = []
    y, m = int(month[:4]), int(month[5:7])
    for _ in range(6):
        a = f"{y:04d}-{m:02d}"
        if alt_sinir and a < alt_sinir:
            break
        aylar.append(a)
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    aylar.reverse()

    seri = []
    bu_ay: List[dict] = []
    for a in aylar:
        ham = await _month_expenses(hh["household_id"], a, scope, user["user_id"], uyeler)
        kat = kategoriye_indir(ham)
        seri.append({"month": a, "total": round(sum(float(e["total"]) for e in kat), 2)})
        if a == month:
            bu_ay = kat

    dokum = _breakdown(bu_ay)
    return {
        "key": key, "month": month, "scope": scope,
        "total": round(sum(float(e["total"]) for e in bu_ay), 2),
        "expense_count": len(bu_ay),
        "series": seri,
        "products": _urunler(bu_ay),
        "merchants": sorted(
            [{"name": dokum["merchant_names"].get(k, k), "total": round(v, 2)}
             for k, v in dokum["merchants"].items()],
            key=lambda x: -x["total"]),
    }


# ---------- Periods ----------
@api.get("/periods")
async def list_periods(user=Depends(get_current_user)):
    hh = await get_user_household(user["user_id"])
    if not hh:
        return {"periods": []}
    periods = await db.periods.find({"household_id": hh["household_id"]}, {"_id": 0}).sort(
        "started_at", -1
    ).to_list(200)

    # Donemin HARCAMA araligi ve hacmi.
    #
    # Etikette `started_at` kullanmak yetmiyor: ev kurulup ilk donem kapatildigi
    # gun ayni gunse "3 Agu - 3 Agu" ciKiyor ve iki donem ayirt edilemiyor.
    # Insanin hatirladigi sey donem kaydinin damgasi degil, alisveris yapilan
    # gunler. Toplam da geliyor cunku tarih araligi tek basina hafizayi
    # tetiklemiyor -- bankacilik uygulamalarinin ekstre secicileri de araligin
    # yanina tutari koyuyor.
    # GIZLILIK: once bu ozet HER harcamayi sayiyordu -- baskalarinin "Kendim"
    # harcamalari dahil. Yani donem secicideki tutar, Salih'in kisisel
    # harcamalarinin toplamini da sana gosteriyordu. Doküman bu konuda net:
    # "gizli olmalari gereken seyler varliklarini bile duyurmamalidir."
    #
    # Ayrica TANIM BIRLIGI: burasi artik "ev harcamasi"ni Anasayfa ve
    # Istatistik ile ayni sekilde tanimliyor -- evin tamaminin bolustugu
    # harcamalar. Once dort ayri toplam vardi ve hangisinin ne oldugu
    # anlasilmiyordu.
    hepsi = await db.expenses.find(
        {"household_id": hh["household_id"]}, {"_id": 0}
    ).to_list(20000)
    uyeler = set(hh["member_ids"])
    ozet: Dict[str, dict] = {}
    for e in hepsi:
        pay = expense_shares(e, list(uyeler))
        if not pay:
            continue
        if e.get("target_type") == "self" and set(pay) == {e["added_by"]}:
            continue
        if not (uyeler and uyeler <= set(pay)):
            continue
        gun = _expense_day(e)
        o = ozet.setdefault(e["period_id"], {"ilk": gun, "son": gun, "adet": 0, "toplam": 0.0})
        o["ilk"] = min(o["ilk"], gun)
        o["son"] = max(o["son"], gun)
        o["adet"] += 1
        o["toplam"] += float(e["total"])

    for p in periods:
        o = ozet.get(p["period_id"])
        p["first_expense"] = (o or {}).get("ilk")
        p["last_expense"] = (o or {}).get("son")
        p["expense_count"] = (o or {}).get("adet", 0)
        p["expense_total"] = round(float((o or {}).get("toplam") or 0), 2)

    return {"periods": periods}


SIFIR_ESIK = 0.01
"""Bir kuruş. Bakiyeler iki basamağa yuvarlanıyor; "sıfır" bundan küçük."""


async def _odesme_durumu(household_id: str, period_id: str) -> str:
    """`bos` · `acik` · `odesildi`.

    Dönemin kapanabilmesi için iki koşul birden gerekiyor: gerçekten bir
    hareket olmuş olmalı ve herkesin bakiyesi sıfıra inmiş olmalı. Boş bir
    dönem teknik olarak "ödeşmiş" görünür ama onu kapatmak hiçbir şey
    söylemez — yeni kurulmuş bir evde "Ev ödeşti" yazmak saçma olurdu.
    """
    n = await db.expenses.count_documents(
        {"household_id": household_id, "period_id": period_id}
    )
    if n == 0:
        return "bos"
    snap = await _compute_balances(household_id, period_id)
    kalan = [v for v in (snap.get("net") or {}).values() if abs(float(v)) >= SIFIR_ESIK]
    return "acik" if kalan else "odesildi"


async def _donemi_kapat(hh: dict, period: dict) -> dict:
    """Dönemi arşivler ve yenisini açar. Tek gövde, iki çağıran."""
    # Katılımcı listesi bakiyelerden ÖNCE donuyor: hesap bu listeyle yapıldı,
    # aynı liste kayda geçmezse dönem sonradan başka bir kadroyla yeniden
    # hesaplanabilir hale gelir.
    frozen = await period_participants(
        hh["household_id"], period["period_id"], hh["member_ids"]
    )
    snap = await _compute_balances(hh["household_id"], period["period_id"])
    await db.periods.update_one(
        {"period_id": period["period_id"]},
        {"$set": {
            "status": "closed",
            "closed_at": now_utc(),
            "participant_ids": frozen,
            "final_balances": snap,
        }},
    )
    new_period_id = new_id("per")
    new_period = {
        "period_id": new_period_id,
        "household_id": hh["household_id"],
        "started_at": now_utc(),
        "closed_at": None,
        "status": "active",
        "participant_ids": list(hh["member_ids"]),
    }
    await db.periods.insert_one(new_period.copy())
    await db.households.update_one(
        {"household_id": hh["household_id"]}, {"$set": {"current_period_id": new_period_id}}
    )
    return new_period


async def _odesme_cizgisi(household_id: str, bildir: bool = True) -> None:
    """Bakiye sıfıra değdiyse dönemi KENDİLİĞİNDEN kapatır.

    Eskiden kapatma bir düğmeydi ve bakiyeleri **sıfırlıyordu**: ödeşmeden
    kapatılan bir dönemin borcu canlı ekrandan siliniyor, kayıt arşivde
    kalıyor ama kimse bir daha bakmıyordu. Sessiz bir kayıptı.

    Artık kapanma yalnızca herkes ödeştiğinde oluyor, yani kapanışta
    kaybolacak bir borç kalmıyor. Ödeşilmezse dönem açık kalır ve aylarca
    sürebilir — Kasa'daki "önceki aylardan" satırı da bu yüzden var.

    Hata yutulur: bildirimlerdeki kuralın aynısı. Çizginin çizilememesi
    ödemenin kaydedilmesini engellememeli.
    """
    try:
        hh = await db.households.find_one({"household_id": household_id}, {"_id": 0})
        if not hh:
            return
        period = await get_active_period(household_id)
        if not period:
            return
        if await _odesme_durumu(household_id, period["period_id"]) != "odesildi":
            return
        await _donemi_kapat(hh, period)
        if bildir:
            await notify(
                hh["member_ids"],
                "Ev ödeşti",
                "Kimsenin kimseye borcu kalmadı.",
                "period_closed",
                {"household_id": household_id},
            )
    except Exception as e:  # noqa: BLE001
        logging.warning("odesme cizgisi cizilemedi: %s", e)


@api.post("/periods/close")
async def close_period(user=Depends(get_current_user)):
    """Elle kapatma — artık YALNIZCA herkes ödeştiyse.

    Düğme v43'te arayüzden kalkıyor ama uç duruyor: sahadaki v42 telefonlarda
    düğme hâlâ var ve basılırsa eski davranış (borcu sessizce silmek) geri
    gelirdi. Kural sunucuda olduğu için eski istemciler de korunuyor.
    """
    hh = await require_admin(user["user_id"])
    period = await get_active_period(hh["household_id"])
    if not period:
        raise HTTPException(status_code=400, detail="Aktif dönem yok")

    durum = await _odesme_durumu(hh["household_id"], period["period_id"])
    if durum == "bos":
        raise HTTPException(status_code=400, detail="Bu dönemde henüz harcama yok")
    if durum == "acik":
        raise HTTPException(
            status_code=400,
            detail="Herkes ödeşmeden dönem kapatılamaz. Kalan borçlar Kasa'da görünüyor.",
        )

    new_period = await _donemi_kapat(hh, period)
    await notify(
        [m for m in hh["member_ids"] if m != user["user_id"]],
        "Ev ödeşti",
        f"{user['name']} dönemi kapattı. Kimsenin kimseye borcu kalmadı.",
        "period_closed",
        {"household_id": hh["household_id"]},
    )
    return {"closed_period_id": period["period_id"], "new_period": new_period}


async def _donemi_geri_ac(household_id: str):
    """En son kapanan dönemi yeniden açar; yapılamıyorsa `None`.

    Yalnızca yeni dönem hâlâ boşken güvenli: içine harcama girilmişse geri
    açmak onları güncel olmayan bir dönemde bırakır ve her bakiyeden
    görünmez olurlar.

    İki çağıran var: yöneticinin elle geri alması ve son ödemenin silinmesi
    (kapanmayı o ödeme tetiklemiş olabilir).
    """
    active = await get_active_period(household_id)
    if not active:
        return None
    used = await db.expenses.count_documents(
        {"household_id": household_id, "period_id": active["period_id"]}
    )
    if used:
        return None
    closed = await db.periods.find(
        {"household_id": household_id, "status": "closed"}, {"_id": 0}
    ).sort("closed_at", -1).to_list(1)
    if not closed:
        return None
    previous = closed[0]
    await db.periods.delete_one({"period_id": active["period_id"]})
    await db.periods.update_one(
        {"period_id": previous["period_id"]},
        {"$set": {"status": "active", "closed_at": None}, "$unset": {"final_balances": ""}},
    )
    await db.households.update_one(
        {"household_id": household_id},
        {"$set": {"current_period_id": previous["period_id"]}},
    )
    return await db.periods.find_one({"period_id": previous["period_id"]}, {"_id": 0})


@api.post("/periods/reopen")
async def reopen_period(user=Depends(get_current_user)):
    """Undo the most recent close — for when it was hit by accident.

    Only safe while the fresh period is still empty. Once expenses exist in it,
    reopening would leave them sitting in a period that is no longer current,
    invisible in every balance, so we refuse and say why.
    """
    hh = await require_admin(user["user_id"])
    active = await get_active_period(hh["household_id"])
    if not active:
        raise HTTPException(status_code=400, detail="Aktif dönem yok")

    used = await db.expenses.count_documents(
        {"household_id": hh["household_id"], "period_id": active["period_id"]}
    )
    if used:
        raise HTTPException(
            status_code=400,
            detail=f"Yeni döneme {used} harcama girilmiş. Geri alınamaz, "
                   "önce bu harcamaları silmeniz gerekir.",
        )

    reopened = await _donemi_geri_ac(hh["household_id"])
    if not reopened:
        raise HTTPException(status_code=400, detail="Geri alınacak kapatılmış dönem yok")
    return {"reopened_period": reopened}


# ---------- Health ----------
@api.get("/")
async def root():
    # push_ready surfaces the boot-time check so a broken notification setup is
    # visible from outside instead of only in the logs.
    check = getattr(app.state, "push_check", None) or {}
    return {
        "service": "odahesap",
        "ok": True,
        "push_ready": bool(check.get("token")),
        "push_detail": check.get("detail"),
    }


# ---------- Odeme bilgisi paylasim baglantisi ----------
#
# `odahesap://` semasi WhatsApp'ta TIKLANABILIR OLMUYOR: mesajlasma
# uygulamalari yalnizca bildikleri semalari baglantiya cevirir. `https` bunu
# cozuyor -- ama veri sorgu dizesine konsaydi IBAN buraya, yani sunucunun
# gunluklerine dusederdi ve "IBAN cihazda kalir" karari cokerdi.
#
# Bu yuzden veri CAPADA (`#...`) tasiniyor: capadan sonrasi HTTP istegine hic
# eklenmez. Asagidaki uc yalnizca `/o` yolunu gorur, iceriginde ne yazdigini
# GOREMEZ. Uygulama kuruluysa Android baglantiyi zaten uygulamaya yonlendirir;
# bu sayfa yalnizca kurulu degilken gorunur.
_PAYLAS_SAYFA = """<!doctype html><html lang="tr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KaSa — ödeme bilgisi</title>
<style>body{font-family:system-ui,sans-serif;background:#F6F8FB;color:#0C1626;
margin:0;padding:32px 20px;line-height:1.6}main{max-width:420px;margin:0 auto}
h1{font-size:20px;margin:0 0 4px}p{color:#5F6F85;margin:0 0 16px}
pre{background:#fff;border:1px solid #E9EEF4;border-radius:12px;padding:16px;
white-space:pre-wrap;word-break:break-all;font-size:15px}
small{color:#98A5B6}</style></head><body><main>
<h1>KaSa ödeme bilgisi</h1>
<p>KaSa kuruluysa bu bağlantı uygulamada açılır. Değilse bilgiler aşağıda.</p>
<pre id="c">—</pre>
<small>Bu bilgi sunucuya hiç gönderilmedi; bağlantının # işaretinden sonraki
kısmı yalnızca bu telefonda kaldı.</small>
</main><script>
var q=new URLSearchParams(location.hash.slice(1)),s=[];
if(q.get("n"))s.push(q.get("n"));
if(q.get("h"))s.push("Ad: "+q.get("h"));
if(q.get("iban"))s.push("IBAN: "+q.get("iban").replace(/(.{4})/g,"$1 ").trim());
if(q.get("pp"))s.push("PayPal: paypal.me/"+q.get("pp"));
document.getElementById("c").textContent=s.length?s.join("\\n"):"Bağlantı eksik.";
</script></body></html>"""


@app.get("/o", response_class=HTMLResponse)
async def paylasim_sayfasi():
    return HTMLResponse(_PAYLAS_SAYFA)


# Android App Links dogrulamasi. Bu dosya olmadan Android "hangi uygulamayla
# acilsin" diye sorar; oldugunda dogrudan KaSa'yi acar. Parmak izi surum
# imzalama keystore'undan (`build-tools/odahesap-release.keystore`) geliyor --
# keystore degisirse BURASI DA degismeli.
_ASSETLINKS = [{
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
        "namespace": "android_app",
        "package_name": "com.odahesap.app",
        "sha256_cert_fingerprints": [
            "2E:9F:C4:1D:33:7F:72:51:3E:56:8C:41:D2:0E:39:CE:41:DF:AB:41:EA:EB:0E:F8:5B:E3:A9:8E:A9:D9:AD:3C"
        ],
    },
}]


@app.get("/.well-known/assetlinks.json")
async def assetlinks():
    return JSONResponse(_ASSETLINKS)


# ---------- App ----------
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.households.create_index("invite_code", unique=True)
    await db.households.create_index("member_ids")
    await db.households.create_index("pending_member_ids")
    await db.periods.create_index([("household_id", 1), ("status", 1)])
    await db.expenses.create_index([("household_id", 1), ("period_id", 1)])
    await db.devices.create_index("token", unique=True)
    await db.devices.create_index("user_id")
    await db.avatars.create_index("user_id", unique=True)
    await db.settlements.create_index("settlement_id", unique=True)
    await db.settlements.create_index([("household_id", 1), ("period_id", 1)])
    await db.shopping_items.create_index("item_id", unique=True)
    await db.shopping_items.create_index([("household_id", 1), ("scope", 1)])
    await db.shopping_items.create_index([("added_by", 1), ("scope", 1)])
    # Fiyat kayıtlarında kimlik alanı yok, indeks de sorgunun kendisine göre:
    # "şu ürün, şu ülkede, şu paket sınıfında, hangi markette kaça".
    await db.price_points.create_index(
        [("product_key", 1), ("country", 1), ("pack_type", 1), ("week", -1)]
    )
    await db.price_points.create_index([("merchant_key", 1), ("week", -1)])
    # Bildirimler: liste sorgusu (kisi + tarih) ve tekil silme.
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.notifications.create_index("notification_id", unique=True)
    await db.recurring.create_index("recurring_id", unique=True)
    await db.recurring.create_index([("household_id", 1), ("active", 1)])
    check = await asyncio.to_thread(push.self_check)
    if check["token"]:
        logger.info("OdaHesap backend started (bildirimler: hazir)")
    else:
        logger.warning("OdaHesap backend started (BILDIRIMLER CALISMIYOR: %s)", check["detail"])
    app.state.push_check = check


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
