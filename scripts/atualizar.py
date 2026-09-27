"""Atualiza dashboard e relatório a partir da pasta de planilhas do mês.

Uso: python3 scripts/atualizar.py <pasta_do_mes>
Saídas em saidas/<AAAA-MM>/: dados.json, dashboard_executivo.html, relatorio_executivo.html, relatorio_executivo.pdf
"""
import json
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "scripts"))
from extrair_dados import main as extrair  # noqa: E402


def mes_anterior(mes):
    """dados.json do último mês gerado antes de `mes`, ou None."""
    meses = sorted(d.name for d in (RAIZ / "saidas").iterdir()
                   if d.is_dir() and d.name < mes and (d / "dados.json").exists())
    return (RAIZ / "saidas" / meses[-1] / "dados.json") if meses else None


def montar(modelo, dados_json, analise_js, destino, anterior_json="null"):
    html = (RAIZ / "modelos" / modelo).read_text(encoding="utf-8")
    for marcador in ("/*__DADOS__*/null", "/*__ANALISE__*/"):
        if marcador not in html:
            sys.exit(f"Marcador {marcador} não encontrado em {modelo}")
    # </script> dentro do JSON fecharia a tag: escapa a barra
    html = html.replace("/*__DADOS__*/null", dados_json.replace("</", "<\\/"))
    html = html.replace("/*__ANALISE__*/", analise_js)
    html = html.replace("/*__ANTERIOR__*/null", anterior_json.replace("</", "<\\/"))
    destino.write_text(html, encoding="utf-8")
    print(f"OK: {destino.relative_to(RAIZ)}")


def main(pasta):
    tmp = RAIZ / "saidas" / "_tmp_dados.json"
    extrair(pasta, tmp)
    dados = json.loads(tmp.read_text(encoding="utf-8"))
    mes = dados["periodo"]["fim"][:7]
    out = RAIZ / "saidas" / mes
    out.mkdir(parents=True, exist_ok=True)
    tmp.replace(out / "dados.json")

    dados_json = json.dumps(dados, ensure_ascii=False)
    analise_js = (RAIZ / "modelos" / "analise.js").read_text(encoding="utf-8")
    ant = mes_anterior(mes)
    ant_json = json.dumps(json.loads(ant.read_text(encoding="utf-8")), ensure_ascii=False) if ant else "null"
    print(f"Comparação: {ant.parent.name if ant else 'sem mês anterior (selos mostram contexto)'}")
    montar("dashboard.html", dados_json, analise_js, out / "dashboard_executivo.html", ant_json)
    montar("relatorio.html", dados_json, analise_js, out / "relatorio_executivo.html")
    subprocess.run(["node", str(RAIZ / "scripts" / "gerar_pdf.mjs"),
                    str(out / "relatorio_executivo.html"), str(out / "relatorio_executivo.pdf")], check=True)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
