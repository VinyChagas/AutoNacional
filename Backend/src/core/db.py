import psycopg
from psycopg.rows import dict_row
from ..infrastructure.config import DATABASE_URL, APP_CRED_KEY

# Flag para indicar se está usando banco mock
_using_mock_db = False

def get_conn():
    """
    Retorna conexão com o banco de dados.
    Se DATABASE_URL não estiver definida, usa banco SQLite mock.
    """
    global _using_mock_db
    
    if not DATABASE_URL:
        # Usa banco mock SQLite
        _using_mock_db = True
        from .db_mock import get_mock_conn_dict, popular_banco_mock
        
        # Popula banco mock na primeira vez (só uma vez)
        if not hasattr(get_conn, '_mock_populated'):
            try:
                popular_banco_mock()
                get_conn._mock_populated = True
            except Exception as e:
                import logging
                logging.warning(f"Erro ao popular banco mock: {e}")
        
        return get_mock_conn_dict()
    
    _using_mock_db = False
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)

def set_crypto_key(cur):
    """Define chave de criptografia (apenas para PostgreSQL)."""
    global _using_mock_db
    if not _using_mock_db:
        cur.execute("select set_config('app.cred_key', %s, false);", (APP_CRED_KEY,))