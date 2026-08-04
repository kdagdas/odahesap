"""Full backend test suite for OdaHesap: auth, households, expenses, balances, periods, OCR."""
import pytest
import requests

# ---------- Health ----------
def test_health_root(base_url, api):
    r = api.get(f"{base_url}/api/")
    assert r.status_code == 200
    body = r.json()
    assert body["service"] == "odahesap"
    assert body["ok"] is True
    # push_ready is diagnostic; presence matters, value depends on deployment
    assert "push_ready" in body


# ---------- Auth ----------
class TestAuth:
    def test_login_with_unknown_email_returns_401(self, base_url, api):
        r = api.post(f"{base_url}/api/auth/login",
                     json={"email": "TEST_nobody@test.local", "password": "wrongpass123"})
        assert r.status_code == 401, r.text

    def test_me_without_token_401(self, base_url, api):
        r = api.get(f"{base_url}/api/auth/me")
        assert r.status_code == 401

    def test_me_with_invalid_token_401(self, base_url, api, auth):
        r = api.get(f"{base_url}/api/auth/me", headers=auth("not_a_real_token"))
        assert r.status_code == 401

    def test_me_with_seeded_token_returns_user(self, base_url, api, auth):
        r = api.get(f"{base_url}/api/auth/me", headers=auth("test_token_alice"))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["user_id"] == "user_test_alice"
        assert body["user"]["email"] == "TEST_alice@test.local"


# ---------- Households ----------
class TestHouseholds:
    def test_alice_no_household_initially(self, base_url, api, auth):
        r = api.get(f"{base_url}/api/households/me", headers=auth("test_token_alice"))
        assert r.status_code == 200
        assert r.json()["household"] is None

    def test_alice_creates_household(self, base_url, api, auth):
        r = api.post(f"{base_url}/api/households", headers=auth("test_token_alice"), json={"name": "TEST Ev"})
        assert r.status_code == 200, r.text
        body = r.json()
        hh = body["household"]
        assert hh["name"] == "TEST Ev"
        assert len(hh["invite_code"]) == 6 and hh["invite_code"].isdigit()
        assert hh["member_ids"] == ["user_test_alice"]
        assert body["period"]["status"] == "active"
        pytest.hh_state = {"invite_code": hh["invite_code"], "household_id": hh["household_id"]}

    def test_alice_second_create_rejected(self, base_url, api, auth):
        r = api.post(f"{base_url}/api/households", headers=auth("test_token_alice"), json={"name": "Another"})
        assert r.status_code == 400
        assert "Zaten" in r.json()["detail"]

    def test_bob_join_wrong_code_404(self, base_url, api, auth):
        r = api.post(f"{base_url}/api/households/join", headers=auth("test_token_bob"), json={"invite_code": "000000"})
        assert r.status_code == 404

    def test_bob_and_carol_join(self, base_url, api, auth):
        code = pytest.hh_state["invite_code"]
        r = api.post(f"{base_url}/api/households/join", headers=auth("test_token_bob"), json={"invite_code": code})
        assert r.status_code == 200, r.text
        assert "user_test_bob" in r.json()["household"]["member_ids"]
        r = api.post(f"{base_url}/api/households/join", headers=auth("test_token_carol"), json={"invite_code": code})
        assert r.status_code == 200, r.text
        assert "user_test_carol" in r.json()["household"]["member_ids"]

    def test_bob_double_join_rejected(self, base_url, api, auth):
        code = pytest.hh_state["invite_code"]
        r = api.post(f"{base_url}/api/households/join", headers=auth("test_token_bob"), json={"invite_code": code})
        assert r.status_code == 400

    def test_get_households_me_returns_members_and_period(self, base_url, api, auth):
        r = api.get(f"{base_url}/api/households/me", headers=auth("test_token_alice"))
        assert r.status_code == 200
        body = r.json()
        assert body["household"]["household_id"] == pytest.hh_state["household_id"]
        member_ids = {m["user_id"] for m in body["members"]}
        assert member_ids == {"user_test_alice", "user_test_bob", "user_test_carol"}
        assert body["active_period"]["status"] == "active"
        pytest.hh_state["period_id"] = body["active_period"]["period_id"]


