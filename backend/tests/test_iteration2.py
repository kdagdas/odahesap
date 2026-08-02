"""Iteration 2 backend tests for OdaHesap.

Focus (per review request):
- Invite APPROVAL flow: join is now pending, GET /households/me shows pending state,
  approve/reject endpoints
- expense_date persistence + normalization; items with quantity preserved & GET sorting
- OCR now returns 'date' and each item has 'quantity'
- New GET /api/members/{user_id}/expenses drill-down with visibility filter
- /balances now returns 'roommate_paid'
- Regression: auth-401 with bad session, self-visibility invariants, balance math
"""
import io
import base64
import pytest
import requests
from PIL import Image, ImageDraw, ImageFont


# ---------- helpers ----------
def _reset_household_state(mongo, member_ids):
    """Remove any test-owned households/periods/expenses so tests are re-runnable."""
    hhs = list(mongo.households.find({
        "$or": [
            {"member_ids": {"$in": member_ids}},
            {"pending_member_ids": {"$in": member_ids}},
        ]
    }))
    hh_ids = [h["household_id"] for h in hhs]
    if hh_ids:
        mongo.expenses.delete_many({"household_id": {"$in": hh_ids}})
        mongo.periods.delete_many({"household_id": {"$in": hh_ids}})
        mongo.households.delete_many({"household_id": {"$in": hh_ids}})


@pytest.fixture(scope="module", autouse=True)
def fresh_state(mongo):
    ids = ["user_test_alice", "user_test_bob", "user_test_carol", "user_test_dave"]
    _reset_household_state(mongo, ids)
    yield
    _reset_household_state(mongo, ids)


@pytest.fixture(scope="module")
def state():
    """Shared per-module state across tests."""
    return {}


# ---------- 1. Regression: auth 401 with bad credentials ----------
def test_regression_auth_login_bad_credentials_returns_401(base_url, api):
    r = api.post(f"{base_url}/api/auth/login",
                 json={"email": "TEST_bogus_iter2@test.local", "password": "bogus_password_xyz"})
    assert r.status_code == 401, r.text


