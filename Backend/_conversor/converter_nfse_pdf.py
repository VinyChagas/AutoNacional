# -*- coding: utf-8 -*-
"""
Converte NFS-e (padrao nacional - http://www.sped.fazenda.gov.br/nfse) em PDF,
reproduzindo o DANFSe oficial (v1.0) do portal nacional da NFS-e.

O PDF e gerado na MESMA pasta do XML correspondente, com o mesmo nome.

Uso:
    python converter_nfse_pdf.py [pasta_raiz]

Assets necessarios (na mesma pasta deste script):
    danfse_logo_nfse.png        - logotipo NFS-e (universal)
    danfse_brasao_curitiba.png  - brasao usado quando o municipio e Curitiba
    danfse_brasao_sp.png        - brasao usado quando o municipio e Sao Paulo
    danfse_ibge_municipios.json - tabela codigo IBGE -> nome do municipio
"""

import io
import json
import os
import sys
import unicodedata
import xml.etree.ElementTree as ET

import qrcode
from reportlab.lib.colors import Color, black
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

NS = "{http://www.sped.fazenda.gov.br/nfse}"
PAGE_W, PAGE_H = A4  # 595 x 842

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOGO_PATH = os.path.join(SCRIPT_DIR, "danfse_logo_nfse.png")
IBGE_PATH = os.path.join(SCRIPT_DIR, "danfse_ibge_municipios.json")

GRAY = Color(0.33, 0.33, 0.33)
LINE_COL = Color(0.0, 0.0, 0.0)

FONT = "Helvetica"
FONT_B = "Helvetica-Bold"

UF_COD = {
    "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP",
    "17": "TO", "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB",
    "26": "PE", "27": "AL", "28": "SE", "29": "BA", "31": "MG", "32": "ES",
    "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS", "50": "MS",
    "51": "MT", "52": "GO", "53": "DF",
}

OP_SIMPLES = {
    "1": "Não Optante",
    "2": "Optante - Microempreendedor Individual (MEI)",
    "3": "Optante - ME/EPP",
}
REG_APUR_SN = {
    "1": "Regime de apuração dos tributos federais e municipal pelo SN",
    "2": "Regime de apuração dos tributos federais pelo SN e do ISSQN fora do SN",
    "3": "Regime de apuração dos tributos federais e municipal fora do SN",
}
TRIB_ISSQN = {
    "1": "Operação Tributável",
    "2": "Imunidade",
    "3": "Exportação de Serviço",
    "4": "Não Incidência",
}
RET_ISSQN = {
    "1": "Não Retido",
    "2": "Retido pelo Tomador",
    "3": "Retido pelo Intermediário",
}
REG_ESP_TRIB = {
    "0": "Nenhum",
    "1": "Ato Cooperado",
    "2": "Estimativa",
    "3": "Microempresa Municipal",
    "4": "Notário ou Registrador",
    "5": "Profissional Autônomo",
    "6": "Sociedade de Profissionais",
}

# Cabecalho da prefeitura por municipio de emissao.
# lines: (texto, baseline_top-origin, tamanho)
MUNI_HEADER = {
    "curitiba": {
        "brasao": "danfse_brasao_curitiba.png",
        "lines": [
            ("PREFEITURA MUNICIPAL DE", 17.6, 8),
            ("CURITIBA", 26.6, 8),
            ("Secretaria Municipal de Finanças", 33.4, 6),
            ("nif@curitiba.pr.gov.br", 40.2, 6),
        ],
    },
    "sao paulo": {
        "brasao": "danfse_brasao_sp.png",
        "lines": [
            ("Prefeitura da Cidade de São Paulo", 17.6, 8),
            ("Secretaria Municipal da Fazenda", 24.3, 6),
            ("(11)156", 31.1, 6),
        ],
    },
}

with open(IBGE_PATH, encoding="utf-8") as _fh:
    IBGE = json.load(_fh)


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.strip().lower()


