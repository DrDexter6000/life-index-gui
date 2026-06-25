"""Geocode router — transient location and weather enrichment."""

from datetime import date as calendar_date
import logging
from typing import Any

import httpx
from fastapi import APIRouter, Query
from backend.models.response import APIResponse

router = APIRouter(tags=["geocode"])

logger = logging.getLogger(__name__)

NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"
NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
OPEN_METEO_GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
USER_AGENT = "LifeIndex-GUI/0.1.0"

# Module-level async client for connection reuse
_httpx_client: httpx.AsyncClient | None = None

CITY_ADDRESS_KEYS = ("city", "town", "village", "municipality")
DISPLAY_ADMIN_MARKERS = (
    "district",
    "county",
    "province",
    "prefecture",
    "region",
    "state",
    "oblast",
    "governorate",
    "department",
)

WEATHER_CODE_LABELS = {
    0: "Clear",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Freezing drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Freezing rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Light rain showers",
    81: "Rain showers",
    82: "Heavy rain showers",
    85: "Light snow showers",
    86: "Snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Thunderstorm with hail",
}

COUNTRY_NAME_ALIASES = {
    "中国": "China",
    "中华人民共和国": "China",
    "美国": "United States",
    "英国": "United Kingdom",
    "日本": "Japan",
    "韩国": "South Korea",
    "法国": "France",
    "德国": "Germany",
    "意大利": "Italy",
    "西班牙": "Spain",
    "加拿大": "Canada",
    "澳大利亚": "Australia",
    "新加坡": "Singapore",
    "泰国": "Thailand",
    "马来西亚": "Malaysia",
}

CITY_NAME_ALIASES = {
    "北京": "Beijing",
    "上海": "Shanghai",
    "广州": "Guangzhou",
    "深圳": "Shenzhen",
    "杭州": "Hangzhou",
    "南京": "Nanjing",
    "苏州": "Suzhou",
    "成都": "Chengdu",
    "重庆": "Chongqing",
    "天津": "Tianjin",
    "武汉": "Wuhan",
    "西安": "Xi'an",
    "厦门": "Xiamen",
    "青岛": "Qingdao",
    "宁波": "Ningbo",
    "长沙": "Changsha",
    "郑州": "Zhengzhou",
    "合肥": "Hefei",
    "福州": "Fuzhou",
    "济南": "Jinan",
    "昆明": "Kunming",
    "香港": "Hong Kong",
    "澳门": "Macau",
    "台北": "Taipei",
}

LOCATION_SUFFIXES = (
    "特别行政区",
    "自治区",
    "自治州",
    "地区",
    "城市",
    "市",
    "省",
)


async def _get_httpx_client() -> httpx.AsyncClient:
    """Return a shared AsyncClient instance."""
    global _httpx_client
    if _httpx_client is None:
        _httpx_client = httpx.AsyncClient(
            timeout=httpx.Timeout(5.0),
            headers={"User-Agent": USER_AGENT},
        )
    return _httpx_client


def _clean_place_name(value: object) -> str:
    text = str(value or "").strip()
    for suffix in (" State", " City"):
        if text.endswith(suffix):
            text = text[: -len(suffix)]
    return text.strip()


def _looks_like_admin_part(value: str) -> bool:
    lower = value.lower()
    return any(marker in lower for marker in DISPLAY_ADMIN_MARKERS)


def _display_parts(display_name: str) -> list[str]:
    return [part.strip() for part in display_name.split(",") if part.strip()]


def _country_from_display(display_name: str) -> str:
    parts = _display_parts(display_name)
    return _clean_place_name(parts[-1]) if parts else ""


def _known_admin_values(address: dict[str, Any]) -> set[str]:
    values: set[str] = set()
    for key in (
        "suburb",
        "city_district",
        "county",
        "state_district",
        "state",
        "postcode",
    ):
        value = _clean_place_name(address.get(key))
        if value:
            values.add(value)
    return values


def _city_from_display(display_name: str, country: str, known_admin_values: set[str]) -> str:
    for part in reversed(_display_parts(display_name)):
        cleaned = _clean_place_name(part)
        if not cleaned:
            continue
        if country and cleaned == country:
            continue
        if cleaned in known_admin_values:
            continue
        if _looks_like_admin_part(cleaned):
            continue
        return cleaned
    return ""


