"""
Sistema de banco de dados mock usando SQLite.

Este módulo cria um banco SQLite local quando DATABASE_URL não está definida,
permitindo que o sistema funcione sem configuração de PostgreSQL.
"""

import sqlite3
import os
from pathlib import Path
from typing import Optional
import logging

logger = logging.getLogger(__name__)

# Caminho do banco SQLite mock
BACKEND_DIR = Path(__file__).parent.parent.parent
DB_MOCK_PATH = BACKEND_DIR / "db_mock.sqlite"


def get_mock_conn():
    """Cria conexão com o banco SQLite mock."""
    # Garante que o diretório existe
    DB_MOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    
    conn = sqlite3.connect(str(DB_MOCK_PATH))
    conn.row_factory = sqlite3.Row  # Retorna resultados como dict
    
    # Cria tabelas se não existirem
    _criar_tabelas(conn)
    
    return conn


def _criar_tabelas(conn: sqlite3.Connection):
    """Cria as tabelas necessárias no banco mock."""
    cursor = conn.cursor()
    
    # Tabela de empresas
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS empresas (
            id TEXT PRIMARY KEY,
            cnpj TEXT UNIQUE NOT NULL,
            razao_social TEXT NOT NULL,
            regime TEXT,
            ativo BOOLEAN DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Tabela de contabilidades
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS contabilidades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome_contabilidade TEXT NOT NULL,
            cnpj TEXT UNIQUE NOT NULL,
            email TEXT,
            telefone TEXT,
            responsavel TEXT,
            data_cadastro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_contabilidades_cnpj ON contabilidades (cnpj)")
    
    # Tabela de certificados digitais com regra ON DELETE SET NULL para FK contabilidade_id
    # Regra: exclusão da contabilidade NÃO apaga certificados, mas os desvincula (contabilidade_id vira NULL)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS certificados_digitais (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cnpj TEXT NOT NULL,
            arquivo TEXT,
            data_validade TEXT,
            empresa_id TEXT,
            contabilidade_id INTEGER,
            data_cadastro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(contabilidade_id) REFERENCES contabilidades(id) ON DELETE SET NULL
        )
    """)
    # ALTER TABLE para adicionar FK se já existir (fallback)
    try:
        cursor.execute("PRAGMA foreign_keys=off;")
        cursor.execute("ALTER TABLE certificados_digitais ADD COLUMN contabilidade_id INTEGER;")
        cursor.execute("PRAGMA foreign_keys=on;")
    except sqlite3.OperationalError:
        pass  # coluna já existe, ignora erro
    
    conn.commit()


def popular_banco_mock():
    """
    (Modo atual) Mantém o banco mock *zerado* de empresas.

    Antes este método lia os arquivos de certificados e criava empresas mock.
    Para o seu cenário, queremos um banco totalmente vazio, então:
    - apagamos todos os registros da tabela `empresas`
    - não criamos nada novo
    """
    conn = get_mock_conn()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM empresas")
        conn.commit()
        empresas_criadas = 0
        empresas_atualizadas = 0
        logger.info(
            f"📊 Banco mock LIMPO: {empresas_criadas} empresas criadas, {empresas_atualizadas} já existiam"
        )
        return empresas_criadas, empresas_atualizadas
    finally:
        conn.close()


def get_mock_conn_dict():
    """
    Retorna uma conexão que funciona como dict_row do psycopg.
    Cria um wrapper para compatibilidade.
    """
    class DictRow:
        def __init__(self, row, keys):
            self._row = row
            self._keys = keys
        
        def __getitem__(self, key):
            return self._row[self._keys.index(key)]
        
        def get(self, key, default=None):
            try:
                return self._row[self._keys.index(key)]
            except (ValueError, IndexError):
                return default
        
        def keys(self):
            return self._keys
    
    conn = get_mock_conn()
    cursor = conn.cursor()
    
    # Modifica o row_factory para retornar dict-like objects
    def dict_factory(cursor, row):
        return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}
    
    conn.row_factory = dict_factory
    return conn

