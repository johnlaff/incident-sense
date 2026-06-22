"""HTTP API routers, aggregated under the ``/api`` prefix.

``main.py`` includes a single ``api_router``; new endpoints register their
sub-router here so the wiring stays in one place.
"""

from fastapi import APIRouter

from .clusters import router as clusters_router
from .health import router as health_router
from .incidents import router as incidents_router
from .suggest import router as suggest_router

api_router = APIRouter(prefix="/api")
api_router.include_router(health_router)
api_router.include_router(incidents_router)
api_router.include_router(clusters_router)
api_router.include_router(suggest_router)

__all__ = ["api_router"]
