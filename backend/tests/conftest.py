def pytest_configure(config):
    config.addinivalue_line(
        "markers", "no_dry_run: run only with the server started WITHOUT CALENDAR_INVITE_DRY_RUN")