# ---------- 2. Household creation with pending_member_ids=[] ----------
class TestHouseholdCreationAndInviteApproval:
    def test_alice_creates_household_has_empty_pending_and_active_period(self, base_url, api, auth, state):
        r = api.post(f"{base_url}/api/households", headers=auth("test_token_alice"),
                     json={"name": "TEST Iter2 Ev"})
        assert r.status_code == 200, r.text
        body = r.json()
        hh = body["household"]
        assert hh["member_ids"] == ["user_test_alice"]
        assert hh.get("pending_member_ids") == [], f"expected empty pending, got {hh.get('pending_member_ids')}"
        assert body["period"]["status"] == "active"
        state["invite_code"] = hh["invite_code"]
        state["household_id"] = hh["household_id"]
        state["period_id"] = body["period"]["period_id"]

    def test_bob_join_returns_pending_true_and_household(self, base_url, api, auth, state):
        r = api.post(f"{base_url}/api/households/join",
                     headers=auth("test_token_bob"),
                     json={"invite_code": state["invite_code"]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("pending") is True, f"expected pending=True, got {body}"
        hh = body["household"]
        assert "user_test_bob" not in hh["member_ids"], "join should NOT auto-add to members"
        assert "user_test_bob" in hh["pending_member_ids"]

    def test_joiner_bob_sees_pending_household_and_null_household(self, base_url, api, auth, state):
        r = api.get(f"{base_url}/api/households/me", headers=auth("test_token_bob"))
        assert r.status_code == 200
        body = r.json()
        assert body["household"] is None, f"joiner should not have full household yet: {body}"
        assert body.get("pending") is True
        assert body.get("pending_household", {}).get("household_id") == state["household_id"]
        assert body.get("pending_household", {}).get("name") == "TEST Iter2 Ev"

    def test_owner_alice_sees_bob_in_pending_members(self, base_url, api, auth, state):
        r = api.get(f"{base_url}/api/households/me", headers=auth("test_token_alice"))
        assert r.status_code == 200
        body = r.json()
        pending_ids = [m["user_id"] for m in body["pending_members"]]
        assert "user_test_bob" in pending_ids
        member_ids = [m["user_id"] for m in body["members"]]
        assert "user_test_bob" not in member_ids

    def test_carol_joins_pending(self, base_url, api, auth, state):
        r = api.post(f"{base_url}/api/households/join",
                     headers=auth("test_token_carol"),
                     json={"invite_code": state["invite_code"]})
        assert r.status_code == 200
        assert r.json().get("pending") is True

    def test_bob_expense_creation_rejected_while_pending(self, base_url, api, auth):
        r = api.post(f"{base_url}/api/expenses",
                     headers=auth("test_token_bob"),
                     json={"target_type": "self", "items": [], "total": 1.0})
        assert r.status_code == 400, "pending members should not be able to add expenses"

    def test_approve_unknown_user_returns_404(self, base_url, api, auth):
        r = api.post(f"{base_url}/api/households/approve",
                     headers=auth("test_token_alice"),
                     json={"user_id": "user_test_ghost"})
        assert r.status_code == 404

    def test_approve_bob_and_carol_moves_to_members(self, base_url, api, auth, state):
        r = api.post(f"{base_url}/api/households/approve",
                     headers=auth("test_token_alice"),
                     json={"user_id": "user_test_bob"})
        assert r.status_code == 200, r.text
        r = api.post(f"{base_url}/api/households/approve",
                     headers=auth("test_token_alice"),
                     json={"user_id": "user_test_carol"})
        assert r.status_code == 200, r.text

        r = api.get(f"{base_url}/api/households/me", headers=auth("test_token_alice"))
        body = r.json()
        member_ids = {m["user_id"] for m in body["members"]}
        assert member_ids == {"user_test_alice", "user_test_bob", "user_test_carol"}
        assert body["pending_members"] == []
        # Bob now sees full household
        r2 = api.get(f"{base_url}/api/households/me", headers=auth("test_token_bob"))
        b2 = r2.json()
        assert b2["household"] is not None
        assert b2.get("pending") is False


# ---------- 3. Reject flow (separate household with Dave) ----------
class TestRejectFlow:
    def test_dave_joins_then_gets_rejected(self, base_url, api, auth, state):
        # Dave joins Alice's household as pending
        r = api.post(f"{base_url}/api/households/join",
                     headers=auth("test_token_dave"),
                     json={"invite_code": state["invite_code"]})
        assert r.status_code == 200
        assert r.json().get("pending") is True

        # Alice sees Dave in pending
        r = api.get(f"{base_url}/api/households/me", headers=auth("test_token_alice"))
        pending_ids = [m["user_id"] for m in r.json()["pending_members"]]
        assert "user_test_dave" in pending_ids

        # Reject Dave
        r = api.post(f"{base_url}/api/households/reject",
                     headers=auth("test_token_alice"),
                     json={"user_id": "user_test_dave"})
        assert r.status_code == 200

        # Dave now sees household=null and no pending_household
        r = api.get(f"{base_url}/api/households/me", headers=auth("test_token_dave"))
        b = r.json()
        assert b["household"] is None
        assert b.get("pending") is False
        assert b.get("pending_household") is None or b.get("pending_household") == {}


# ---------- 4. Expenses: expense_date + quantity ----------
class TestExpensesDateAndQuantity:
    def test_create_expense_with_iso_date_and_quantity(self, base_url, api, auth, state):
        r = api.post(f"{base_url}/api/expenses",
                     headers=auth("test_token_alice"),
                     json={
                         "target_type": "household",
                         "items": [
                             {"name": "Milch", "price": 1.49, "quantity": 2, "category": "sut_urunleri"},
                             {"name": "Brot", "price": 2.99, "quantity": 1, "category": "firin"},
                         ],
                         "total": 30.0,  # Alice pays 30 household
                         "source": "manual",
                         "merchant": "REWE",
                         "expense_date": "2025-10-15",
                     })
        assert r.status_code == 200, r.text
        exp = r.json()["expense"]
        assert exp["expense_date"] == "2025-10-15"
        assert exp["items"][0]["quantity"] == 2
        state["exp_alice_household"] = exp["expense_id"]

    def test_create_expense_with_german_date_normalized(self, base_url, api, auth, state):
        r = api.post(f"{base_url}/api/expenses",
                     headers=auth("test_token_alice"),
                     json={
                         "target_type": "household",
                         "items": [{"name": "Cola", "price": 1.0, "quantity": 3}],
                         "total": 3.0,
                         "expense_date": "20.11.2025",
                     })
        assert r.status_code == 200
        assert r.json()["expense"]["expense_date"] == "2025-11-20"

    def test_bob_creates_roommate_expense_for_carol_12(self, base_url, api, auth, state):
        # A pays €12 roommate-for-B (per review). Using Bob->Carol here; will separately
        # test the "A pays €12 roommate-for-B" scenario in TestMemberDrilldown.
        r = api.post(f"{base_url}/api/expenses",
                     headers=auth("test_token_bob"),
                     json={
                         "target_type": "roommate",
                         "target_user_id": "user_test_carol",
                         "items": [{"name": "Snack", "price": 6.0, "quantity": 2}],
                         "total": 12.0,
                         "expense_date": "2025-10-16",
                     })
        assert r.status_code == 200
        state["exp_bob_roommate"] = r.json()["expense"]["expense_id"]

    def test_list_expenses_default_quantity_and_sorted_by_date_desc(self, base_url, api, auth, state):
        r = api.get(f"{base_url}/api/expenses", headers=auth("test_token_alice"))
        assert r.status_code == 200
        exps = r.json()["expenses"]
        # every item should have quantity (default 1)
        for e in exps:
            for it in e.get("items", []):
                assert "quantity" in it, f"missing quantity: {it}"
                assert it["quantity"] >= 0
        # sorted by expense_date desc
        dates = [e.get("expense_date") for e in exps if e.get("expense_date")]
        assert dates == sorted(dates, reverse=True), f"not desc-sorted: {dates}"


# ---------- 5. Balance math smoke + roommate_paid ----------
class TestBalanceAndRoommatePaid:
    def test_balances_roommate_paid_field_present(self, base_url, api, auth):
        r = api.get(f"{base_url}/api/balances", headers=auth("test_token_alice"))
        assert r.status_code == 200, r.text
        body = r.json()
        assert "roommate_paid" in body, f"balances missing roommate_paid: {list(body.keys())}"
        rp = body["roommate_paid"]
        assert rp.get("user_test_bob", 0) == 12.0, f"bob paid 12 roommate, got {rp}"
        assert rp.get("user_test_alice", 0) == 0.0
        assert rp.get("user_test_carol", 0) == 0.0

    def test_balance_math_smoke(self, base_url, api, auth):
        # Alice: paid 33 (30+3) household. Bob: paid 12 roommate for Carol.
        # Household 33 split 3 ways: each owes 11.
        # Net: Alice +22, Bob (-11 + 12) = +1, Carol (-11 - 12) = -23
        r = api.get(f"{base_url}/api/balances", headers=auth("test_token_alice"))
        net = r.json()["net"]
        assert round(net["user_test_alice"], 2) == 22.0, net
        assert round(net["user_test_bob"], 2) == 1.0, net
        assert round(net["user_test_carol"], 2) == -23.0, net
        # zero-sum
        assert abs(sum(net.values())) < 0.02


# ---------- 6. Member drill-down endpoint ----------
class TestMemberDrilldown:
    """Scenario per review: A pays €30 household, A pays €12 roommate-for-B.
    - GET /members/{A}/expenses called by C → sees only household expense
    - GET /members/{A}/expenses called by B → sees both
    Mapping: A=Alice, B=Bob, C=Carol.
    We add: Alice pays €12 roommate for Bob (in addition to existing state).
    """
    def test_setup_alice_roommate_for_bob(self, base_url, api, auth, state):
        r = api.post(f"{base_url}/api/expenses",
                     headers=auth("test_token_alice"),
                     json={
                         "target_type": "roommate",
                         "target_user_id": "user_test_bob",
                         "items": [{"name": "Ticket", "price": 12.0, "quantity": 1}],
                         "total": 12.0,
                         "expense_date": "2025-10-17",
                     })
        assert r.status_code == 200
        state["exp_alice_roommate_for_bob"] = r.json()["expense"]["expense_id"]

    def test_carol_drilldown_of_alice_sees_only_household(self, base_url, api, auth, state):
        r = api.get(f"{base_url}/api/members/user_test_alice/expenses",
                    headers=auth("test_token_carol"))
        assert r.status_code == 200, r.text
        body = r.json()
        ttypes = [(e["target_type"], e.get("target_user_id")) for e in body["expenses"]]
        # Alice added: household (30), household (3), roommate-for-bob (12).
        # Carol should see 2 household but NOT the roommate-for-bob
        assert ("roommate", "user_test_bob") not in ttypes, \
            f"Carol must not see Alice's roommate-for-Bob: {ttypes}"
        assert ("household", None) in ttypes
        # household_total is sum of Alice's household expenses = 30 + 3 = 33
        assert body["household_total"] == 33.0, body
        # roommate_total from Carol's view = 0 (she does not see that roommate expense)
        assert body["roommate_total"] == 0.0, body

    def test_bob_drilldown_of_alice_sees_both(self, base_url, api, auth, state):
        r = api.get(f"{base_url}/api/members/user_test_alice/expenses",
                    headers=auth("test_token_bob"))
        assert r.status_code == 200
        body = r.json()
        ttypes = [(e["target_type"], e.get("target_user_id")) for e in body["expenses"]]
        assert ("roommate", "user_test_bob") in ttypes, \
            f"Bob should see Alice's roommate-for-Bob: {ttypes}"
        assert ("household", None) in ttypes
        assert body["household_total"] == 33.0
        assert body["roommate_total"] == 12.0

    def test_drilldown_unknown_member_404(self, base_url, api, auth):
        r = api.get(f"{base_url}/api/members/user_test_ghost/expenses",
                    headers=auth("test_token_alice"))
        assert r.status_code == 404


# ---------- 7. Self-visibility regression ----------
class TestSelfVisibility:
    def test_self_expense_visible_only_to_creator(self, base_url, api, auth):
        # Bob adds a self expense
        r = api.post(f"{base_url}/api/expenses",
                     headers=auth("test_token_bob"),
                     json={"target_type": "self",
                           "items": [{"name": "Buch", "price": 20.0, "quantity": 1}],
                           "total": 20.0,
                           "expense_date": "2025-10-18"})
        assert r.status_code == 200

        # Bob sees it
        r = api.get(f"{base_url}/api/expenses", headers=auth("test_token_bob"))
        assert r.status_code == 200
        bob_self = [e for e in r.json()["expenses"]
                    if e["target_type"] == "self" and e["added_by"] == "user_test_bob"]
        assert len(bob_self) >= 1

        # Alice and Carol do NOT see Bob's self
        for tok in ("test_token_alice", "test_token_carol"):
            r = api.get(f"{base_url}/api/expenses", headers=auth(tok))
            others_self = [e for e in r.json()["expenses"]
                           if e["target_type"] == "self" and e["added_by"] == "user_test_bob"]
            assert others_self == [], f"{tok} leaked bob's self: {others_self}"


# ---------- 8. OCR: date + quantity ----------
def _synth_receipt_with_date_and_qty() -> str:
    W, H = 500, 700
    img = Image.new("RGB", (W, H), (252, 252, 246))
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 20)
        fontb = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 26)
    except Exception:
        font = ImageFont.load_default()
        fontb = font
    lines = [
        ("REWE Markt GmbH", fontb),
        ("Filiale Berlin", font),
        ("--------------------------------", font),
        ("Datum: 15.10.2025  10:33", font),
        ("--------------------------------", font),
        ("2 X Milch 1,5%      1,49", font),
        ("Brot Vollkorn       2,99 A", font),
        ("3 X Joghurt         0,79", font),
        ("Butter              2,29 A", font),
        ("--------------------------------", font),
        ("Summe EUR           9,64", fontb),
        ("Bar                10,00", font),
        ("Rueckgeld           0,36", font),
    ]
    y = 20
    for text, f in lines:
        d.text((20, y), text, fill=(20, 20, 20), font=f)
        y += 38
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return base64.b64encode(buf.getvalue()).decode("ascii")