# --------------------------------------------------------------------------
# Helpers de leitura do XML
# --------------------------------------------------------------------------

def child(el, *tags):
    cur = el
    for t in tags:
        if cur is None:
            return None
        cur = cur.find(NS + t)
    return cur


def gtext(el, *tags):
    c = child(el, *tags)
    if c is not None and c.text:
        return c.text.strip()
    return ""


def gi(el, tag):
    if el is None:
        return ""
    found = el.find(".//" + NS + tag)
    if found is not None and found.text:
        return found.text.strip()
    return ""


# --------------------------------------------------------------------------
# Formatadores
# --------------------------------------------------------------------------

def only_digits(s):
    return "".join(ch for ch in (s or "") if ch.isdigit())


def fmt_doc(doc):
    d = only_digits(doc)
    if len(d) == 14:
        return f"{d[0:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:14]}"
    if len(d) == 11:
        return f"{d[0:3]}.{d[3:6]}.{d[6:9]}-{d[9:11]}"
    return doc or "-"


def fmt_cep(cep):
    d = only_digits(cep)
    if len(d) == 8:
        return f"{d[0:5]}-{d[5:8]}"
    return cep or "-"


def fmt_fone(fone):
    d = only_digits(fone)
    if len(d) == 11:
        return f"({d[0:2]}) {d[2:7]}-{d[7:11]}"
    if len(d) == 10:
        return f"({d[0:2]}) {d[2:6]}-{d[6:10]}"
    if len(d) == 8:
        return f"{d[0:4]}-{d[4:8]}"
    return fone or "-"


def fmt_num(v):
    try:
        n = float(v)
    except (ValueError, TypeError):
        return None
    s = f"{n:,.2f}"
    return s.replace(",", "X").replace(".", ",").replace("X", ".")


def money(v, always=False):
    n = fmt_num(v)
    if n is None:
        return "-"
    if not always and abs(float(v)) < 0.0000001:
        return "-"
    return "R$ " + n


def pct(v):
    n = fmt_num(v)
    return f"{n}%" if n is not None else "-"


def fmt_dt(s):
    if not s:
        return "-"
    try:
        ano, mes, dia = s[:10].split("-")
        out = f"{dia}/{mes}/{ano}"
        if "T" in s:
            out += " " + s.split("T", 1)[1][:8]
        return out
    except Exception:
        return s


def fmt_data(s):
    if not s:
        return "-"
    try:
        ano, mes, dia = s[:10].split("-")
        return f"{dia}/{mes}/{ano}"
    except Exception:
        return s


def fmt_ctrib(cod):
    d = only_digits(cod)
    if len(d) == 6:
        return f"{d[0:2]}.{d[2:4]}.{d[4:6]}"
    return cod


def cidade_uf(nome, cod):
    cod = only_digits(cod)
    if not nome and cod:
        nome = IBGE.get(cod, "")
    uf = UF_COD.get(cod[:2], "") if cod else ""
    if nome and uf:
        return f"{nome} - {uf}"
    return nome or "-"


def montar_endereco(xlgr, nro, xcpl, xbairro):
    partes = [p for p in [xlgr, nro, xcpl, xbairro] if p]
    return ", ".join(partes) if partes else "-"


# --------------------------------------------------------------------------
# Extracao dos dados da NFS-e
# --------------------------------------------------------------------------

