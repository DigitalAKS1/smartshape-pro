"""Settings/Integrations Hub tests. Live server; self-cleaning ('hubtest')."""
import os
import pytest, requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


def _login():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": "info@smartshape.in", "password": "admin123"})
    assert r.status_code == 200, r.text
    tok = s.cookies.get("access_token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


class TestIntegrationStatus:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        yield

    def test_status_lists_all_integrations(self):
        r = self.s.get(f"{BASE_URL}/api/settings/integrations/status")
        assert r.status_code == 200, r.text
        data = r.json()
        for key in ("gmail", "whatsapp", "zoom", "cloudinary", "ai", "sheets"):
            assert key in data, f"missing {key}"
            assert "configured" in data[key]
            assert isinstance(data[key]["configured"], bool)
        print("✓ integration status returns all keys with configured flags")


class TestCloudinaryConfig:
    @pytest.fixture(autouse=True)
    def setup(self):
        # WRITE test: skip unless explicitly opted in. The local backend targets the
        # PROD DB (see project memory), and saving creds here would route prod uploads
        # at a bogus Cloudinary account. Only run against a disposable/staging server.
        if os.environ.get("HUB_WRITE_TESTS") != "1":
            pytest.skip("set HUB_WRITE_TESTS=1 to run write tests (never against prod DB)")
        self.s = _login()
        yield

    def test_save_then_get_masks_secret(self):
        body = {"cloud_name": "hubtest-cloud", "api_key": "123456", "api_secret": "supersecretvalue"}
        r = self.s.post(f"{BASE_URL}/api/settings/cloudinary", json=body)
        assert r.status_code == 200, r.text
        got = self.s.get(f"{BASE_URL}/api/settings/cloudinary").json()
        assert got["cloud_name"] == "hubtest-cloud"
        assert got.get("api_secret_set") is True
        assert "api_secret" not in got
        print("✓ cloudinary config saves and masks the secret")


class TestStorageSelection:
    """Unit-level: import the service and assert provider selection. No real upload."""
    def test_fallback_returns_files_path_when_cloudinary_unset(self, monkeypatch):
        import asyncio
        import importlib
        storage = importlib.import_module("services.storage")

        async def fake_cfg():
            return None  # cloudinary not configured
        monkeypatch.setattr(storage, "_cloudinary_config", fake_cfg)

        written = {}
        monkeypatch.setattr(storage, "_save_file_local", lambda path, data: written.update({"path": path}))

        url = asyncio.run(
            storage.save_upload("hubtest/x.png", b"abc", "image/png", legacy="local")
        )
        assert url == "/api/files/hubtest/x.png"
        assert written["path"] == "hubtest/x.png"
        print("✓ storage falls back to local /api/files path when cloudinary unset")
