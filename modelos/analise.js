/* Análise compartilhada pelo dashboard e pelo relatório.
   Entrada: objeto DADOS gerado por scripts/extrair_dados.py.
   Saída: números derivados, frases interpretativas, achados e plano de ação.
   Todo texto é montado a partir dos números; nada aqui é fixo para um mês. */

const PREMISSAS = {
  economiaNegociacao: 0.05,   // economia esperada ao cotar/negociar itens ainda não contratados
  pesoGrupoRelevante: 0.20,   // grupo com peso >= 20% do orçamento e 0% executado vira achado
  consumoItemAlerta: 0.50,    // item com >= 50% do orçado consumido vira achado
  topItens: 8,                // itens exibidos em "onde está o saldo"
};

const fmt = {
  brl: v => v.toLocaleString("pt-BR", {style: "currency", currency: "BRL"}),
  brl0: v => v.toLocaleString("pt-BR", {style: "currency", currency: "BRL", maximumFractionDigits: 0}),
  num: (v, d = 0) => v.toLocaleString("pt-BR", {minimumFractionDigits: d, maximumFractionDigits: d}),
  pct: (v, d = 1) => (v * 100).toLocaleString("pt-BR", {minimumFractionDigits: d, maximumFractionDigits: d}) + "%",
  mil: v => "R$ " + (v / 1000).toLocaleString("pt-BR", {minimumFractionDigits: 1, maximumFractionDigits: 1}) + " mil",
  data: iso => { const [a, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}/${a}`; },
  dm: iso => { const [, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}`; },
  nome: s => { const t = s.toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); },
  // nome curto do item: tira "Fornecimento (e execução) de" do começo
  curto: s => { const t = s.replace(/^fornecimento( e (execução|montagem))?( de)? /i, "").replace(/^execução de /i, ""); return t.charAt(0).toUpperCase() + t.slice(1); },
};

