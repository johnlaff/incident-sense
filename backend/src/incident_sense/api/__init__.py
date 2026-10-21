"""HTTP API routers, aggregated under the ``/api`` prefix.

``main.py`` includes a single ``api_router``; new endpoints register their
sub-router here so the wiring stays in one place.
"""

from fastapi import APIRouter

from .ask import router as ask_router
from .changes import router as changes_router
from .clusters import router as clusters_router
from .health import router as health_router
from .incidents import router as incidents_router
from .problems import router as problems_router
from .suggest import router as suggest_router

api_router = APIRouter(prefix="/api")
api_router.include_router(health_router)
api_router.include_router(incidents_router)
api_router.include_router(problems_router)
api_router.include_router(clusters_router)
api_router.include_router(suggest_router)
api_router.include_router(ask_router)
api_router.include_router(changes_router)

__all__ = ["api_router"]
