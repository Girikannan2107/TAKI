"""E21–E22: file metadata with a fresh signed URL, and signed content streaming."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Path, Query
from fastapi.responses import Response

from app.deps import UserDep
from app.schemas.common import FileDTO
from app.schemas.errors import error_responses
from app.services import file_service

router = APIRouter(prefix="/files", tags=["files"])

FileIdPath = Annotated[str, Path(pattern=r"^fil_[a-z0-9]{20}$")]


@router.get("/{file_id}", response_model=FileDTO, responses=error_responses(401, 403, 404))
async def get_file(file_id: FileIdPath, user: UserDep) -> FileDTO:
    return await file_service.get_file_for_viewer(user, file_id)


@router.get(
    "/{file_id}/content",
    response_class=Response,
    responses={200: {"content": {"application/octet-stream": {}}}, **error_responses(403, 404)},
)
async def file_content(
    file_id: FileIdPath,
    exp: Annotated[int, Query()],
    v: Annotated[str, Query(pattern=r"^[A-Za-z0-9]{1,128}$")],
    sig: Annotated[str, Query(max_length=128)],
) -> Response:
    data, content_type = await file_service.read_signed_content(file_id, exp, v, sig)
    return Response(
        content=data,
        media_type=content_type,
        headers={
            "Cache-Control": "private, max-age=300",
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'",
        },
    )
