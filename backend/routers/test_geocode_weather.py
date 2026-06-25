"""Tests for transient location and weather metadata enrichment."""

from collections.abc import Callable

import httpx
from fastapi.testclient import TestClient

from backend.main import app
from backend.routers import geocode

client = TestClient(app)


class FakeResponse:
    def __init__(self, data: object, status_code: int = 200) -> None:
        self._data = data
        self.status_code = status_code

    def json(self) -> object:
        return self._data

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("GET", "https://example.test")
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError("fake status error", request=request, response=response)


class FakeClient:
    def __init__(self, handler: Callable[[str, dict], FakeResponse]) -> None:
        self.handler = handler
        self.calls: list[tuple[str, dict]] = []

    async def get(self, url: str, params: dict) -> FakeResponse:
        self.calls.append((url, params))
        return self.handler(url, params)


def install_fake_client(monkeypatch, fake_client: FakeClient) -> None:
    async def _fake_get_httpx_client() -> FakeClient:
        return fake_client

    monkeypatch.setattr(geocode, "_get_httpx_client", _fake_get_httpx_client)


def test_reverse_geocode_returns_city_country_in_english(monkeypatch):
    """Reverse geocode should prefer city over district/county labels."""

    def handler(url: str, params: dict) -> FakeResponse:
        assert params["accept-language"] == "en"
        assert params["zoom"] == 10
        return FakeResponse(
            {
                "display_name": "Chaoyang District, Beijing, China",
                "address": {
                    "city_district": "Chaoyang District",
                    "county": "Chaoyang District",
                    "city": "Beijing",
                    "country": "China",
                },
            }
        )

    install_fake_client(monkeypatch, FakeClient(handler))

    response = client.get("/api/geocode?lat=39.9&lng=116.4")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"] == "Beijing, China"


def test_reverse_geocode_uses_display_city_when_address_only_has_district(monkeypatch):
    """A district-only address must not become the saved location value."""

    def handler(url: str, params: dict) -> FakeResponse:
        return FakeResponse(
            {
                "display_name": "Chaoyang District, Beijing, China",
                "address": {
                    "county": "Chaoyang District",
                    "country": "China",
                },
            }
        )

    install_fake_client(monkeypatch, FakeClient(handler))

    response = client.get("/api/geocode?lat=39.9&lng=116.4")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"] == "Beijing, China"


def test_reverse_geocode_rejects_city_field_when_it_is_really_a_district(monkeypatch):
    """Some reverse geocoders put a district label in `city`; skip it."""

    def handler(url: str, params: dict) -> FakeResponse:
        return FakeResponse(
            {
                "display_name": "Xiaoying, Shangcheng District, Hangzhou City, Zhejiang, 310009, China",
                "address": {
                    "suburb": "Xiaoying",
                    "city": "Shangcheng District",
                    "state": "Zhejiang",
                    "postcode": "310009",
                    "country": "China",
                },
            }
        )

    install_fake_client(monkeypatch, FakeClient(handler))

    response = client.get("/api/geocode?lat=30.25&lng=120.17")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"] == "Hangzhou, China"


def test_reverse_geocode_returns_controlled_error_on_request_failure(monkeypatch):
    """Reverse geocode network failures should not leak as server errors."""

    def handler(url: str, params: dict) -> FakeResponse:
        request = httpx.Request("GET", url)
        raise httpx.RequestError("network unavailable", request=request)

    install_fake_client(monkeypatch, FakeClient(handler))

    response = client.get("/api/geocode?lat=39.9&lng=116.4")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "GEOCODE_ERROR"


def test_weather_formats_open_meteo_forecast_as_english_summary(monkeypatch):
    """Weather query returns `[Weather], [min]℃-[max]℃` in English."""

    def handler(url: str, params: dict) -> FakeResponse:
        if "geocoding-api.open-meteo.com" in url:
            assert params["name"] == "Hangzhou, China"
            assert params["count"] == 1
            assert params["language"] == "en"
            return FakeResponse(
                {
                    "results": [
                        {
                            "name": "Hangzhou",
                            "country": "China",
                            "latitude": 30.25,
                            "longitude": 120.17,
                        }
                    ]
                }
            )

        if "api.open-meteo.com" in url:
            assert params["latitude"] == 30.25
            assert params["longitude"] == 120.17
            assert params["temperature_unit"] == "celsius"
            assert params["forecast_days"] == 1
            assert params["timezone"] == "auto"
            assert "weather_code" in params["daily"]
            assert "temperature_2m_min" in params["daily"]
            assert "temperature_2m_max" in params["daily"]
            return FakeResponse(
                {
                    "daily": {
                        "weather_code": [0],
                        "temperature_2m_min": [18.2],
                        "temperature_2m_max": [26.6],
                    }
                }
            )

        raise AssertionError(f"unexpected URL: {url}")

    install_fake_client(monkeypatch, FakeClient(handler))

    response = client.get("/api/weather?location=Hangzhou%2C%20China")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"] == "Clear, 18℃-27℃"


