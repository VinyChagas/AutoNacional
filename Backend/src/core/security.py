from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials, APIKeyHeader
from jose import jwt
import httpx
from functools import lru_cache
from .env import SUPABASE_JWKS_URL, SUPABASE_AUDIENCE, SUPABASE_ISSUER, INTERNAL_API_KEY

bearer_scheme = HTTPBearer(auto_error=True)
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

@lru_cache(maxsize=1)
def get_jwks():
    with httpx.Client(timeout=10) as client:
        return client.get(SUPABASE_JWKS_URL).json()

def get_current_user(token: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    try:
        jwks = get_jwks()
        header = jwt.get_unverified_header(token.credentials)
        kid = header.get("kid")
        key = next((k for k in jwks["keys"] if k["kid"] == kid), None)
        if not key:
            raise HTTPException(status_code=401, detail="Invalid auth header")
        payload = jwt.decode(
            token.credentials,
            key,
            algorithms=[key["alg"]],
            audience=SUPABASE_AUDIENCE,
            issuer=SUPABASE_ISSUER,
            options={"verify_at_hash": False},  # compat com supabase
        )
        return payload  # você pode mapear para um objeto User se quiser
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

def require_api_key(x_api_key: str | None = Depends(api_key_header)):
    if not x_api_key or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(status_code=401, detail="Missing/invalid API key")
    return True