function somaDias(iso, n) {
  const d = new Date(iso.slice(0, 10) + "T12:00:00"); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function analisar(D) {
  const eap = D.eap;
  const raiz = eap.filter(e => e.nivel === 1);
  const orcTotal = raiz.reduce((s, e) => s + e.orc, 0);
  const realEap = raiz.reduce((s, e) => s + e.real, 0);
  const grupos = eap.filter(e => e.nivel === 2).map(g => ({...g, nome: fmt.nome(g.desc), saldo: g.orc - g.real}));
  const itens = eap.filter(e => e.nivel === 4).map(i => {
    const g = grupos.find(g => i.cod.startsWith(g.cod));
    return {...i, nome: fmt.nome(i.desc), grupo: g ? g.nome : "", macro: i.cod.slice(0, 3), saldo: i.orc - i.real};
  });
  const macro = Object.fromEntries(raiz.map(r => [r.cod, fmt.nome(r.desc)]));

  // pagamentos unificados (lançamentos EAP + reembolsos)
  const canalReemb = f => /apple pay|cart/i.test(f) ? "Reembolso · Apple Pay" : "Reembolso · " + f.split(" ")[0];
  const pagamentos = [
    ...D.lancamentos.map(l => ({data: l.data, valor: l.valor, origem: "eap", canal: "Pagamento direto · " + l.tipo,
      rotulo: l.desc, favorecido: l.favorecido})),
    ...D.reembolsos.map(r => ({data: r.data, valor: r.valor, origem: "reembolso", canal: canalReemb(r.forma),
      rotulo: r.finalidade, favorecido: r.favorecido, categoria: r.categoria})),
  ].sort((a, b) => a.data.localeCompare(b.data));
  const totalPago = pagamentos.reduce((s, p) => s + p.valor, 0);
  const totalReemb = D.reembolsos.reduce((s, r) => s + r.valor, 0);

  // série temporal: diária se o período cabe em um mês, mensal caso contrário
  const meses = [...new Set(pagamentos.map(p => p.data.slice(0, 7)))];
  const mensal = meses.length > 1;
  const chaves = [];
  if (mensal) meses.sort().forEach(m => chaves.push(m));
  else for (let d = D.periodo.inicio; d <= D.periodo.fim; d = somaDias(d, 1)) chaves.push(d);
  const serie = chaves.map(k => {
    const ps = pagamentos.filter(p => p.data.startsWith(k));
    return {k, eap: ps.filter(p => p.origem === "eap").reduce((s, p) => s + p.valor, 0),
      reembolso: ps.filter(p => p.origem === "reembolso").reduce((s, p) => s + p.valor, 0), ps};
  });
  serie.forEach((s, i) => {
    s.total = s.eap + s.reembolso;
    const jan = serie.slice(Math.max(0, i - 2), i + 1);
    s.media = jan.reduce((a, x) => a + x.eap + x.reembolso, 0) / jan.length;
  });
  const diasComPagto = serie.filter(s => s.total > 0).length;
  const picos = serie.slice().sort((a, b) => b.total - a.total).slice(0, 2).filter(s => s.total > 0).sort((a, b) => a.k.localeCompare(b.k));
  const partePicos = picos.reduce((a, s) => a + s.total, 0) / totalPago;

  // canais
  const canais = Object.values(pagamentos.reduce((m, p) => {
    (m[p.canal] ||= {canal: p.canal, origem: p.origem, valor: 0, n: 0}); m[p.canal].valor += p.valor; m[p.canal].n++; return m;
  }, {})).sort((a, b) => b.valor - a.valor);

  // ---------- achados ----------
  const achados = [];

  // A. item com consumo alto (risco de estouro)
  itens.filter(i => i.real > 0 && i.real / i.orc >= PREMISSAS.consumoItemAlerta).forEach(i => {
    const ls = D.lancamentos.filter(l => l.cod === i.cod);
    const obs = ls.map(l => l.obs).filter(Boolean).join(" ");
    const rateio = /rate(i|a)/i.test(obs);
    achados.push({
      id: "consumo-" + i.cod, tipo: "risco", impacto: i.saldo, esforco: 1,
      titulo: `${fmt.curto(i.nome)}: ${fmt.pct(i.real / i.orc)} do item já consumido`,
      curto: `Proteger o saldo de ${fmt.curto(i.nome).toLowerCase()}`,
      evidencia: `Item ${i.cod} orçado em ${fmt.brl(i.orc)}; ${ls.length} lançamento(s) somam ${fmt.brl(i.real)} ` +
        `(${ls.map(l => l.desc.toLowerCase()).join("; ")}). Saldo restante: ${fmt.brl(i.saldo)}.` + (obs ? ` Observação na planilha: “${obs}”` : ""),
      raciocinio: `O item cobre “${i.nome.toLowerCase()}”. Com ${fmt.pct(i.real / i.orc, 0)} já pago, os ${fmt.brl(i.saldo)} restantes precisam cobrir tudo o que ainda falta nele. ` +
        `Se ainda houver mão de obra ou material a pagar acima disso, o item estoura, e isso só aparece quando o pagamento já tiver sido feito.` +
        (rateio ? ` A planilha também indica que parte da compra pode pertencer a outro item; o rateio mudaria o percentual consumido.` : ""),
      acao: `Levantar com o fornecedor quanto falta pagar no item` + (rateio ? ` e fazer o rateio da compra entre os itens` : ""),
      impactoTxt: `${fmt.brl0(i.saldo)} de saldo a proteger`,
      responsavel: "Engenheiro da obra", prazoDias: 5,
    });
  });

  // B. grande grupo ainda não contratado (oportunidade de negociação)
  grupos.filter(g => g.real === 0 && g.orc / orcTotal >= PREMISSAS.pesoGrupoRelevante).forEach(g => {
    const filhos = itens.filter(i => i.cod.startsWith(g.cod)).sort((a, b) => b.orc - a.orc);
    const eco = g.orc * PREMISSAS.economiaNegociacao;
    achados.push({
      id: "negociar-" + g.cod, tipo: "oportunidade", impacto: eco, esforco: 2,
      titulo: `${g.nome}: ${fmt.pct(g.orc / orcTotal)} do orçamento, nada contratado ainda`,
      curto: `Cotar ${g.nome.toLowerCase()} antes de fechar`,
      evidencia: `${g.nome} soma ${fmt.brl(g.orc)} e está com 0% executado. Maiores itens: ` +
        filhos.slice(0, 3).map(i => `${fmt.curto(i.nome).toLowerCase()} (${fmt.brl0(i.orc)})`).join(", ") + ".",
      raciocinio: `Como nada foi contratado, ainda dá para negociar preço e prazo. É o maior bloco do orçamento, então qualquer ponto percentual de desconto aqui vale mais do que em todo o resto. ` +
        `Com ${fmt.pct(PREMISSAS.economiaNegociacao, 0)} de economia (premissa), são ${fmt.brl0(eco)}.`,
      acao: `Pedir no mínimo 3 cotações para ${filhos.slice(0, 2).map(i => fmt.curto(i.nome).toLowerCase()).join(" e ")} e negociar o pacote`,
      impactoTxt: `≈ ${fmt.brl0(eco)} de economia (${fmt.pct(PREMISSAS.economiaNegociacao, 0)})`,
      responsavel: "Compras + arquitetura/cliente", prazoDias: 20,
    });
  });

  // C. gasto fora do orçado x realizado (reembolsos sem vínculo com a EAP)
  if (totalReemb > 0) {
    const porCat = Object.entries(D.reembolsos.reduce((m, r) => (m[r.categoria] = (m[r.categoria] || 0) + r.valor, m), {}))
      .sort((a, b) => b[1] - a[1]);
    const estouros = Object.entries(D.mapa_reembolso_eap || {}).map(([cat, cod]) => {
      const item = itens.find(i => i.cod === cod); const v = porCat.find(c => c[0] === cat)?.[1] || 0;
      return item && item.real + v > item.orc ? {cat, item, v, excesso: item.real + v - item.orc} : null;
    }).filter(Boolean);
    achados.push({
      id: "reembolsos", tipo: "controle", impacto: totalReemb, esforco: 1,
      titulo: `${fmt.pct(totalReemb / totalPago)} do que foi pago não aparece no orçado x realizado`,
      curto: `Vincular os reembolsos ao orçamento`,
      evidencia: `${D.reembolsos.length} reembolsos somam ${fmt.brl(totalReemb)} (` + porCat.map(([c, v]) => `${c} ${fmt.brl0(v)}`).join(", ") +
        `) e não têm código da EAP. Com eles, o realizado passaria de ${fmt.brl0(realEap)} para ${fmt.brl0(realEap + totalReemb)}.` +
        estouros.map(e => ` A categoria ${e.cat} sozinha soma ${fmt.brl(e.v)} contra ${fmt.brl(e.item.orc)} orçados no item ${e.item.cod}: ${fmt.brl(e.excesso)} acima.`).join(""),
      raciocinio: `Enquanto os reembolsos ficam fora da EAP, o consumo do orçamento parece menor do que é e estouros de item (como o citado) não aparecem no painel. ` +
        `É um ajuste de classificação que custa pouco e corrige a leitura de todos os gráficos.`,
      acao: `Informar o código da EAP em cada reembolso e incluí-los no controle financeiro`,
      impactoTxt: `${fmt.brl0(totalReemb)} passam a ser controlados` + (estouros.length ? ` · ${fmt.brl0(estouros.reduce((a, e) => a + e.excesso, 0))} de estouro revelado` : ""),
      responsavel: "Administrativo/financeiro", prazoDias: 4,
      estouros,
    });
  }

  // D. possíveis duplicidades (mesmo favorecido e mesmo valor)
  const dup = {};
  pagamentos.forEach(p => { const k = p.favorecido + "|" + p.valor.toFixed(2); (dup[k] ||= []).push(p); });
  Object.values(dup).filter(v => v.length > 1).forEach(v => {
    const extra = v[0].valor * (v.length - 1);
    achados.push({
      id: "dup-" + v[0].favorecido, tipo: "verificar", impacto: extra, esforco: 1,
      titulo: `Possível pagamento em duplicidade: ${v[0].favorecido}`,
      curto: `Conferir pagamento repetido a ${v[0].favorecido}`,
      evidencia: `${v.length} pagamentos de ${fmt.brl(v[0].valor)} ao mesmo favorecido, em ${v.map(p => fmt.dm(p.data)).join(" e ")} (${v[0].rotulo}).`,
      raciocinio: `Mesmo favorecido e mesmo valor em datas próximas pode ser pagamento repetido ou duas guias diferentes (por exemplo, ART de execução e de projeto). Só o documento de origem confirma.`,
      acao: `Conferir os números das guias; se for duplicidade, pedir estorno`,
      impactoTxt: `até ${fmt.brl(extra)} recuperáveis`,
      responsavel: "Administrativo/financeiro", prazoDias: 4,
    });
  });

  achados.sort((a, b) => b.impacto - a.impacto);
  const plano = achados.slice().sort((a, b) => b.impacto / b.esforco - a.impacto / a.esforco)
    .map(a => ({...a, prazo: somaDias(D.periodo.fim, a.prazoDias)}));

  // ---------- frases interpretativas ----------
  const gruposComGasto = grupos.filter(g => g.real > 0).sort((a, b) => b.real / b.orc - a.real / a.orc);
  const acima = grupos.filter(g => g.real > g.orc);
  const topSaldo = itens.slice().sort((a, b) => b.saldo - a.saldo).slice(0, PREMISSAS.topItens);
  const saldoTotal = orcTotal - realEap;
  const top5 = topSaldo.slice(0, 5);
  const top5Macro = top5.filter(i => i.macro === top5[0].macro).length;
  const reembParte = totalReemb / totalPago;

  const frases = {
    grupos: `Só ${gruposComGasto.length} de ${grupos.length} grupos tiveram gasto (` +
      gruposComGasto.map(g => `${g.nome} ${fmt.pct(g.real / g.orc)}`).join(", ") + `)` +
      (acima.length ? `, e ${acima.map(g => g.nome).join(", ")} já passou do orçado.` : `, e nenhum passou do orçado.`) +
      ` Como a obra está no começo, o risco agora está nos itens, não nos grupos. Esses percentuais medem dinheiro gasto, não avanço físico.`,
    itens: `Os 5 maiores itens a contratar somam ${fmt.brl0(top5.reduce((a, i) => a + i.saldo, 0))}, ou ${fmt.pct(top5.reduce((a, i) => a + i.saldo, 0) / saldoTotal, 0)} do saldo. ` +
      `${top5Macro} deles são de ${macro[top5[0].macro].toLowerCase()}, então é na negociação desses itens que o resultado final da obra se decide.`,
    evolucao: picos.length
      ? `${fmt.pct(partePicos, 0)} do valor saiu em ${picos.length} ${mensal ? "meses" : "dias"} (${picos.map(p => mensal ? p.k : fmt.dm(p.k)).join(" e ")}), puxado por ${pagamentos.slice().sort((a, b) => b.valor - a.valor).slice(0, 2).map(p => `${p.favorecido} (${fmt.brl0(p.valor)})`).join(" e ")}. ` +
        `O gasto vem em picos de compra, não em ritmo constante, então a média diária não serve para projetar o custo final.`
      : `Sem pagamentos no período.`,
    canais: `${fmt.pct(reembParte, 0)} do valor (${fmt.brl0(totalReemb)}) foi pago do próprio bolso e depende de reembolso. ` +
      `Esse dinheiro fica fora do orçado x realizado até ser vinculado à EAP, então o consumo real do orçamento é maior do que o painel de grupos mostra.`,
  };

  return {
    PREMISSAS, orcTotal, realEap, saldoTotal, totalPago, totalReemb, reembParte, grupos, itens, macro,
    pagamentos, serie, mensal, diasComPagto, canais, topSaldo, achados, plano, frases, acima,
    periodo: D.periodo,
  };
}
