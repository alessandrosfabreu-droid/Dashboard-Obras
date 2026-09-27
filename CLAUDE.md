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

Referência: layout de painel executivo escuro com rótulos em fonte monoespaçada. O usuário mandou prints de um painel comercial ("Nexo Solar") como modelo; mantenha essa linguagem.

- **Fontes**: Outfit (títulos e números grandes), Inter (texto corrido), JetBrains Mono (rótulos, eixos, selos, tooltips, anotações e rodapé). Todas vêm do Google Fonts e têm fallback de sistema.
- **Fundo**: degradê azul-noite → quase preto (`#0a1834 → #060b19 → #030409`) com brilhos radiais ciano (esquerda) e violeta (direita).
- **Cartões de vidro**: fundo `rgba(255,255,255,.035–.065)`, `backdrop-filter: blur(18px)`, borda de 1px `rgba(148,197,255,.14)` que clareia no hover, raio de 18px e padding generoso (26–28px).
- **Cabeçalho**: eyebrow em mono ciano ("CLÍNICA SENSI · DIRETORIA DE OBRAS"), título "Painel Executivo" (Outfit 700, 46px), resumo em uma linha com os números-chave e, à direita, uma pílula mono com o período e a base de comparação.
- **KPIs (6)**: rótulo em mono maiúsculo espaçado; valor em Outfit 700, 38px, com degradê `#67e8f9 → #c4b5fd` e brilho, com "R$" e "mil" menores; um **selo** (pílula com seta: verde = bom, vermelho = ruim, cinza = neutro); e uma linha mono de comparação `antes → depois`. São 6 colunas só acima de 1560px, 3×2 abaixo disso, 2 no celular.
  - Sem mês anterior, o selo mostra contexto (ex.: "29,5% do pago").
  - Com mês anterior em `saidas/`, o `atualizar.py` injeta os dados em `/*__ANTERIOR__*/`, e o selo passa a mostrar a variação (`↑ +x%`) e a linha `mês anterior → atual`. Para custo, subir é ruim (`sobe: false`).
- **Cabeçalho de cada gráfico**: título (Outfit 600, 20px), descrição que explica a escolha do gráfico e um **chip** mono no canto superior direito com o número-chave (ex.: "11 DIAS", "5 ITENS = 55% DO SALDO", "29,5% FORA DA EAP"). O chip fica vermelho quando é alerta.
- **Leitura**: todo gráfico termina com uma frase que interpreta o dado, com borda esquerda âmbar de 3px, chamada em negrito (`A.chamadas`) e texto de `A.frases`.
- **Paleta**:
  - Marcas de gráfico validadas: ciano `#08a4bf`, violeta `#8b5cf6`, âmbar `#cc7f08`. Brilhos: `#22d3ee`, `#a78bfa`, `#eab308`.
  - Verde `#34d399` só em selo favorável. **Vermelho `#f87171` só para alerta.**
  - Significado fixo:
    - ciano = obra / pagamento na EAP;
    - violeta = ambientação / reembolso;
    - degradê ciano→violeta = pago total;
    - âmbar = orçamento (nas barras pareadas), média móvel e chamadas de atenção.
- **Ordem dos blocos**:
  1. Cabeçalho
  2. KPIs (orçamento total, consumido, pago no período, fora do controle, economia possível, estouro já ocorrido)
  3. Onde agir agora (3 cartões: impacto em R$ grande e âmbar, estouro em vermelho, responsável e prazo em mono)
  4. **Trajetória**, largura total, em 3 painéis empilhados com eixo x compartilhado: pago acumulado (área + linha em degradê com brilho e círculos vazados no início e no fim), pago no período (barras empilhadas EAP + reembolso com média móvel âmbar) e registros no diário (círculos proporcionais). Uma coluna de hover cobre os 3 painéis.
  5. **Onde está o saldo a contratar** | **Por onde o dinheiro saiu**: barras horizontais estilo funil (rótulo mono à esquerda, barra em degradê sobre trilho escuro, valor em negrito colado na barra, % à direita). Entre as linhas vai uma anotação: âmbar "▲ até aqui: 5 itens = X% do saldo"; vermelho "▼ X% do pago fica fora do orçado x realizado".
  6. **Cada grupo consome o que pesa?**, largura total: barras pareadas na mesma escala (âmbar = fatia do orçamento, ciano→violeta = fatia do pago), 5 maiores grupos + "Demais N grupos". À direita, % consumido grande em ciano e Δ em p.p. (verde se positivo, vermelho se negativo).
  7. Dados de origem (tabelas recolhíveis em mono)
- **Animações**: subida dos cartões, contagem dos KPIs, barras crescendo e linhas desenhando, sempre com keyframes CSS (não transição em atributo SVG). Respeite `prefers-reduced-motion`. Redesenhe só quando a largura mudar.
- **Celular (390px)**: sem rolagem horizontal. Rótulos sobem para cima das barras. O eixo da trajetória perde o "R$". Chips quebram linha.
- **Evitar**: eixo duplo, projeção linear de custo (o gasto vem em picos), gráfico de quadrantes com pontos empilhados em 0%, e chamar % de consumo de "atingimento de meta". Em custo, 100% não é objetivo.

## Estrutura do relatório (PDF A4, tema claro)

1. **Capa** com resumo em uma frase: % consumido, % fora do controle, economia estimada, saldo em risco e estouro já ocorrido.
2. **Diagnóstico em números**: 4 KPIs, um parágrafo e a tabela por grupo.
3. **Descobertas em ordem de impacto financeiro**: cada uma com Evidência, Causa → efeito e Impacto.
4. **Plano de ação por retorno ÷ esforço**, com responsável sugerido e prazo.
5. **Cenário se as recomendações forem seguidas** (Hoje x Com as ações), com premissas numeradas.
6. **O que os dados não permitem afirmar**: avanço físico, cronograma, tendência, vínculos assumidos, situação dos reembolsos, duplicidade não confirmada e economia como premissa.

Os responsáveis sugeridos são papéis (Engenheiro da obra, Compras + arquitetura/cliente, Administrativo/financeiro), não nomes. Só use nomes se o usuário informar.