def _format_city_country(data: dict[str, Any]) -> str:
    address = data.get("address") if isinstance(data.get("address"), dict) else {}
    display_name = str(data.get("display_name") or "")
    country = _clean_place_name(address.get("country")) or _country_from_display(display_name)
    known_admin_values = _known_admin_values(address)

    city = ""
    for key in CITY_ADDRESS_KEYS:
        city = _clean_place_name(address.get(key))
        if city and not _looks_like_admin_part(city):
            break
        city = ""

    if not city:
        city = _city_from_display(display_name, country, known_admin_values)

    if not city:
        city = _clean_place_name(address.get("state"))

    if city and country:
        return f"{city}, {country}"
    if city:
        return city
    if country:
        return country
    return display_name


def _weather_label(code: object) -> str:
    try:
        numeric_code = int(code)
    except (TypeError, ValueError):
        return "Weather"
    return WEATHER_CODE_LABELS.get(numeric_code, "Weather")


def _round_celsius(value: object) -> int:
    return int(round(float(value)))


def _first_daily_value(daily: dict[str, Any], key: str) -> object:
    values = daily.get(key)
    if not isinstance(values, list) or not values:
        raise ValueError(f"Missing daily weather value: {key}")
    return values[0]


def _format_weather(data: dict[str, Any]) -> str:
    daily = data.get("daily")
    if not isinstance(daily, dict):
        raise ValueError("Missing daily forecast")

    label = _weather_label(_first_daily_value(daily, "weather_code"))
    low = _round_celsius(_first_daily_value(daily, "temperature_2m_min"))
    high = _round_celsius(_first_daily_value(daily, "temperature_2m_max"))
    return f"{label}, {low}℃-{high}℃"


def _weather_url_for_date(journal_date: str | None) -> str:
    if journal_date and calendar_date.fromisoformat(journal_date) < calendar_date.today():
        return OPEN_METEO_ARCHIVE_URL
    return OPEN_METEO_FORECAST_URL


def _strip_location_suffix(value: str) -> str:
    text = value.strip()
    for suffix in LOCATION_SUFFIXES:
        if text.endswith(suffix) and len(text) > len(suffix):
            return text[: -len(suffix)].strip()
    return text


def _normalize_location_part(value: str) -> str:
    text = value.strip()
    if not text:
        return ""

    if text in CITY_NAME_ALIASES:
        return CITY_NAME_ALIASES[text]
    if text in COUNTRY_NAME_ALIASES:
        return COUNTRY_NAME_ALIASES[text]

    stripped = _strip_location_suffix(text)
    if stripped in CITY_NAME_ALIASES:
        return CITY_NAME_ALIASES[stripped]
    if stripped in COUNTRY_NAME_ALIASES:
        return COUNTRY_NAME_ALIASES[stripped]

    return text


def _normalize_weather_location(location: str) -> str:
    normalized = (
        location.strip()
        .replace("，", ",")
        .replace("、", ",")
        .replace("；", ",")
        .replace(";", ",")
    )
    parts = [
        _normalize_location_part(part)
        for part in normalized.split(",")
        if part.strip()
    ]
    return ", ".join(part for part in parts if part) or normalized


def _normalize_search_location(location: str) -> str:
    normalized = (
        location.strip()
        .replace("，", ",")
        .replace("、", ",")
        .replace("；", ",")
        .replace(";", ",")
    )
    parts = [part.strip() for part in normalized.split(",") if part.strip()]
    return ", ".join(parts) or normalized


def _weather_location_candidates(location: str) -> list[str]:
    """Return provider lookup candidates without growing city translation tables.

    The first candidate keeps the user's multilingual input intact so geocoding
    providers can resolve scripts/languages themselves. The legacy alias path is
    only a second Open-Meteo attempt when the place/city part changes, preserving
    existing common Chinese-city behavior without partially translating country
    names for otherwise unknown cities.
    """

    raw_location = _normalize_search_location(location)
    aliased_location = _normalize_weather_location(location)
    if aliased_location == raw_location:
        return [raw_location]

    raw_place = raw_location.split(",", 1)[0].strip()
    aliased_place = aliased_location.split(",", 1)[0].strip()
    if raw_place == aliased_place:
        return [raw_location]

    return [raw_location, aliased_location]


def _coordinates_from_open_meteo_results(data: dict[str, Any]) -> tuple[float, float] | None:
    results = data.get("results")
    if not isinstance(results, list) or not results:
        return None

    first = results[0]
    return float(first["latitude"]), float(first["longitude"])