def parse_nfse(path):
    root = ET.parse(path).getroot()
    inf = root.find(NS + "infNFSe")
    if inf is None:
        return None

    emit = inf.find(NS + "emit")
    ender = child(emit, "enderNac")
    dps = child(inf, "DPS", "infDPS")
    prest = child(dps, "prest")
    regtrib = child(prest, "regTrib")
    toma = child(dps, "toma")
    serv = child(dps, "serv")
    cserv = child(serv, "cServ")
    vals = child(dps, "valores")
    trib = child(vals, "trib")
    tottrib = child(trib, "totTrib")

    d = {}
    d["chave"] = (inf.get("Id") or "").replace("NFS", "")

    d["xLocEmi"] = gtext(inf, "xLocEmi")
    d["nNFSe"] = gtext(inf, "nNFSe") or "-"
    d["compet"] = fmt_data(gtext(dps, "dCompet"))
    d["dhProc"] = fmt_dt(gtext(inf, "dhProc"))
    d["nDPS"] = gtext(dps, "nDPS") or "-"
    d["serie"] = gtext(dps, "serie") or "-"
    d["dhEmi"] = fmt_dt(gtext(dps, "dhEmi"))

    emit_uf = gtext(ender, "UF")
    d["emit_doc"] = fmt_doc(gtext(emit, "CNPJ") or gtext(emit, "CPF") or gi(emit, "NIF"))
    d["emit_im"] = gi(emit, "IM") or "-"
    d["emit_fone"] = fmt_fone(gtext(emit, "fone"))
    d["emit_nome"] = gtext(emit, "xNome") or "-"
    d["emit_email"] = gtext(emit, "email") or "-"
    d["emit_end"] = montar_endereco(
        gtext(ender, "xLgr"), gtext(ender, "nro"),
        gtext(ender, "xCpl"), gtext(ender, "xBairro"))
    nome_emit = d["xLocEmi"]
    d["emit_mun"] = f"{nome_emit} - {emit_uf}" if nome_emit and emit_uf else (nome_emit or "-")
    d["emit_cep"] = fmt_cep(gtext(ender, "CEP"))

    op = gtext(regtrib, "opSimpNac")
    d["emit_simples"] = OP_SIMPLES.get(op, "-")
    reg = gtext(regtrib, "regApTribSN")
    d["emit_regapur"] = REG_APUR_SN.get(reg, "-")

    if toma is not None:
        end = child(toma, "end")
        endnac = child(end, "endNac")
        d["toma_doc"] = fmt_doc(gtext(toma, "CNPJ") or gtext(toma, "CPF") or gi(toma, "NIF"))
        d["toma_im"] = gi(toma, "IM") or "-"
        d["toma_fone"] = fmt_fone(gtext(toma, "fone"))
        d["toma_nome"] = gtext(toma, "xNome") or "-"
        d["toma_email"] = gtext(toma, "email") or "-"
        d["toma_end"] = montar_endereco(
            gtext(end, "xLgr"), gtext(end, "nro"),
            gtext(end, "xCpl"), gtext(end, "xBairro"))
        d["toma_mun"] = cidade_uf(gtext(endnac, "xMun") or gi(end, "xMun"),
                                  gtext(endnac, "cMun"))
        d["toma_cep"] = fmt_cep(gtext(endnac, "CEP") or gi(end, "CEP"))
    else:
        for k in ("toma_doc", "toma_im", "toma_fone", "toma_nome",
                  "toma_email", "toma_end", "toma_mun", "toma_cep"):
            d[k] = "-"

    cod_nac = fmt_ctrib(gtext(cserv, "cTribNac"))
    desc_nac = gtext(inf, "xTribNac") or gi(cserv, "xTribNac")
    d["cod_trib_nac"] = f"{cod_nac} - {desc_nac}".strip(" -") if cod_nac else (desc_nac or "-")
    ctm = gtext(cserv, "cTribMun")
    xtm = gtext(cserv, "xTribMun")
    d["cod_trib_mun"] = (f"{ctm} - {xtm}".strip(" -") if ctm else (xtm or "-")) or "-"
    d["local_prest"] = cidade_uf(gtext(inf, "xLocPrestacao"), gi(serv, "cLocPrestacao"))
    d["pais_prest"] = gi(serv, "xPaisPrest") or "-"
    d["desc_serv"] = gtext(cserv, "xDescServ") or "-"

    d["trib_issqn"] = TRIB_ISSQN.get(gi(trib, "tribISSQN"), "-")
    d["pais_result"] = "-"
    d["mun_incid"] = cidade_uf(gtext(inf, "xLocIncid"), gtext(inf, "cLocIncid"))
    d["reg_esp"] = REG_ESP_TRIB.get(gtext(regtrib, "regEspTrib"), "-")
    d["tipo_imun"] = "-"
    d["susp_exig"] = "Não"
    d["num_proc_susp"] = "-"
    d["vserv_m"] = money(gi(vals, "vServ"), always=True)
    d["desc_incond_m"] = money(gi(vals, "vDescIncond"))
    d["ded_red"] = money(gi(trib, "vDedRed") or gi(trib, "vDR"))
    d["calc_bm"] = money(gi(trib, "vCalcBM"))
    d["bc_issqn"] = money(gi(trib, "vBC"))
    d["aliq_aplic"] = pct(gi(trib, "pAliqAplic"))
    ret = gi(trib, "tpRetISSQN")
    d["ret_issqn"] = RET_ISSQN.get(ret, "-")
    d["issqn_apur"] = money(gi(trib, "vISSQN"))

    d["irrf"] = money(gi(trib, "vRetIRRF"))
    d["contrib_prev"] = money(gi(trib, "vRetCP"))
    d["contrib_soc"] = money(gi(trib, "vRetCSLL"))
    d["desc_contrib_soc"] = "-"
    d["pis"] = money(gi(trib, "vPis"))
    d["cofins"] = money(gi(trib, "vCofins"))

    d["vt_vserv"] = money(gi(vals, "vServ"), always=True)
    d["vt_desc_cond"] = money(gi(vals, "vDescCond"))
    d["vt_desc_incond"] = money(gi(vals, "vDescIncond"))
    d["vt_issqn_ret"] = money(gi(trib, "vISSQN")) if ret in ("2", "3") else "-"
    d["vt_tot_ret_fed"] = money(gi(trib, "vTotalRet"))
    try:
        pc = float(gi(trib, "vPis") or 0) + float(gi(trib, "vCofins") or 0)
        d["vt_piscofins"] = money(pc) if pc else "-"
    except ValueError:
        d["vt_piscofins"] = "-"
    d["vt_vliq"] = money(gi(inf, "vLiq"), always=True)

    d["tot_fed"] = money(gi(tottrib, "vTotTribFed"))
    d["tot_est"] = money(gi(tottrib, "vTotTribEst"))
    d["tot_mun"] = money(gi(tottrib, "vTotTribMun"))

    partes = []
    nbs = gi(cserv, "cNBS")
    if nbs:
        partes.append(f"NBS: {nbs}")
    xinf = gi(serv, "xInfComp")
    if xinf:
        partes.append(xinf)
    d["info_comp"] = "\n".join(partes) if partes else "-"

    return d


