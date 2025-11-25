from ..core.db import get_conn, set_crypto_key

def upsert_credencial(empresa_id: str, portal: str, usuario: str, senha: str):
    with get_conn() as c, c.cursor() as cur:
        set_crypto_key(cur)
        cur.execute("""
            insert into public.portais_credenciais (empresa_id, portal, usuario, senha_encrypted)
            values (%s, %s, %s, pgp_sym_encrypt(%s, current_setting('app.cred_key'))::bytea)
            on conflict (empresa_id, portal) do update
            set usuario=excluded.usuario,
                senha_encrypted=excluded.senha_encrypted,
                atualizado_em=now()
            returning id, empresa_id, portal, usuario, atualizado_em
        """, (empresa_id, portal, usuario, senha))
        row = cur.fetchone()
        c.commit()
        return row