def test_weather_uses_requested_historical_date(monkeypatch):
    """Weather query should use the journal date instead of always fetching today."""

    def handler(url: str, params: dict) -> FakeResponse:
        if "geocoding-api.open-meteo.com" in url:
            return FakeResponse(
                {
                    "results": [
                        {
                            "name": "Hangzhou",
                            "country": "China",
                            "latitude": 30.25,
                            "longitude": 120.17,
                        }
                    ]
                }
            )

        if "api.open-meteo.com" in url:
            assert url == geocode.OPEN_METEO_ARCHIVE_URL
            assert params["start_date"] == "2024-02-03"
            assert params["end_date"] == "2024-02-03"
            assert "forecast_days" not in params
            return FakeResponse(
                {
                    "daily": {
                        "weather_code": [61],
                        "temperature_2m_min": [8.1],
                        "temperature_2m_max": [12.2],
                    }
                }
            )

        raise AssertionError(f"unexpected URL: {url}")

    install_fake_client(monkeypatch, FakeClient(handler))

    response = client.get("/api/weather?location=Hangzhou%2C%20China&date=2024-02-03")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"] == "Light rain, 8℃-12℃"


def test_weather_uses_forecast_for_future_requested_date(monkeypatch):
    """Future journal dates should stay on the forecast endpoint."""

    def handler(url: str, params: dict) -> FakeResponse:
        if "geocoding-api.open-meteo.com" in url:
            return FakeResponse(
                {
                    "results": [
                        {
                            "name": "Hangzhou",
                            "country": "China",
                            "latitude": 30.25,
                            "longitude": 120.17,
                        }
                    ]
                }
            )

        if "api.open-meteo.com" in url:
            assert url == geocode.OPEN_METEO_FORECAST_URL
            assert params["start_date"] == "2099-02-03"
            assert params["end_date"] == "2099-02-03"
            assert "forecast_days" not in params
            return FakeResponse(
                {
                    "daily": {
                        "weather_code": [2],
                        "temperature_2m_min": [7.4],
                        "temperature_2m_max": [13.2],
                    }
                }
            )

        raise AssertionError(f"unexpected URL: {url}")

    install_fake_client(monkeypatch, FakeClient(handler))

    response = client.get("/api/weather?location=Hangzhou%2C%20China&date=2099-02-03")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"] == "Partly cloudy, 7℃-13℃"


def test_weather_normalizes_common_chinese_city_country_aliases(monkeypatch):
    """Common Chinese aliases may be normalized before Open-Meteo lookup."""

    open_meteo_queries: list[str] = []

    def handler(url: str, params: dict) -> FakeResponse:
        if "geocoding-api.open-meteo.com" in url:
            open_meteo_queries.append(params["name"])
            if params["name"] == "杭州市, 中国":
                return FakeResponse({"results": []})

            assert params["name"] == "Hangzhou, China"
            return FakeResponse(
                {
                    "results": [
                        {
                            "name": "Hangzhou",
                            "country": "China",
                            "latitude": 30.25,
                            "longitude": 120.17,
                        }
                    ]
                }
            )

        if "api.open-meteo.com" in url:
            return FakeResponse(
                {
                    "daily": {
                        "weather_code": [3],
                        "temperature_2m_min": [11.4],
                        "temperature_2m_max": [19.6],
                    }
                }
            )

        raise AssertionError(f"unexpected URL: {url}")

    install_fake_client(monkeypatch, FakeClient(handler))

    response = client.get("/api/weather?location=杭州市，中国")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"] == "Overcast, 11℃-20℃"
    assert open_meteo_queries == ["杭州市, 中国", "Hangzhou, China"]


def test_weather_falls_back_to_nominatim_for_chinese_new_york(monkeypatch):
    """Chinese manual city input should resolve through geocoding, not per-city aliases."""

    def handler(url: str, params: dict) -> FakeResponse:
        if "geocoding-api.open-meteo.com" in url:
            assert params["name"] == "纽约, 美国"
            return FakeResponse({"results": []})

        if "nominatim.openstreetmap.org/search" in url:
            assert params["q"] == "纽约, 美国"
            assert params["accept-language"] == "en"
            return FakeResponse(
                [
                    {
                        "display_name": "New York, United States",
                        "lat": "40.7127281",
                        "lon": "-74.0060152",
                        "address": {"city": "New York", "country": "United States"},
                    }
                ]
            )

        if "api.open-meteo.com" in url:
            assert params["latitude"] == 40.7127281
            assert params["longitude"] == -74.0060152
            return FakeResponse(
                {
                    "daily": {
                        "weather_code": [95],
                        "temperature_2m_min": [24.8],
                        "temperature_2m_max": [30.2],
                    }
                }
            )

        raise AssertionError(f"unexpected URL: {url}")

    install_fake_client(monkeypatch, FakeClient(handler))

    response = client.get("/api/weather?location=纽约，美国")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"] == "Thunderstorm, 25℃-30℃"


