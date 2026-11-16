from app.core import ratelimit


def test_sliding_window(monkeypatch):
    monkeypatch.setattr(ratelimit, "ENABLED", True)
    ratelimit.reset()
    assert all(ratelimit.hit("k", 3, 60) for _ in range(3))
    assert ratelimit.hit("k", 3, 60) is False
    assert ratelimit.hit("other", 3, 60) is True


def test_disabled_never_blocks(monkeypatch):
    monkeypatch.setattr(ratelimit, "ENABLED", False)
    assert all(ratelimit.hit("k2", 1, 60) for _ in range(10))


class _Req:
    def __init__(self, headers, host="10.0.0.1"):
        self.headers = headers
        self.client = type("C", (), {"host": host})()


def test_client_ip_prefers_proxy_headers(monkeypatch):
    monkeypatch.setattr(ratelimit, "TRUST_PROXY", True)
    assert ratelimit.client_ip(_Req({"x-real-ip": "1.2.3.4"})) == "1.2.3.4"
    # левые адреса в X-Forwarded-For подделываются клиентом — берём правый
    assert ratelimit.client_ip(_Req({"x-forwarded-for": "6.6.6.6, 5.5.5.5"})) == "5.5.5.5"
    assert ratelimit.client_ip(_Req({})) == "10.0.0.1"
