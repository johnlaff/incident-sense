"""HTTP API routers, aggregated under the ``/api`` prefix.

``main.py`` includes a single ``api_router``; new endpoints register their
sub-router here so the wiring stays in one place.
"""

from fastapi import APIRouter

from .health import router as health_router

api_router = APIRouter(prefix="/api")
api_router.include_router(health_router)

__all__ = ["api_router"]