# ---------- Expenses ----------
class TestExpenses:
    def test_alice_creates_household_expense_30(self, base_url, api, auth):
        r = api.post(f"{base_url}/api/expenses", headers=auth("test_token_alice"), json={
            "target_type": "household",
            "items": [{"name": "Milch", "price": 15.0, "category": "sut_urunleri"},
                      {"name": "Brot", "price": 15.0, "category": "firin"}],
            "total": 30.0, "source": "manual", "merchant": "REWE",
        })
        assert r.status_code == 200, r.text
        pytest.hh_state["exp_alice_id"] = r.json()["expense"]["expense_id"]

    def test_bob_creates_roommate_expense_for_carol_12(self, base_url, api, auth):
        r = api.post(f"{base_url}/api/expenses", headers=auth("test_token_bob"), json={
            "target_type": "roommate", "target_user_id": "user_test_carol",
            "items": [{"name": "Snack", "price": 12.0, "category": "atistirmalik"}],
            "total": 12.0, "source": "manual",
        })
        assert r.status_code == 200, r.text
        pytest.hh_state["exp_bob_id"] = r.json()["expense"]["expense_id"]

    def test_bob_creates_self_expense(self, base_url, api, auth):
        r = api.post(f"{base_url}/api/expenses", headers=auth("test_token_bob"), json={
            "target_type": "self",
            "items": [{"name": "Buch", "price": 20.0, "category": "diger"}],
            "total": 20.0, "source": "manual",
        })
        assert r.status_code == 200

    def test_roommate_expense_invalid_target(self, base_url, api, auth):
        # target not in household
        r = api.post(f"{base_url}/api/expenses", headers=auth("test_token_alice"), json={
            "target_type": "roommate", "target_user_id": "user_test_dave",
            "items": [], "total": 5.0,
        })
        assert r.status_code == 400

    def test_roommate_expense_self_target_rejected(self, base_url, api, auth):
        r = api.post(f"{base_url}/api/expenses", headers=auth("test_token_alice"), json={
            "target_type": "roommate", "target_user_id": "user_test_alice",
            "items": [], "total": 5.0,
        })
        assert r.status_code == 400

    def test_expense_without_household_rejected(self, base_url, api, auth):
        r = api.post(f"{base_url}/api/expenses", headers=auth("test_token_dave"), json={
            "target_type": "self", "items": [], "total": 1.0,
        })
        assert r.status_code == 400

    def test_visibility_alice_sees_household_only_no_carol_roommate(self, base_url, api, auth):
        r = api.get(f"{base_url}/api/expenses", headers=auth("test_token_alice"))
        assert r.status_code == 200
        exps = r.json()["expenses"]
        # Alice sees the household expense but NOT bob's roommate expense to carol nor bob's self
        ttypes = [(e["target_type"], e.get("target_user_id"), e["added_by"]) for e in exps]
        assert ("household", None, "user_test_alice") in ttypes
        # Should NOT contain bob's roommate-for-carol
        assert ("roommate", "user_test_carol", "user_test_bob") not in ttypes
        # Should NOT contain bob's self
        assert ("self", None, "user_test_bob") not in ttypes

    def test_visibility_bob_sees_household_own_roommate_and_self(self, base_url, api, auth):
        r = api.get(f"{base_url}/api/expenses", headers=auth("test_token_bob"))
        assert r.status_code == 200
        exps = r.json()["expenses"]
        ttypes = [(e["target_type"], e.get("target_user_id"), e["added_by"]) for e in exps]
        assert ("household", None, "user_test_alice") in ttypes
        assert ("roommate", "user_test_carol", "user_test_bob") in ttypes
        assert ("self", None, "user_test_bob") in ttypes

    def test_visibility_carol_sees_household_and_roommate_target(self, base_url, api, auth):
        r = api.get(f"{base_url}/api/expenses", headers=auth("test_token_carol"))
        assert r.status_code == 200
        exps = r.json()["expenses"]
        ttypes = [(e["target_type"], e.get("target_user_id"), e["added_by"]) for e in exps]
        assert ("household", None, "user_test_alice") in ttypes
        assert ("roommate", "user_test_carol", "user_test_bob") in ttypes
        # No bob's self
        assert ("self", None, "user_test_bob") not in ttypes

    def test_delete_expense_non_owner_403(self, base_url, api, auth):
        r = api.delete(f"{base_url}/api/expenses/{pytest.hh_state['exp_alice_id']}",
                       headers=auth("test_token_bob"))
        assert r.status_code == 403

    def test_delete_nonexistent_404(self, base_url, api, auth):
        r = api.delete(f"{base_url}/api/expenses/exp_doesnotexist",
                       headers=auth("test_token_alice"))
        assert r.status_code == 404