# --------------------------------------------------------------------------
# Layout (coordenadas top-origin, extraidas do DANFSe oficial)
# --------------------------------------------------------------------------

LABELS = [
    ("Chave de Acesso da NFS-e", 14.2, 53.6, 7),
    ("Número da NFS-e", 14.2, 74.9, 7),
    ("Competência da NFS-e", 155.9, 74.9, 7),
    ("Data e Hora da emissão da NFS-e", 297.6, 74.9, 7),
    ("Número da DPS", 14.2, 96.1, 7),
    ("Série da DPS", 155.9, 96.1, 7),
    ("Data e Hora da emissão da DPS", 297.6, 96.1, 7),
    ("Prestador do Serviço", 14.2, 141.4, 7),
    ("CNPJ / CPF / NIF", 155.9, 131.2, 7),
    ("Inscrição Municipal", 297.6, 131.2, 7),
    ("Telefone", 439.4, 131.2, 7),
    ("Nome / Nome Empresarial", 14.2, 153.6, 7),
    ("E-mail", 297.6, 153.6, 7),
    ("Endereço", 14.2, 174.8, 7),
    ("Município", 297.6, 174.8, 7),
    ("CEP", 439.4, 174.8, 7),
    ("Simples Nacional na Data de Competência", 14.2, 196.0, 7),
    ("Regime de Apuração Tributária pelo SN", 297.6, 196.0, 7),
    ("CNPJ / CPF / NIF", 155.9, 217.7, 7),
    ("Inscrição Municipal", 297.6, 217.7, 7),
    ("Telefone", 439.4, 217.7, 7),
    ("Nome / Nome Empresarial", 14.2, 239.0, 7),
    ("E-mail", 297.6, 239.0, 7),
    ("Endereço", 14.2, 260.2, 7),
    ("Município", 297.6, 260.2, 7),
    ("CEP", 439.4, 260.2, 7),
    ("Código de Tributação Nacional", 14.2, 307.2, 7),
    ("Código de Tributação Municipal", 155.9, 307.2, 7),
    ("Local da Prestação", 297.6, 307.2, 7),
    ("País da Prestação", 439.4, 307.2, 7),
    ("Descrição do Serviço", 14.2, 337.5, 7),
    ("Tributação do ISSQN", 14.2, 390.7, 7),
    ("País Resultado da Prestação do Serviço", 155.9, 390.7, 7),
    ("Município de Incidência do ISSQN", 297.6, 390.7, 7),
    ("Regime Especial de Tributação", 439.4, 390.7, 7),
    ("Tipo de Imunidade", 14.2, 411.9, 7),
    ("Suspensão da Exigibilidade do ISSQN", 155.9, 411.9, 7),
    ("Número Processo Suspensão", 297.6, 411.9, 7),
    ("Benefício Municipal", 439.4, 411.9, 7),
    ("Valor do Serviço", 14.2, 433.1, 7),
    ("Desconto Incondicionado", 155.9, 433.1, 7),
    ("Total Deduções/Reduções", 297.6, 433.1, 7),
    ("Cálculo do BM", 439.4, 433.1, 7),
    ("BC ISSQN", 14.2, 454.4, 7),
    ("Alíquota Aplicada", 155.9, 454.4, 7),
    ("Retenção do ISSQN", 297.6, 454.4, 7),
    ("ISSQN Apurado", 439.4, 454.4, 7),
    ("IRRF", 14.2, 489.4, 7),
    ("Contribuição Previdenciária - Retida", 155.9, 489.4, 7),
    ("Contribuições Sociais - Retidas", 297.6, 489.4, 7),
    ("Descrição Contrib. Sociais - Retidas", 439.4, 489.4, 7),
    ("PIS - Débito Apuração Própria", 14.2, 510.6, 7),
    ("COFINS - Débito Apuração Própria", 155.9, 510.6, 7),
    ("Valor do Serviço", 14.2, 545.7, 7),
    ("Desconto Condicionado", 155.9, 545.7, 7),
    ("Desconto Incondicionado", 297.6, 545.7, 7),
    ("ISSQN Retido", 439.4, 545.7, 7),
    ("Total das Retenções Federais", 14.2, 566.9, 7),
    ("PIS/COFINS - Débito Apur. Própria", 155.9, 566.9, 7),
    ("Valor Líquido da NFS-e", 439.4, 566.9, 7),
]

