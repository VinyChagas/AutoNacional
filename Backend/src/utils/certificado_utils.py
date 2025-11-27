"""
Utilitários para manipulação de certificados digitais ICP-Brasil.
"""

import re
from typing import Optional, Tuple
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography import x509
from fastapi import HTTPException

from ..infrastructure.logger import get_logger

logger = get_logger(__name__)


def validar_pfx(conteudo_pfx: bytes, senha: str) -> Tuple:
    """
    Valida se o arquivo .pfx e a senha são válidos usando cryptography.
    
    Args:
        conteudo_pfx: Conteúdo do arquivo .pfx em bytes
        senha: Senha do certificado
        
    Returns:
        Tupla (key, cert, additional_certs) se válido
        
    Raises:
        HTTPException: Se o certificado ou senha forem inválidos
    """
    try:
        senha_bytes = senha.encode('utf-8') if senha else None
        
        try:
            key, cert, additional_certs = pkcs12.load_key_and_certificates(
                conteudo_pfx, 
                senha_bytes
            )
        except ValueError as e:
            error_msg = str(e).lower()
            if "mac" in error_msg or "password" in error_msg or "bad decrypt" in error_msg:
                raise HTTPException(
                    status_code=400,
                    detail="Senha do certificado incorreta"
                )
            raise HTTPException(
                status_code=400,
                detail=f"Erro ao carregar certificado PKCS12: {str(e)}"
            )
        
        if cert is None:
            raise HTTPException(
                status_code=400,
                detail="Certificado não encontrado no arquivo PKCS12"
            )
        
        return key, cert, additional_certs
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao validar certificado: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=400,
            detail=f"Certificado inválido ou senha incorreta: {str(e)}"
        )


def extrair_cnpj_do_texto(texto: str) -> Optional[str]:
    """
    Extrai CNPJ de um texto, tentando vários formatos.
    
    Args:
        texto: Texto que pode conter um CNPJ
        
    Returns:
        CNPJ apenas com números (14 dígitos) ou None se não encontrado
    """
    if not texto:
        return None
    
    # Remove espaços e converte para maiúsculo
    texto = texto.strip().upper()
    
    # Tenta encontrar padrão CNPJ em vários formatos
    # Ordem de prioridade: formatos mais específicos primeiro
    padroes = [
        # CNPJ: 00.000.000/0000-00 ou CNPJ 00.000.000/0000-00
        r'CNPJ[:\s\-]*(\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2})',
        # 00.000.000/0000-00 (formato completo com pontuação)
        r'(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})',
        # 00000000000000 (14 dígitos consecutivos - mais específico)
        r'\b(\d{14})\b',
        # 00.000.000/0000-00 (formato flexível)
        r'(\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2})',
        # Qualquer sequência de 14 dígitos (último recurso)
        r'(\d{14})',
    ]
    
    for padrao in padroes:
        match = re.search(padrao, texto)
        if match:
            cnpj = match.group(1) if match.lastindex and match.lastindex >= 1 else match.group(0)
            # Remove formatação
            cnpj_limpo = re.sub(r'[^\d]', '', cnpj)
            # Valida que tem exatamente 14 dígitos
            if len(cnpj_limpo) == 14:
                # Validação básica: não pode ser tudo zeros
                if cnpj_limpo != '0' * 14:
                    return cnpj_limpo
    
    return None