def test_weather_falls_back_to_nominatim_for_chinese_los_angeles(monkeypatch):
    """The Los Angeles path must not depend on a hardcoded city-name alias."""

    def handler(url: str, params: dict) -> FakeResponse:
        if "geocoding-api.open-meteo.com" in url:
            assert params["name"] == "洛杉矶, 美国"
            return FakeResponse({"results": []})

        if "nominatim.openstreetmap.org/search" in url:
            assert params["q"] == "洛杉矶, 美国"
            return FakeResponse(
                [
                    {
                        "display_name": "Los Angeles, Los Angeles County, California, United States",
                        "lat": "34.0536909",
                        "lon": "-118.2427660",
                        "address": {"city": "Los Angeles", "country": "United States"},
                    }
                ]
            )

        if "api.open-meteo.com" in url:
            assert params["latitude"] == 34.0536909
            assert params["longitude"] == -118.242766
            return FakeResponse(
                {
                    "daily": {
                        "weather_code": [45],
                        "temperature_2m_min": [14.7],
                        "temperature_2m_max": [26.8],
                    }
                }
            )

        raise AssertionError(f"unexpected URL: {url}")

    install_fake_client(monkeypatch, FakeClient(handler))

    response = client.get("/api/weather?location=洛杉矶，美国")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"] == "Fog, 15℃-27℃"


def test_weather_falls_back_to_nominatim_for_non_alias_tokyo_input(monkeypatch):
    """Provider fallback must handle non-Chinese, non-alias scripts without city mappings."""

    def handler(url: str, params: dict) -> FakeResponse:
        if "geocoding-api.open-meteo.com" in url:
            assert params["name"] == "東京, 日本"
            return FakeResponse({"results": []})

        if "nominatim.openstreetmap.org/search" in url:
            assert params["q"] == "東京, 日本"
            assert params["accept-language"] == "en"
            return FakeResponse(
                [
                    {
                        "display_name": "Tokyo, Japan",
                        "lat": "35.6768601",
                        "lon": "139.7638947",
                        "address": {"city": "Tokyo", "country": "Japan"},
                    }
                ]
            )

        if "api.open-meteo.com" in url:
            assert params["latitude"] == 35.6768601
            assert params["longitude"] == 139.7638947
            return FakeResponse(
                {
                    "daily": {
                        "weather_code": [1],
                        "temperature_2m_min": [21.1],
                        "temperature_2m_max": [27.4],
                    }
                }
            )

        raise AssertionError(f"unexpected URL: {url}")

    install_fake_client(monkeypatch, FakeClient(handler))

    response = client.get("/api/weather?location=東京,日本")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"] == "Mainly clear, 21℃-27℃"


def test_weather_returns_controlled_error_when_location_is_not_found(monkeypatch):
    """Unknown manual location input should stay editable and return an API error."""

    def handler(url: str, params: dict) -> FakeResponse:
        if "geocoding-api.open-meteo.com" in url:
            assert params["name"] == "Unlisted Place"
            return FakeResponse({"results": []})

        if "nominatim.openstreetmap.org/search" in url:
            assert params["q"] == "Unlisted Place"
            return FakeResponse([])

        raise AssertionError(f"unexpected URL: {url}")

    install_fake_client(monkeypatch, FakeClient(handler))

    response = client.get("/api/weather?location=Unlisted%20Place")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "WEATHER_ERROR"


def test_weather_does_not_fallback_to_nominatim_when_open_meteo_errors(monkeypatch):
    """Provider outages should return a controlled error instead of shifting load to Nominatim."""

    calls: list[str] = []

    def handler(url: str, params: dict) -> FakeResponse:
        calls.append(url)
        if "geocoding-api.open-meteo.com" in url:
            return FakeResponse({"error": "temporary outage"}, status_code=503)

        if "nominatim.openstreetmap.org/search" in url:
            raise AssertionError("Nominatim fallback must not run after Open-Meteo HTTP errors")

        raise AssertionError(f"unexpected URL: {url}")

    install_fake_client(monkeypatch, FakeClient(handler))

    response = client.get("/api/weather?location=東京,日本")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "WEATHER_ERROR"
    assert calls == [geocode.OPEN_METEO_GEOCODING_URL]
