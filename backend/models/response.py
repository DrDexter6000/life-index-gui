"""Unified API response models."""

from typing import Any, Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class APIResponse(BaseModel, Generic[T]):
    """Standard response envelope for all API endpoints."""

    ok: bool
    data: T | None = None
    error: dict[str, Any] | None = None
    meta: dict[str, Any] | None = None

    @classmethod
    def success(
        cls, data: T, meta: dict[str, Any] | None = None
    ) -> "APIResponse[T]":
        return cls(ok=True, data=data, meta=meta)

    @classmethod
    def error_response(
        cls,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> "APIResponse[None]":
        error_dict: dict[str, Any] = {"code": code, "message": message}
        if details is not None:
            error_dict["details"] = details
        return cls(ok=False, error=error_dict)
