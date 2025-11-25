import os
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_JWKS_URL = os.getenv("SUPABASE_JWKS_URL")
SUPABASE_AUDIENCE = os.getenv("SUPABASE_AUDIENCE", "authenticated")
SUPABASE_ISSUER = os.getenv("SUPABASE_ISSUER")

DATABASE_URL = os.getenv("DATABASE_URL")
APP_CRED_KEY = os.getenv("APP_CRED_KEY")

INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY")

CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]