SECTIONS = [
    ("EMITENTE DA NFS-e", 14.2, 131.5, 9),
    ("TOMADOR DO SERVIÇO", 14.2, 218.0, 9),
    ("SERVIÇO PRESTADO", 14.2, 292.6, 9),
    ("TRIBUTAÇÃO MUNICIPAL", 14.2, 378.5, 9),
    ("TRIBUTAÇÃO FEDERAL", 14.2, 477.2, 9),
    ("VALOR TOTAL DA NFS-E", 14.2, 533.5, 9),
    ("TOTAIS APROXIMADOS DOS TRIBUTOS", 14.2, 589.8, 9),
    ("INFORMAÇÕES COMPLEMENTARES", 14.2, 624.8, 9),
]

VALUES = [
    ("chave", 14.2, 62.7, 8, 420),
    ("nNFSe", 14.2, 83.9, 8, 138),
    ("compet", 155.9, 83.9, 8, 138),
    ("dhProc", 297.6, 83.9, 8, 138),
    ("nDPS", 14.2, 105.1, 8, 138),
    ("serie", 155.9, 105.1, 8, 138),
    ("dhEmi", 297.6, 105.1, 8, 138),
    ("emit_doc", 155.9, 140.3, 8, 138),
    ("emit_im", 297.6, 140.3, 8, 138),
    ("emit_fone", 439.4, 140.3, 8, 138),
    ("emit_nome", 14.2, 162.6, 8, 279),
    ("emit_email", 297.6, 162.6, 8, 279),
    ("emit_end", 14.2, 183.8, 8, 279),
    ("emit_mun", 297.6, 183.8, 8, 138),
    ("emit_cep", 439.4, 183.8, 8, 138),
    ("emit_simples", 14.2, 205.1, 8, 279),
    ("emit_regapur", 297.6, 205.1, 8, 279),
    ("toma_doc", 155.9, 226.8, 8, 138),
    ("toma_im", 297.6, 226.8, 8, 138),
    ("toma_fone", 439.4, 226.8, 8, 138),
    ("toma_nome", 14.2, 248.0, 8, 279),
    ("toma_email", 297.6, 248.0, 8, 279),
    ("toma_end", 14.2, 269.3, 8, 279),
    ("toma_mun", 297.6, 269.3, 8, 138),
    ("toma_cep", 439.4, 269.3, 8, 138),
    ("cod_trib_mun", 155.9, 316.3, 8, 138),
    ("local_prest", 297.6, 316.3, 8, 138),
    ("pais_prest", 439.4, 316.3, 8, 138),
    ("trib_issqn", 14.2, 399.7, 8, 138),
    ("pais_result", 155.9, 399.7, 8, 138),
    ("mun_incid", 297.6, 399.7, 8, 138),
    ("reg_esp", 439.4, 399.7, 8, 138),
    ("tipo_imun", 14.2, 421.0, 8, 138),
    ("susp_exig", 155.9, 421.0, 8, 138),
    ("num_proc_susp", 297.6, 421.0, 8, 138),
    ("benef_mun", 439.4, 421.0, 8, 138),
    ("vserv_m", 14.2, 442.2, 8, 138),
    ("desc_incond_m", 155.9, 442.2, 8, 138),
    ("ded_red", 297.6, 442.2, 8, 138),
    ("calc_bm", 439.4, 442.2, 8, 138),
    ("bc_issqn", 14.2, 463.4, 8, 138),
    ("aliq_aplic", 155.9, 463.4, 8, 138),
    ("ret_issqn", 297.6, 463.4, 8, 138),
    ("issqn_apur", 439.4, 463.4, 8, 138),
    ("irrf", 14.2, 498.4, 8, 138),
    ("contrib_prev", 155.9, 498.4, 8, 138),
    ("contrib_soc", 297.6, 498.4, 8, 138),
    ("desc_contrib_soc", 439.4, 498.4, 8, 138),
    ("pis", 14.2, 519.7, 8, 138),
    ("cofins", 155.9, 519.7, 8, 138),
    ("vt_vserv", 14.2, 554.7, 8, 138),
    ("vt_desc_cond", 155.9, 554.7, 8, 138),
    ("vt_desc_incond", 297.6, 554.7, 8, 138),
    ("vt_issqn_ret", 439.4, 554.7, 8, 138),
    ("vt_tot_ret_fed", 14.2, 575.9, 8, 138),
    ("vt_piscofins", 155.9, 575.9, 8, 138),
    ("vt_vliq", 439.4, 575.9, 8, 138),
]