def extrair_informacoes_certificado(
    conteudo_pfx: bytes, 
    senha: str, 
    debug: bool = False
) -> dict:
    """
    Extrai informações do certificado digital ICP-Brasil.
    
    Args:
        conteudo_pfx: Conteúdo do arquivo .pfx em bytes
        senha: Senha do certificado
        debug: Se True, imprime logs de debug (padrão: False)
        
    Returns:
        Dict com: empresa (nome), cnpj, cnpj_limpo, dataVencimento
        
    Raises:
        HTTPException: Se houver erro ao processar o certificado
    """
    try:
        # Carrega o certificado
        key, cert, additional_certs = validar_pfx(conteudo_pfx, senha)
        
        # Extrai informações do subject
        subject = cert.subject
        nome_empresa = None
        cnpj = None
        
        # Debug: imprime todos os atributos do subject para análise
        if debug:
            logger.debug("=" * 60)
            logger.debug("Analisando atributos do certificado:")
            for attr in subject:
                logger.debug(f"  OID: {attr.oid}, Nome: {attr.oid._name}, Valor: {attr.value}")
            logger.debug("=" * 60)
        
        # Prioridade 1: Tenta extrair CNPJ do Common Name (CN)
        for attr in subject:
            if attr.oid == x509.NameOID.COMMON_NAME:
                nome_empresa_completo = attr.value
                if debug:
                    logger.debug(f"Common Name encontrado: {nome_empresa_completo}")
                
                # Verifica se tem ":" no Common Name (formato comum: "NOME:CNPJ")
                if ':' in nome_empresa_completo:
                    partes = nome_empresa_completo.split(':', 1)
                    nome_empresa = partes[0].strip()
                    parte_cnpj = partes[1].strip() if len(partes) > 1 else ''
                    
                    if debug:
                        logger.debug(f"Common Name dividido - Nome: '{nome_empresa}', Parte CNPJ: '{parte_cnpj}'")
                    
                    # Tenta extrair CNPJ da parte após ":"
                    cnpj_extraido = extrair_cnpj_do_texto(parte_cnpj)
                    if cnpj_extraido:
                        cnpj = cnpj_extraido
                        if debug:
                            logger.debug(f"CNPJ extraído do Common Name (após ':'): {cnpj}")
                    else:
                        # Se não encontrou após ":", tenta no Common Name inteiro
                        nome_empresa = nome_empresa_completo
                        cnpj_extraido = extrair_cnpj_do_texto(nome_empresa_completo)
                        if cnpj_extraido:
                            cnpj = cnpj_extraido
                            if debug:
                                logger.debug(f"CNPJ extraído do Common Name completo: {cnpj}")
                else:
                    # Se não tem ":", usa o Common Name completo como nome
                    nome_empresa = nome_empresa_completo
                    # Tenta extrair CNPJ do CN também
                    if not cnpj:
                        cnpj = extrair_cnpj_do_texto(attr.value)
                        if cnpj and debug:
                            logger.debug(f"CNPJ extraído do CN: {cnpj}")
        
        # Prioridade 2: Tenta extrair CNPJ do Organizational Unit (OU)
        if not cnpj:
            for attr in subject:
                if attr.oid == x509.NameOID.ORGANIZATIONAL_UNIT_NAME:
                    valor_ou = attr.value
                    if debug:
                        logger.debug(f"OU encontrado: {valor_ou}")
                    cnpj_extraido = extrair_cnpj_do_texto(valor_ou)
                    if cnpj_extraido:
                        cnpj = cnpj_extraido
                        if debug:
                            logger.debug(f"CNPJ extraído do OU: {cnpj}")
                        break
        
        # Prioridade 3: Verifica OID específico do ICP-Brasil para CNPJ (2.16.76.1.3.3)
        if not cnpj:
            try:
                cnpj_oid = x509.ObjectIdentifier("2.16.76.1.3.3")
                for attr in subject:
                    if attr.oid == cnpj_oid:
                        cnpj = extrair_cnpj_do_texto(attr.value)
                        if cnpj:
                            if debug:
                                logger.debug(f"CNPJ extraído do OID ICP-Brasil (2.16.76.1.3.3): {cnpj}")
                            break
            except Exception as e:
                if debug:
                    logger.debug(f"Erro ao verificar OID ICP-Brasil: {e}")
        
        # Prioridade 4: Verifica todos os outros atributos do subject
        if not cnpj:
            for attr in subject:
                if attr.oid in [x509.NameOID.COMMON_NAME, x509.NameOID.ORGANIZATIONAL_UNIT_NAME]:
                    continue
                valor_attr = attr.value
                cnpj_extraido = extrair_cnpj_do_texto(valor_attr)
                if cnpj_extraido:
                    cnpj = cnpj_extraido
                    if debug:
                        logger.debug(f"CNPJ extraído do atributo {attr.oid._name}: {cnpj}")
                    break
        
        # Prioridade 5: Verifica o Issuer também
        if not cnpj:
            issuer = cert.issuer
            if debug:
                logger.debug("Verificando atributos do Issuer:")
            for attr in issuer:
                if debug:
                    logger.debug(f"  Issuer OID: {attr.oid}, Valor: {attr.value}")
                if attr.oid == x509.NameOID.ORGANIZATIONAL_UNIT_NAME:
                    cnpj_extraido = extrair_cnpj_do_texto(attr.value)
                    if cnpj_extraido:
                        cnpj = cnpj_extraido
                        if debug:
                            logger.debug(f"CNPJ extraído do Issuer OU: {cnpj}")
                        break
        
        # Prioridade 6: Tenta extrair CNPJ do Serial Number
        if not cnpj:
            serial_number = cert.serial_number
            if debug:
                logger.debug(f"Serial Number: {serial_number}")
            cnpj = extrair_cnpj_do_texto(str(serial_number))
            if cnpj and debug:
                logger.debug(f"CNPJ extraído do Serial Number: {cnpj}")
        
        # Prioridade 7: Tenta extrair CNPJ do Subject Alternative Name (SAN)
        if not cnpj:
            try:
                san_ext = cert.extensions.get_extension_for_oid(x509.ExtensionOID.SUBJECT_ALTERNATIVE_NAME)
                if san_ext:
                    san = san_ext.value
                    if debug:
                        logger.debug("Subject Alternative Name encontrado")
                    for name in san:
                        if isinstance(name, x509.DirectoryName):
                            for attr in name.value:
                                cnpj_extraido = extrair_cnpj_do_texto(attr.value)
                                if cnpj_extraido:
                                    cnpj = cnpj_extraido
                                    if debug:
                                        logger.debug(f"CNPJ extraído do SAN: {cnpj}")
                                    break
                        if cnpj:
                            break
            except x509.ExtensionNotFound:
                if debug:
                    logger.debug("Subject Alternative Name não encontrado")
            except Exception as e:
                if debug:
                    logger.debug(f"Erro ao processar SAN: {e}")
        
        # Extrai data de vencimento
        data_vencimento = cert.not_valid_after
        
        # Formata CNPJ se encontrado
        cnpj_formatado = None
        if cnpj:
            cnpj_formatado = f"{cnpj[:2]}.{cnpj[2:5]}.{cnpj[5:8]}/{cnpj[8:12]}-{cnpj[12:14]}"
            if debug:
                logger.debug(f"CNPJ final formatado: {cnpj_formatado}")
        else:
            if debug:
                logger.warning("CNPJ não encontrado em nenhum campo!")
        
        resultado = {
            "empresa": nome_empresa or "Nome não encontrado",
            "cnpj": cnpj_formatado or cnpj,
            "cnpj_limpo": cnpj,
            "dataVencimento": data_vencimento.isoformat() if data_vencimento else None
        }
        
        if debug:
            logger.debug(f"Resultado final: {resultado}")
            logger.debug("=" * 60)
        
        return resultado
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao extrair informações do certificado: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=400,
            detail=f"Erro ao extrair informações do certificado: {str(e)}"
        )

