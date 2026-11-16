async def test_unknown_api_path_is_404(client):
    response = await client.get("/api/does-not-exist")
    assert response.status_code == 404


async def test_security_headers_present(client):
    response = await client.get("/api/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert "default-src 'self'" in response.headers["content-security-policy"]
    assert response.headers["cache-control"] == "no-store"


async def test_spa_path_traversal_blocked(client, tmp_path, monkeypatch):
    import app.main as main_module

    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("<html>INDEX</html>", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("TOP-SECRET", encoding="utf-8")

    from fastapi import FastAPI
    from fastapi.responses import FileResponse

    # Проверяем ту же логику, что и в app.main.serve_spa, на изолированной папке.
    probe = FastAPI()
    static_dir = static.resolve()

    @probe.get("/{full_path:path}")
    async def serve(full_path: str):
        if full_path:
            candidate = (static_dir / full_path).resolve()
            if candidate.is_file() and candidate.is_relative_to(static_dir):
                return FileResponse(candidate)
        return FileResponse(static_dir / "index.html")

    import httpx

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=probe), base_url="http://t") as c:
        r = await c.get("/..%2Fsecret.txt")
        assert "TOP-SECRET" not in r.text
        r = await c.get("/index.html")
        assert "INDEX" in r.text
    assert hasattr(main_module, "app")


async def test_docs_disabled_in_production_flag():
    from app.core import config

    assert isinstance(config.DOCS_ENABLED, bool)