CENTER_LABELS = [
    ("Federais", 105.2, 601.9, 7),
    ("Estaduais", 294.5, 601.9, 7),
    ("Municipais", 483.2, 601.9, 7),
]
CENTER_VALUES = [
    ("tot_fed", 105.2, 611.0, 8),
    ("tot_est", 294.5, 611.0, 8),
    ("tot_mun", 483.2, 611.0, 8),
]

HLINES = [41.2, 123.0, 209.6, 273.8, 283.3, 369.2, 467.9, 524.2, 580.4, 615.5]

DESC = 1.6


def ry(bottom, size=0):
    return PAGE_H - bottom + (0.21 * size if size else DESC)


def fit(text, font, size, max_w, min_size=6.0):
    if not text:
        return text, size
    s = size
    while s > min_size and stringWidth(text, font, s) > max_w:
        s -= 0.5
    if stringWidth(text, font, s) > max_w:
        t = text
        while t and stringWidth(t + "...", font, s) > max_w:
            t = t[:-1]
        text = t + "..."
    return text, s


def wrap(text, font, size, max_w):
    out = []
    for raw in text.split("\n"):
        if raw == "":
            out.append("")
            continue
        cur = ""
        for w in raw.split():
            test = (cur + " " + w).strip()
            if stringWidth(test, font, size) <= max_w:
                cur = test
            else:
                if cur:
                    out.append(cur)
                cur = w
        out.append(cur)
    return out or [""]


