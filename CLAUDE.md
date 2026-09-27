# Dashboard de Obras · Clínica Sensi

Painel executivo e relatório de decisão da obra da Clínica Sensi (Sala 504, Rio Mar Trade Center, Fortaleza/CE), gerados a partir das planilhas mensais de controle da obra. Público: diretoria. Idioma: português do Brasil, linguagem de negócio, sem jargão técnico.

## Quando o usuário pedir "atualiza o dashboard do mês"

1. **Localize as planilhas novas.** Normalmente chegam num zip `Clinica_Sensi_<Mes><Ano>.zip` (ex.: `Clinica_Sensi_Out2026.zip`). Descompacte na raiz, gerando a pasta `Clinica_Sensi_<Mes><Ano>/` com os 3 arquivos da seção "Arquivos de entrada". Se faltar algum arquivo, pare e peça ao usuário.
2. **Rode o pipeline:**
   ```bash
   python3 scripts/atualizar.py Clinica_Sensi_<Mes><Ano>
   ```
   Ele cria `saidas/<AAAA-MM>/` com `dados.json`, `dashboard_executivo.html`, `relatorio_executivo.html` e `relatorio_executivo.pdf`. O mês de saída vem da data do último pagamento.
3. **Leia os avisos do script.** `AVISO: realizado de X difere da planilha` indica que o valor da planilha não bate com a soma dos lançamentos. O script usa o recalculado; informe o usuário.
4. **Confira visualmente**: faça screenshot do dashboard em 1440px e em 390px, e renderize as páginas do PDF (ex.: com `pymupdf`). Verifique se há texto cortado, gráfico vazio ou página quase em branco.
5. **Revise os textos gerados** (frases de leitura, "Onde agir agora", achados, limites). Eles saem de regras em `modelos/analise.js`. Se o mês trouxer uma situação que as regras não cobrem (ex.: grupo acima do orçado, novo tipo de despesa), ajuste as regras, não o HTML gerado.
6. **Compare com o mês anterior** (`saidas/<mês anterior>/dados.json`) e conte ao usuário o que mudou: realizado, reembolsos, novos achados, achados resolvidos.
7. Commit e push das pastas novas (`Clinica_Sensi_<Mes><Ano>/` e `saidas/<AAAA-MM>/`) e de qualquer ajuste de regra.

Nunca edite à mão os arquivos em `saidas/`: eles são regenerados. Mudanças de conteúdo ou visual vão em `modelos/` ou `scripts/`.

## Estrutura

```
Clinica_Sensi_<Mes><Ano>/         planilhas originais do mês (não alterar)
scripts/extrair_dados.py          lê as planilhas e gera o JSON único
scripts/atualizar.py              pipeline completo: extrai, monta HTML e gera PDF
scripts/gerar_pdf.mjs             HTML do relatório para PDF A4 (Playwright/Chromium)
modelos/analise.js                TODA a lógica de cálculo, achados, plano e frases (compartilhada)
modelos/dashboard.html            modelo do dashboard (marcadores /*__DADOS__*/null e /*__ANALISE__*/)
modelos/relatorio.html            modelo do relatório (mesmos marcadores)
saidas/<AAAA-MM>/                 resultados gerados por mês
```

O dashboard final é um único HTML autocontido (dados e análise embutidos). Abre com duplo clique, sem servidor. Sem internet, só a fonte muda para a do sistema.

Dependências: Python 3 + `openpyxl`; Node + `playwright` (usa o Chromium do Playwright). O `gerar_pdf.mjs` tenta `import("playwright")` local e cai para o global (`npm root -g`).

## Arquivos de entrada

A leitura acha o cabeçalho pela primeira célula preenchida da linha e para na linha `TOTAL` ou na primeira linha vazia. Colunas são lidas pelo **nome do cabeçalho**, não pela posição.

