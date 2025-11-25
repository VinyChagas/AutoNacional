import psycopg
from psycopg.rows import dict_row
from .env import DATABASE_URL, APP_CRED_KEY

def get_conn():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)

def set_crypto_key(cur):
    cur.execute("select set_config('app.cred_key', %s, false);", (APP_CRED_KEY,))