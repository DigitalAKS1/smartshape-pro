import product_type_utils as p


class TestSlugifyPrefix:
    def test_uppercases_and_trims(self):
        assert p.slugify_prefix("  sssd ") == "SSSD"

    def test_strips_invalid_chars(self):
        assert p.slugify_prefix("ss-d!@#") == "SS-D"

    def test_collapses_spaces_to_nothing(self):
        assert p.slugify_prefix("ss d") == "SSD"

    def test_empty(self):
        assert p.slugify_prefix("") == ""
        assert p.slugify_prefix(None) == ""


class TestNextCode:
    def test_first_code_when_none_exist(self):
        assert p.next_code("SSSD", []) == "SSSD-001"

    def test_increments_max(self):
        codes = ["SSSD-001", "SSSD-002", "SSSD-007"]
        assert p.next_code("SSSD", codes) == "SSSD-008"

    def test_ignores_other_prefixes(self):
        codes = ["SSM-010", "SSSD-003"]
        assert p.next_code("SSSD", codes) == "SSSD-004"

    def test_handles_gaps_and_padding(self):
        codes = ["SSSD-1", "SSSD-09"]
        assert p.next_code("SSSD", codes) == "SSSD-010"

    def test_case_insensitive_match(self):
        codes = ["sssd-005"]
        assert p.next_code("SSSD", codes) == "SSSD-006"