# ---------- Balances ----------
class TestBalances:
    def test_balances_math_and_transfers(self, base_url, api, auth):
        # State: Alice paid 30 household (3 members), Bob paid 12 roommate-for-Carol.
        # Expected net: Alice +20, Bob +2, Carol -22
        r = api.get(f"{base_url}/api/balances", headers=auth("test_token_alice"))
        assert r.status_code == 200, r.text
        body = r.json()
        net = body["net"]
        assert round(net["user_test_alice"], 2) == 20.0
        assert round(net["user_test_bob"], 2) == 2.0
        assert round(net["user_test_carol"], 2) == -22.0

        # sum positives == sum negatives
        pos = sum(v for v in net.values() if v > 0)
        neg = sum(-v for v in net.values() if v < 0)
        assert round(pos - neg, 2) == 0.0

        # transfers should settle everything
        transfers = body["transfers"]
        assert len(transfers) >= 1
        # simulate transfers and re-check net becomes zero
        after = dict(net)
        for t in transfers:
            after[t["from"]] = round(after.get(t["from"], 0) + t["amount"], 2)
            after[t["to"]] = round(after.get(t["to"], 0) - t["amount"], 2)
        for v in after.values():
            assert abs(v) < 0.02, f"Non-zero net after settle: {after}"

        # totals_paid: alice paid 30 household
        assert round(body["totals_paid"]["user_test_alice"], 2) == 30.0


# ---------- Periods ----------
class TestPeriods:
    def test_close_period_and_new_one_starts(self, base_url, api, auth):
        r = api.post(f"{base_url}/api/periods/close", headers=auth("test_token_alice"))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["closed_period_id"] == pytest.hh_state["period_id"]
        assert body["new_period"]["status"] == "active"
        assert body["new_period"]["period_id"] != pytest.hh_state["period_id"]
        pytest.hh_state["new_period_id"] = body["new_period"]["period_id"]

    def test_household_current_period_updated(self, base_url, api, auth):
        r = api.get(f"{base_url}/api/households/me", headers=auth("test_token_alice"))
        assert r.status_code == 200
        hh = r.json()["household"]
        assert hh["current_period_id"] == pytest.hh_state["new_period_id"]

    def test_periods_list_contains_both(self, base_url, api, auth):
        r = api.get(f"{base_url}/api/periods", headers=auth("test_token_alice"))
        assert r.status_code == 200
        periods = r.json()["periods"]
        statuses = {p["period_id"]: p["status"] for p in periods}
        assert statuses.get(pytest.hh_state["period_id"]) == "closed"
        assert statuses.get(pytest.hh_state["new_period_id"]) == "active"

    def test_balances_reset_in_new_period(self, base_url, api, auth):
        r = api.get(f"{base_url}/api/balances", headers=auth("test_token_alice"))
        assert r.status_code == 200
        net = r.json()["net"]
        for v in net.values():
            assert abs(v) < 0.01


# ---------- OCR ----------
class TestOCR:
    def test_ocr_receipt_returns_items(self, base_url, api, auth, receipt_image_b64):
        r = api.post(f"{base_url}/api/ocr/receipt",
                     headers=auth("test_token_alice"),
                     json={"image_base64": receipt_image_b64},
                     timeout=90)
        assert r.status_code == 200, f"OCR failed: {r.status_code} {r.text}"
        body = r.json()
        assert "items" in body
        assert isinstance(body["items"], list)
        assert len(body["items"]) >= 2, f"Expected items, got: {body}"
        # non-item lines should be excluded
        names_lower = " ".join([str(it.get("name", "")).lower() for it in body["items"]])
        assert "summe" not in names_lower
        assert "mwst" not in names_lower
        assert "rueckgeld" not in names_lower
        # all items must have name + numeric price
        for it in body["items"]:
            assert it["name"]
            assert isinstance(it["price"], (int, float))

    def test_ocr_requires_auth(self, base_url, api, receipt_image_b64):
        r = api.post(f"{base_url}/api/ocr/receipt",
                     json={"image_base64": receipt_image_b64})
        assert r.status_code == 401


# ---------- Leave ----------
class TestLeave:
    def test_carol_leaves_household(self, base_url, api, auth):
        r = api.post(f"{base_url}/api/households/leave", headers=auth("test_token_carol"))
        assert r.status_code == 200
        # Verify carol is no longer in the household
        r2 = api.get(f"{base_url}/api/households/me", headers=auth("test_token_alice"))
        member_ids = [m["user_id"] for m in r2.json()["members"]]
        assert "user_test_carol" not in member_ids

    def test_carol_can_now_join_something_else(self, base_url, api, auth):
        # Now that Carol left, /households/me should return null for her
        r = api.get(f"{base_url}/api/households/me", headers=auth("test_token_carol"))
        assert r.status_code == 200
        assert r.json()["household"] is None
