"""Integration tests for /api/health and /api/auth against real Postgres."""

AUTH = "/api/auth"


def register(client, email="ada@example.com", password="s3cret-pass", name="Ada"):
    return client.post(
        f"{AUTH}/register",
        json={"email": email, "password": password, "display_name": name},
    )


def test_health_ok(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["database"] == "up"
    assert isinstance(body["demo_mode"], bool)
    assert set(body["providers"]) == {"gemini", "openai"}
    assert all(isinstance(v, bool) for v in body["providers"].values())


def test_register_me_flow_with_cookie(client):
    resp = register(client, email="Ada@Example.com")
    assert resp.status_code == 201
    user = resp.json()
    assert set(user) == {"id", "email", "display_name", "role"}
    assert user["email"] == "ada@example.com"  # normalized lowercase
    assert user["role"] == "user"

    set_cookie = resp.headers["set-cookie"]
    assert "docsage_session=" in set_cookie
    assert "httponly" in set_cookie.lower()
    assert "samesite=lax" in set_cookie.lower()

    # TestClient persists the cookie; /me must resolve the session.
    me = client.get(f"{AUTH}/me")
    assert me.status_code == 200
    assert me.json()["id"] == user["id"]


def test_register_duplicate_email_conflict(client):
    assert register(client, email="dup@example.com").status_code == 201
    again = register(client, email="DUP@example.com")
    assert again.status_code == 409


def test_register_and_login_roundtrip(client):
    register(client, email="login@example.com", password="correct-horse")
    wrong = client.post(
        f"{AUTH}/login", json={"email": "login@example.com", "password": "nope-nope"}
    )
    assert wrong.status_code == 401

    ok = client.post(
        f"{AUTH}/login", json={"email": "Login@Example.com", "password": "correct-horse"}
    )
    assert ok.status_code == 200
    assert ok.json()["email"] == "login@example.com"
    assert client.get(f"{AUTH}/me").status_code == 200


def test_login_unknown_email_401(client):
    resp = client.post(
        f"{AUTH}/login", json={"email": "ghost@example.com", "password": "whatever"}
    )
    assert resp.status_code == 401


def test_logout_clears_session(client):
    register(client, email="bye@example.com")
    assert client.get(f"{AUTH}/me").status_code == 200

    out = client.post(f"{AUTH}/logout")
    assert out.status_code == 204
    assert client.get(f"{AUTH}/me").status_code == 401

    # Logging out without a session is still a 204 no-op.
    assert client.post(f"{AUTH}/logout").status_code == 204


def test_me_without_cookie_401(client):
    assert client.get(f"{AUTH}/me").status_code == 401


def test_register_validation_422(client):
    bad_email = {"email": "not-an-email", "password": "x" * 12, "display_name": "A"}
    resp = client.post(f"{AUTH}/register", json=bad_email)
    assert resp.status_code == 422
    short_pw = {"email": "a@b.co", "password": "short", "display_name": "A"}
    short = client.post(f"{AUTH}/register", json=short_pw)
    assert short.status_code == 422