| Arquivo | Aba | Cabeçalho começa em | Colunas usadas |
|---|---|---|---|
| `2_Controle_Financeiro_*.xlsx` | `Orçado x Realizado` | `Código` | Código, Nível, Descrição, Orçado (R$), Realizado (R$) |
| `2_Controle_Financeiro_*.xlsx` | `Lançamentos` | `Nº` | Nº, Data e hora, Centro de custo, Código EAP, Descrição, Favorecido, Tipo, Pagador (origem), Valor (R$), Observação |
| `1_Reembolso_*.xlsx` | `Comprovantes` | `Nº` | Nº, Categoria, Finalidade, Favorecido / Serviço, Data e hora, Forma de pagamento, Valor (R$) |
| `3_Acompanhamento_Obra_*.xlsx` | `Diário de Obra` | `Nº` | Nº, Data, Ambiente / Etapa, Equipe / Efetivo, Avanço da etapa (%), Status |

Abas de anexos (imagens dos comprovantes) e o PDF de reembolso não são lidos.

## Regras de tratamento

- **EAP**: nível 1 = macro (001 Obra, 002 Ambientação), nível 2 = grupo, nível 3 = subgrupo, nível 4 = item. Nomes vêm em MAIÚSCULAS e são exibidos só com a primeira letra maiúscula (`fmt.nome`). Em itens, "Fornecimento (e execução/montagem) de" é removido para exibição (`fmt.curto`).
- **Realizado** de cada código da EAP = soma dos `Lançamentos` cujo `Código EAP` começa com aquele código. O valor da planilha só serve para conferência (aviso se divergir mais de R$ 0,01).
- **Reembolsos não têm código da EAP.** Entram em "pago no período", na evolução e nos canais, mas **não** no realizado por grupo. Não some reembolsos ao realizado.
- `MAPA_REEMBOLSO_EAP` (em `extrair_dados.py`) liga categorias de reembolso a itens da EAP **só para detectar estouro de item** (hoje: `Taxas e ART → 001.01.01.01`). Amplie o mapa apenas com correspondências inequívocas.
- **Canal de pagamento**: lançamento → `Pagamento direto · <Tipo>`; reembolso → `Reembolso · Pix` ou `Reembolso · Apple Pay` (Apple Pay/cartão). Não chame o pagamento direto de "conta da obra": o pagador varia (ver coluna Pagador).
- **Período** = da menor à maior data entre lançamentos e reembolsos. Se os pagamentos cobrem 1 mês, a série é **diária**; com 2 ou mais meses, vira **mensal** automaticamente.
- Datas no formato dd/mm/aaaa, moeda `R$ 1.234,56` (pt-BR). KPIs em reais inteiros; tabelas e tooltips com centavos.

## Cálculos (todos em `modelos/analise.js`)

| Indicador | Fórmula |
|---|---|
| Orçamento total | soma do orçado dos códigos de nível 1 |
| Consumido do orçamento | soma do realizado dos códigos de nível 1 (só lançamentos) |
| % consumido | consumido ÷ orçamento total |
| Saldo | orçamento total − consumido |
| Pago no período | lançamentos + reembolsos |
| Fora do orçado x realizado | total de reembolsos; % = reembolsos ÷ pago no período |
| Média móvel | média dos últimos 3 períodos (dias ou meses) do total pago |
| Picos | os 2 períodos de maior pagamento e a parte deles no total |
| Onde está o saldo | os 8 itens de nível 4 com maior (orçado − realizado) |

### Achados (regras, em ordem de impacto financeiro)

| Regra | Dispara quando | Impacto em R$ | Esforço |
|---|---|---|---|
| Risco de estouro | item nível 4 com realizado ≥ 50% do orçado | saldo restante do item | 1 (baixo) |
| Oportunidade de economia | grupo com peso ≥ 20% do orçamento e 0% executado | orçado × 5% | 2 (médio) |
| Falha de controle | existe reembolso sem EAP | total de reembolsos (+ estouro de item revelado pelo mapa) | 1 |
| Possível duplicidade | mesmo favorecido e mesmo valor mais de uma vez | valor repetido | 1 |

Premissas ficam no objeto `PREMISSAS` no topo de `analise.js` (economia de negociação 5%, peso de grupo 20%, consumo de item 50%, 8 itens no top). Mudou premissa? Altere só ali e cite no relatório.