def _coordinates_from_nominatim_results(data: object) -> tuple[float, float] | None:
    if not isinstance(data, list) or not data:
        return None

    first = data[0]
    if not isinstance(first, dict):
        return None

    return float(first["lat"]), float(first["lon"])


async def _resolve_weather_coordinates(
    client: httpx.AsyncClient,
    location: str,
) -> tuple[float, float]:
    """Resolve user-entered location to coordinates for forecast lookup."""
    for lookup_location in _weather_location_candidates(location):
        geocode_resp = await client.get(
            OPEN_METEO_GEOCODING_URL,
            params={
                "name": lookup_location,
                "count": 1,
                "language": "en",
                "format": "json",
            },
        )
        geocode_resp.raise_for_status()
        coordinates = _coordinates_from_open_meteo_results(geocode_resp.json())
        if coordinates:
            return coordinates

    search_resp = await client.get(
        NOMINATIM_SEARCH_URL,
        params={
            "q": _normalize_search_location(location),
            "format": "jsonv2",
            "addressdetails": 1,
            "limit": 1,
            "accept-language": "en",
        },
    )
    search_resp.raise_for_status()
    coordinates = _coordinates_from_nominatim_results(search_resp.json())
    if coordinates:
        return coordinates

    raise ValueError("No matching location found")


@router.get("/geocode")
async def reverse_geocode(
    lat: float = Query(..., description="Latitude"),
    lng: float = Query(..., description="Longitude"),
) -> APIResponse:
    """Reverse geocode coordinates to a location name using Nominatim."""
    try:
        params = {
            "lat": lat,
            "lon": lng,
            "format": "json",
            "accept-language": "en",
            "zoom": 10,
        }

        client = await _get_httpx_client()
        resp = await client.get(NOMINATIM_REVERSE_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

        location = _format_city_country(data)

        return APIResponse.success(location)

    except httpx.HTTPStatusError as e:
        logger.warning("Geocode HTTP error for %s,%s: %s", lat, lng, e)
        return APIResponse.error_response(
            "GEOCODE_ERROR",
            "暂时无法获取位置信息，请手动输入",
        )
    except httpx.RequestError as e:
        logger.warning("Geocode request failed for %s,%s: %s", lat, lng, e)
        return APIResponse.error_response(
            "GEOCODE_ERROR",
            "暂时无法获取位置信息，请手动输入",
        )
    except Exception as e:
        logger.warning("Geocode unexpected error: %s", e)
        return APIResponse.error_response(
            "GEOCODE_ERROR",
            "暂时无法获取位置信息，请手动输入",
        )


@router.get("/weather")
async def weather(
    location: str = Query(..., min_length=2, description="City, Country"),
    date: str | None = Query(
        default=None,
        pattern=r"^\d{4}-\d{2}-\d{2}$",
        description="Journal date in YYYY-MM-DD for historical weather",
    ),
) -> APIResponse:
    """Resolve a city/country string to an English weather summary."""
    try:
        client = await _get_httpx_client()
        latitude, longitude = await _resolve_weather_coordinates(client, location)

        weather_params: dict[str, object] = {
            "latitude": latitude,
            "longitude": longitude,
            "daily": "weather_code,temperature_2m_min,temperature_2m_max",
            "temperature_unit": "celsius",
            "timezone": "auto",
        }
        if date:
            weather_params["start_date"] = date
            weather_params["end_date"] = date
        else:
            weather_params["forecast_days"] = 1

        forecast_resp = await client.get(
            _weather_url_for_date(date),
            params=weather_params,
        )
        forecast_resp.raise_for_status()

        return APIResponse.success(_format_weather(forecast_resp.json()))

    except httpx.HTTPStatusError as e:
        logger.warning("Weather HTTP error for %s: %s", location, e)
        return APIResponse.error_response(
            "WEATHER_ERROR",
            "暂时无法获取天气信息，请手动输入",
        )
    except httpx.RequestError as e:
        logger.warning("Weather request failed for %s: %s", location, e)
        return APIResponse.error_response(
            "WEATHER_ERROR",
            "暂时无法获取天气信息，请手动输入",
        )
    except Exception as e:
        logger.warning("Weather unexpected error for %s: %s", location, e)
        return APIResponse.error_response(
            "WEATHER_ERROR",
            "暂时无法获取天气信息，请手动输入",
        )