# --------------------------------------------------------------------------
# Geracao do PDF
# --------------------------------------------------------------------------

def qr_image(chave):
    url = f"https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave={chave}"
    qr = qrcode.QRCode(border=0, error_correction=qrcode.constants.ERROR_CORRECT_M)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return ImageReader(buf)


def draw_header(c, d):
    # Logo NFS-e (universal)
    try:
        c.drawImage(ImageReader(LOGO_PATH), 14.2, PAGE_H - 35.2, width=113.4,
                    height=22.7, mask="auto", preserveAspectRatio=True)
    except Exception:
        pass

    c.setFillColor(black)
    c.setFont(FONT_B, 9)
    c.drawCentredString(251.6, ry(24.7, 9), "DANFSe v1.0")
    c.drawCentredString(251.6, ry(34.9, 9), "Documento Auxiliar da NFS-e")

    cidade = d.get("xLocEmi") or ""
    cfg = MUNI_HEADER.get(norm(cidade))

    if cfg:
        brasao = os.path.join(SCRIPT_DIR, cfg["brasao"])
        if os.path.exists(brasao):
            try:
                c.drawImage(ImageReader(brasao), 402.6, PAGE_H - 38.8, width=30,
                            height=30, mask="auto", preserveAspectRatio=True)
            except Exception:
                pass
        for text, b, size in cfg["lines"]:
            c.setFont(FONT, size)
            c.drawString(439.4, ry(b, size), text)
    else:
        c.setFont(FONT, 8)
        c.drawString(439.4, ry(17.6, 8), "PREFEITURA MUNICIPAL DE")
        c.drawString(439.4, ry(26.6, 8), cidade.upper() or "-")
        c.setFont(FONT, 6)
        c.drawString(439.4, ry(33.4, 6), "Secretaria Municipal de Finanças")