class TestOCRDateAndQuantity:
    def test_ocr_returns_date_and_quantity(self, base_url, api, auth):
        b64 = _synth_receipt_with_date_and_qty()
        r = api.post(f"{base_url}/api/ocr/receipt",
                     headers=auth("test_token_alice"),
                     json={"image_base64": b64},
                     timeout=120)
        assert r.status_code == 200, f"OCR failed: {r.status_code} {r.text}"
        body = r.json()
        # response schema must include 'date'
        assert "date" in body, f"missing 'date' in response: {list(body.keys())}"
        # Verify date is normalized to YYYY-MM-DD if present
        if body["date"]:
            assert body["date"] == "2025-10-15", f"expected 2025-10-15, got {body['date']}"
        # Each item must have 'quantity'
        assert isinstance(body["items"], list) and len(body["items"]) >= 2
        for it in body["items"]:
            assert "quantity" in it, f"missing 'quantity' in item: {it}"
            assert isinstance(it["quantity"], (int, float))
            assert it["quantity"] > 0
        # Try to find the 2x Milch line — quantity should be captured as 2
        milch = [it for it in body["items"] if "milch" in it["name"].lower()]
        if milch:
            assert milch[0]["quantity"] in (2, 2.0), \
                f"expected Milch qty=2, got {milch[0]}"
