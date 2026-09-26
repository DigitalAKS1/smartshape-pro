import media_utils as m


class TestYoutubeId:
    def test_watch_url(self):
        assert m.youtube_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_short_url(self):
        assert m.youtube_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_shorts_url(self):
        assert m.youtube_id("https://www.youtube.com/shorts/dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_embed_url(self):
        assert m.youtube_id("https://www.youtube.com/embed/dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_extra_query_params(self):
        assert m.youtube_id("https://youtu.be/dQw4w9WgXcQ?t=42") == "dQw4w9WgXcQ"

    def test_invalid(self):
        assert m.youtube_id("https://vimeo.com/12345") is None
        assert m.youtube_id("") is None
        assert m.youtube_id(None) is None


class TestNormalizeImages:
    def test_uses_images_when_present(self):
        die = {"images": ["/api/files/a.jpg", "/api/files/b.jpg"], "image_url": "/api/files/a.jpg"}
        assert m.normalize_images(die) == ["/api/files/a.jpg", "/api/files/b.jpg"]

    def test_falls_back_to_image_url(self):
        die = {"image_url": "/api/files/old.jpg"}
        assert m.normalize_images(die) == ["/api/files/old.jpg"]

    def test_empty_when_nothing(self):
        assert m.normalize_images({}) == []
        assert m.normalize_images({"image_url": None}) == []

    def test_caps_at_max(self):
        die = {"images": [f"/api/files/{i}.jpg" for i in range(10)]}
        assert len(m.normalize_images(die)) == m.MAX_DIE_IMAGES


class TestGateDieForCustomer:
    def _die(self, **over):
        d = {
            "die_id": "die_1", "code": "X-1", "name": "Rose", "type": "standard",
            "category": "flowers", "image_url": "/api/files/a.jpg",
            "images": ["/api/files/a.jpg"], "video_url": "https://youtu.be/dQw4w9WgXcQ",
            "description": "secret notes", "show_video": False, "show_description": False,
        }
        d.update(over)
        return d

    def test_hides_video_and_description_by_default(self):
        out = m.gate_die_for_customer(self._die())
        assert "video_url" not in out
        assert "description" not in out
        assert out["images"] == ["/api/files/a.jpg"]

    def test_shows_video_when_enabled(self):
        out = m.gate_die_for_customer(self._die(show_video=True))
        assert out["video_url"] == "https://youtu.be/dQw4w9WgXcQ"
        assert "description" not in out

    def test_shows_description_when_enabled(self):
        out = m.gate_die_for_customer(self._die(show_description=True))
        assert out["description"] == "secret notes"
        assert "video_url" not in out

    def test_never_leaks_show_flags(self):
        out = m.gate_die_for_customer(self._die(show_video=True, show_description=True))
        assert "show_video" not in out
        assert "show_description" not in out

    def test_normalizes_legacy_image_only_die(self):
        out = m.gate_die_for_customer({
            "die_id": "d2", "code": "Y", "name": "Leaf", "type": "standard",
            "image_url": "/api/files/leaf.jpg",
        })
        assert out["images"] == ["/api/files/leaf.jpg"]