def build_pdf(d, out_path):
    c = canvas.Canvas(out_path, pagesize=A4)

    c.setLineWidth(0.8)
    c.setStrokeColor(LINE_COL)
    c.rect(5, 5, 585, 832, stroke=1, fill=0)

    c.setLineWidth(0.5)
    for y in HLINES:
        yy = PAGE_H - y
        c.line(10.8, yy, 577.7, yy)

    draw_header(c, d)

    # QR + legenda
    try:
        c.drawImage(qr_image(d["chave"]), 481.8, PAGE_H - 96.0, width=50, height=50)
    except Exception:
        pass
    c.setFillColor(GRAY)
    c.setFont(FONT, 6)
    c.drawString(439.4, ry(104.9, 6), "A autenticidade desta NFS-e pode ser verificada")
    c.drawString(439.4, ry(111.7, 6), "pela leitura deste código QR ou pela consulta da")
    c.drawString(439.4, ry(118.5, 6), "chave de acesso no portal nacional da NFS-e")

    # Titulos de secao
    c.setFillColor(black)
    for text, x, b, size in SECTIONS:
        c.setFont(FONT_B, size)
        c.drawString(x, ry(b, size), text)
    c.setFont(FONT_B, 9)
    c.drawCentredString(294.0, ry(283.1, 9),
                        "INTERMEDIÁRIO DO SERVIÇO NÃO IDENTIFICADO NA NFS-e")

    # Labels
    c.setFillColor(GRAY)
    for text, x, b, size in LABELS:
        c.setFont(FONT, size)
        c.drawString(x, ry(b, size), text)
    for text, x, b, size in CENTER_LABELS:
        c.setFont(FONT, size)
        c.drawCentredString(x, ry(b, size), text)

    # Valores
    c.setFillColor(black)
    for key, x, b, size, maxw in VALUES:
        val = d.get(key, "-") or "-"
        val, s = fit(val, FONT, size, maxw)
        c.setFont(FONT, s)
        c.drawString(x, ry(b, size), val)
    for key, x, b, size in CENTER_VALUES:
        val = d.get(key, "-") or "-"
        c.setFont(FONT, size)
        c.drawCentredString(x, ry(b, size), val)

    # Codigo de Tributacao Nacional (ate 2 linhas)
    linhas = wrap(d.get("cod_trib_nac", "-"), FONT, 8, 138)
    c.setFont(FONT, 8)
    if len(linhas) > 2:
        l2, _ = fit(linhas[1] + "...", FONT, 8, 138)
        linhas = [linhas[0], l2]
    for i, ln in enumerate(linhas[:2]):
        c.drawString(14.2, ry(307.2 + 9.1 + i * 9.1, 8), ln)

    # Descricao do Servico
    desc = wrap(d.get("desc_serv", "-"), FONT, 8, 560)
    if len(desc) > 3:
        desc = desc[:3]
        desc[-1], _ = fit(desc[-1] + "...", FONT, 8, 560)
    c.setFont(FONT, 8)
    for i, ln in enumerate(desc):
        c.drawString(14.2, ry(337.5 + 9.1 + i * 9.1, 8), ln)

    # Informacoes complementares
    info = wrap(d.get("info_comp", "-"), FONT, 8, 560)
    c.setFont(FONT, 8)
    for i, ln in enumerate(info[:20]):
        c.drawString(14.2, ry(624.8 + 13.2 + i * 9.5, 8), ln)

    c.showPage()
    c.save()


def main():
    raiz = sys.argv[1] if len(sys.argv) > 1 else SCRIPT_DIR
    total = ok = falha = 0
    erros = []

    for dirpath, _, files in os.walk(raiz):
        for name in files:
            if not name.lower().endswith(".xml"):
                continue
            total += 1
            xml_path = os.path.join(dirpath, name)
            pdf_path = os.path.splitext(xml_path)[0] + ".pdf"
            try:
                d = parse_nfse(xml_path)
                if d is None:
                    falha += 1
                    erros.append((xml_path, "sem infNFSe"))
                    continue
                build_pdf(d, pdf_path)
                ok += 1
            except Exception as e:
                falha += 1
                erros.append((xml_path, repr(e)))
            if total % 200 == 0:
                print(f"  processados: {total} (ok={ok}, falha={falha})", flush=True)

    print("-" * 50)
    print(f"Total XML encontrados : {total}")
    print(f"PDF gerados           : {ok}")
    print(f"Falhas                : {falha}")
    for p, msg in erros[:20]:
        print(f"  - {p}: {msg}")


if __name__ == "__main__":
    main()
