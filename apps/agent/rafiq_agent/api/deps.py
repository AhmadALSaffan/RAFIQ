from fastapi import Header, HTTPException, status

from rafiq_agent.config import AUTH_TOKEN


async def require_token(authorization: str | None = Header(default=None)) -> None:
    if authorization != f"Bearer {AUTH_TOKEN}":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid or missing token")
