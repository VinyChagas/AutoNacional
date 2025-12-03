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
    Popula o banco mock com empresas baseadas nos certificados existentes.
    
    Extrai CNPJs dos nomes dos arquivos de certificado e cria empresas.
    """
    import sys
    backend_dir = Path(__file__).parent.parent.parent
    
    # Adiciona src ao path para importar configurações
    src_path = backend_dir / "src"
    if str(src_path) not in sys.path:
        sys.path.insert(0, str(src_path))
    
    try:
        from infrastructure.config import CERTIFICATES_DIR
        BASE_DIR = CERTIFICATES_DIR
    except ImportError:
        # Fallback: define BASE_DIR diretamente
        BASE_DIR = backend_dir / "certificados_armazenados"
    
    conn = get_mock_conn()
    cursor = conn.cursor()
    
    # Busca todos os arquivos .pfx.enc
    certificados_dir = Path(BASE_DIR)
    arquivos_pfx = list(certificados_dir.glob("*.pfx.enc"))
    
    empresas_criadas = 0
    empresas_atualizadas = 0
    
    for arquivo_pfx in arquivos_pfx:
        # Extrai CNPJ do nome do arquivo (formato: CNPJ.pfx.enc)
        cnpj = arquivo_pfx.stem.replace(".pfx", "").strip()
        
        # Valida CNPJ (deve ter 14 dígitos)
        cnpj_limpo = cnpj.replace(".", "").replace("/", "").replace("-", "").strip()
        if len(cnpj_limpo) != 14 or not cnpj_limpo.isdigit():
            logger.warning(f"CNPJ inválido no arquivo {arquivo_pfx.name}: {cnpj_limpo}")
            continue
        
        # Verifica se empresa já existe
        cursor.execute("SELECT id FROM empresas WHERE cnpj = ?", (cnpj_limpo,))
        empresa_existente = cursor.fetchone()
        
        if empresa_existente:
            empresas_atualizadas += 1
            continue
        
        # Cria empresa mock
        empresa_id = f"empresa-{cnpj_limpo}"
        razao_social = f"Empresa {cnpj_limpo[:8]}"
        regime = "SIMPLES"  # Default
        
        try:
            cursor.execute("""
                INSERT INTO empresas (id, cnpj, razao_social, regime, ativo)
                VALUES (?, ?, ?, ?, 1)
            """, (empresa_id, cnpj_limpo, razao_social, regime))
            empresas_criadas += 1
            logger.info(f"✅ Empresa criada: {razao_social} (CNPJ: {cnpj_limpo})")
        except sqlite3.IntegrityError:
            # Empresa já existe
            empresas_atualizadas += 1
    
    conn.commit()
    conn.close()
    
    logger.info(f"📊 Banco mock populado: {empresas_criadas} empresas criadas, {empresas_atualizadas} já existiam")
    return empresas_criadas, empresas_atualizadas


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