- **Plano de ação** = achados ordenados por impacto ÷ esforço. Prazo = data do último pagamento + dias da regra (risco 5, economia 20, controle 4, duplicidade 4).
- **"Onde agir agora"** no dashboard = os 3 primeiros do plano.
- **Cenário** = orçamento − economia estimada + estouros já ocorridos. Duplicidade só entra se confirmada. Saldo protegido não conta como economia.

## Padrão visual do dashboard

- **Tema escuro.** Fundo em degradê azul-noite → quase preto (`#0b1a3a → #070c1c → #030409`) com dois brilhos radiais (ciano no canto superior esquerdo, violeta no direito).
- **Cartões de vidro**: fundo `rgba(255,255,255,.045–.075)`, `backdrop-filter: blur(18px)`, borda de 1px `rgba(148,197,255,.16)` que clareia no hover, raio de 18px.
- **Paleta.** As marcas de gráfico usam os tons validados (rodar o validador da skill dataviz no modo escuro): ciano `#08a4bf`, violeta `#8b5cf6`, âmbar `#cc7f08`. Os brilhos e textos usam `#22d3ee`, `#a78bfa` e `#fbbf24`. **Vermelho `#f87171` só para alerta** (acima do orçado, estouro revelado).
- **Significado fixo das cores.** Ciano = obra / pagamento na EAP / realizado. Violeta = ambientação / reembolso / orçado. Âmbar = ação, atenção e média móvel.
- **Números principais**: Sora 700, 32px, degradê claro `#a5f3fc → #ddd6fe` com brilho suave. O KPI de atenção usa degradê âmbar. Textos em Inter; cores de texto `#f1f5ff`, `#c3cce0` e `#8a96b4`.
- **Ordem dos blocos** (conta a história do "o que fazer" ao "por quê"):
  1. Onde agir agora (3 cartões com impacto em R$, responsável e prazo)
  2. Situação em números (4 KPIs: orçamento, consumido, pago no período, fora do controle)
  3. Orçado x realizado por grupo | Onde está o saldo a contratar
  4. Pagamentos por dia/mês (barras empilhadas EAP + reembolso, com média móvel) | Por onde o dinheiro saiu (canais)
  5. Dados de origem (tabelas recolhíveis)
- **Todo gráfico tem uma frase de leitura** (caixa `.leitura`) que diz o que o dado significa para o negócio, gerada por `A.frases`.
- **Animações**: subida dos cartões, contagem dos KPIs, barras crescendo e linha desenhando. Use keyframes CSS, não transições em atributos SVG. Respeite `prefers-reduced-motion`. O redesenho só acontece quando a largura da tela muda.
- **Tooltip** em toda barra e linha. Layout em grade de 12 colunas; abaixo de 1200px, 1 coluna; abaixo de 720px, barras sob o rótulo. Sem rolagem horizontal em 390px.
- **Evitar**: eixo duplo, projeção linear de custo (gasto em picos engana), gráfico de quadrantes com pontos empilhados em 0%, e chamar % de consumo de "atingimento de meta". Em custo, 100% não é objetivo.

## Estrutura do relatório (PDF A4, tema claro)

1. **Capa** com resumo em uma frase: % consumido, % fora do controle, economia estimada, saldo em risco e estouro já ocorrido.
2. **Diagnóstico em números**: 4 KPIs, um parágrafo e a tabela por grupo.
3. **Descobertas em ordem de impacto financeiro**: cada uma com Evidência, Causa → efeito e Impacto.
4. **Plano de ação por retorno ÷ esforço**, com responsável sugerido e prazo.
5. **Cenário se as recomendações forem seguidas** (Hoje x Com as ações), com premissas numeradas.
6. **O que os dados não permitem afirmar**: avanço físico, cronograma, tendência, vínculos assumidos, situação dos reembolsos, duplicidade não confirmada e economia como premissa.

Os responsáveis sugeridos são papéis (Engenheiro da obra, Compras + arquitetura/cliente, Administrativo/financeiro), não nomes. Só use nomes se o usuário informar.
