// Gantt de Produção (Tinturaria de Fio e Tingimento): lê a programação de lotes do Orgatex
// (tabela Dyelots, SQL Server, só leitura) e serve a página em public/index.html.
// App própria, independente do Lab Data e do Portal — só liga a um sítio: ORGATEX-INTEG.
// Usa o mesmo ficheiro de segredos do Lab Data (as credenciais ORGATEX_INTEG_* já lá estão,
// usadas também por scripts\atualizar_lotes_macro.py do Lab Data): C:\LabDataAppSecrets\.env
// (outra pasta: variável de ambiente GANTT_SECRETS_DIR).
require('dotenv').config({
  path: require('path').join(process.env.GANTT_SECRETS_DIR || 'C:\\LabDataAppSecrets', '.env'),
});
const fs = require('fs');
const path = require('path');
const express = require('express');

const PORT = process.env.PORT || 5051;
const HOST = process.env.HOST || '0.0.0.0';
const PASTA_DADOS = path.join(__dirname, 'data');
const CACHE = path.join(PASTA_DADOS, 'gantt-orgatex.json');
// sobe quando o formato do cache muda: força uma leitura imediata ao arrancar
const VERSAO_DADOS = 12;
const INTERVALO_MIN = Number(process.env.ORGATEX_GANTT_INTERVALO_MIN || 3);

fs.mkdirSync(PASTA_DADOS, { recursive: true });

let estado = { dados: lerJson(CACHE, null), aAtualizar: false, ultimoErro: null, ultimaTentativa: null };

function lerJson(f, omissao) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return omissao; }
}

const env = (n) => (process.env[n] || '').trim();

function configurado() {
  return !!(env('ORGATEX_INTEG_SERVER') && env('ORGATEX_INTEG_UID') && env('ORGATEX_INTEG_PWD'));
}

function configLigacao() {
  // aceita "servidor\instância", "servidor,porta" ou só "servidor"
  let servidor = env('ORGATEX_INTEG_SERVER'), porta = null, instancia = null;
  if (servidor.includes(',')) [servidor, porta] = servidor.split(',').map((x) => x.trim());
  else if (servidor.includes('\\')) [servidor, instancia] = servidor.split('\\');
  const cfg = {
    server: servidor,
    database: env('ORGATEX_INTEG_DB') || 'ORGATEX-INTEG',
    user: env('ORGATEX_INTEG_UID'),
    password: env('ORGATEX_INTEG_PWD'),
    options: { encrypt: true, trustServerCertificate: true },
    connectionTimeout: 30000,
    requestTimeout: 60000,
    pool: { max: 2, min: 0, idleTimeoutMillis: 30000 },
  };
  if (porta) cfg.port = Number(porta);
  else if (instancia) cfg.options.instanceName = instancia;
  return cfg;
}

// Ordem de apresentação das máquinas, igual à vista "Geral" do Orgatex (jiggers, depois as MQ, depois
// secador/ramula). Uma máquina que apareça na base mas não esteja aqui vai parar ao fim, por ordem alfabética.
const ORDEM_MAQUINAS = [
  'JIGA', 'JIGB', 'JIG1', 'JIG2', 'JIG3', 'JIG4', 'JIG5', 'JIG6', 'JIG7', 'JIG8', 'JIG9', 'JI10',
  'MQ99', 'MQ00', 'MQ01', 'MQ02', 'MQ03', 'MQ04', 'MQ05', 'MQ06', 'MQ07', 'MQ08', 'MQ10',
  'MQ11', 'MQ12', 'MQ13', 'MQ14', 'MQ15', 'MQ16', 'DR01', 'RAM3', 'JET1',
];
function ordemMaquina(m) {
  const i = ORDEM_MAQUINAS.indexOf(m);
  return i === -1 ? 999 : i;
}

// Cor aproximada da barra, a partir da descrição da cor do lote (ColourDescript). Não é a cor exata do
// tingimento (a descrição é texto livre, às vezes um código Pantone/TCX) — é só uma aproximação visual.
// Lista por ordem: termos mais específicos primeiro, para não "roxo" apanhar dentro de outra palavra, etc.
const CORES_NOMEADAS = [
  [/\bpret[oa]\b|preto|black|\bébano\b|ebano|carvão|carvao/, '#2b2b2b'],
  [/branc[oa]|white|nev[ae]|off[\s-]?white/, '#f4f4f1'],
  [/antracite|anthracite|grafite|graphite|chumbo/, '#4a4a4f'],
  [/cinz[ae]nt[oa]?|cinza|grey|gray/, '#8e8e93'],
  [/prat[ae]ad[oa]|prata|silver/, '#b9bfc7'],
  [/dourad[oa]|ouro|\bgold\b/, '#c9a227'],
  [/bronze/, '#8c6a3f'],
  [/cobre|copper/, '#b06a3a'],
  [/champagne|champanhe/, '#e9d9b6'],
  [/taupe|pérola|perola|pearl/, '#c9c0b4'],
  [/nude/, '#d9b99a'],
  [/are[ia]a|sand/, '#dcc49a'],
  [/bege|beige/, '#d9c6a5'],
  [/cru\b|ecru|ecru[-\s]?ish/, '#e6dcc3'],
  [/mel\b|honey/, '#cf9a3e'],
  [/mostarda|mustard/, '#c9a227'],
  [/kaki|khaki/, '#8a8458'],
  [/oliva|olive/, '#6f7a3a'],
  [/acaju|acajou|mogno|mahogany/, '#6b3226'],
  [/chocolate|cacau|cocoa/, '#4a2f22'],
  [/castanh[oa]|marrom|camel|tabaco|brown/, '#7b4a2d'],
  [/terracota|terracotta/, '#aa522e'],
  [/ferrugem|rust/, '#9a4a2a'],
  [/bordeaux|bordo|vinho|grená|maroon|marsala/, '#6e1423'],
  [/cereja|cherry/, '#a0192f'],
  [/vermelh[oa]|\bred\b/, '#c62828'],
  [/framboesa|raspberry|magenta/, '#c22a6a'],
  [/fúchsia|fuchsia|\bpink\b/, '#e685b5'],
  [/rosa velh[oa]|rosa antigo|dusty pink/, '#c98fa0'],
  [/\brosa\b/, '#e685b5'],
  [/salmão|salmao|salmon/, '#e8917a'],
  [/coral/, '#ea7158'],
  [/laranja|orange/, '#e8792b'],
  [/âmbar|ambar|amber|topázio|topazio/, '#d99a2b'],
  [/amarel[oa]|yellow/, '#e3c23c'],
  [/lima|lima[ãa]o|\blime\b/, '#9acd32'],
  [/jade|esmeralda|emerald/, '#2e8b6f'],
  [/verde|\bgreen\b/, '#4c9a52'],
  [/marinho|navy/, '#1b2a52'],
  [/petróleo|petroleo|teal/, '#1b5e5a'],
  [/turquesa|ciano|cian|turquoise/, '#1aa6a0'],
  [/celeste|bleu ciel|ciel|\bsky\b/, '#6fb7d6'],
  [/azul|\bblue\b/, '#3b6fb0'],
  [/lavanda|lavender/, '#9a8fc4'],
  [/malva|mauve/, '#a97ca0'],
  [/roxo|lilás|lilaz|violeta|púrpura|purple|violet/, '#7a4fa0'],
  [/creme|marfim|cream|ivory/, '#efe4c8'],
];
// claro/escuro (ou light/dark) ajustam a cor base encontrada acima
function ajustarClaroEscuro(hex, texto) {
  const t = texto;
  if (/\bclar[oa]|\blight\b/.test(t)) return misturarComBranco(hex, 0.35);
  if (/\bescur[oa]|\bdark\b/.test(t)) return misturarComPreto(hex, 0.3);
  return hex;
}
function misturarComBranco(hex, f) { return misturar(hex, [255, 255, 255], f); }
function misturarComPreto(hex, f) { return misturar(hex, [0, 0, 0], f); }
function misturar(hex, [br, bg, bb], f) {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  const mix = (c, bc) => Math.round(c * (1 - f) + bc * f);
  return '#' + [mix(r, br), mix(g, bg), mix(b, bb)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
function semAcentos(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
// O Orgatex guarda a cor exata (RGB) no campo Color, formato Windows COLORREF (0x00BBGGRR: vermelho no
// byte mais baixo, azul no mais alto). Quando existe é muito mais fiável do que adivinhar pela descrição
// em texto. 0 é usado como "sem cor definida" (não é preto a sério, exceto em casos raros) — ignora-se.
function corDoRGB(color) {
  if (!color) return null;
  const v = (color >>> 0) & 0xffffff;
  if (v === 0) return null;
  const r = v & 0xff, g = (v >> 8) & 0xff, b = (v >> 16) & 0xff;
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
// Paleta neutra só para quando não há cor RGB nem a descrição dá para reconhecer nenhuma cor (ex. só um
// código Pantone/TCX).
const PALETA_SEM_COR = ['#8C8C8C', '#6b7280', '#9aa0a6', '#78716c'];
function corDoLote(descricao, chaveFallback, colorRGB) {
  const doRGB = corDoRGB(colorRGB);
  if (doRGB) return doRGB;
  const t = semAcentos(descricao);
  for (const [re, hex] of CORES_NOMEADAS) {
    if (re.test(t)) return ajustarClaroEscuro(hex, t);
  }
  let h = 0;
  for (const c of String(chaveFallback)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETA_SEM_COR[h % PALETA_SEM_COR.length];
}
// Paragens da máquina (não são lotes): o Orgatex regista-as como se fossem um "lote" especial, com
// este texto fixo no campo Dyelot. Mostram-se com uma cor fixa (como no Orgatex), não pela cor do tingimento.
const EVENTOS_ESPECIAIS = {
  AVARIADO: { cor: '#b3261e', rotulo: 'Avaria' },
  AVARIA: { cor: '#b3261e', rotulo: 'Avaria' },
  'MANUTENÇÃO': { cor: '#e08e00', rotulo: 'Manutenção' },
  MANUTENCAO: { cor: '#e08e00', rotulo: 'Manutenção' },
  'LAVAR JIGGER': { cor: '#1aa6a0', rotulo: 'Lavagem' },
  LAVAGEM: { cor: '#1aa6a0', rotulo: 'Lavagem' },
};

// Luminância aproximada: decide se o texto da barra deve ser escuro (sobre fundos claros) ou branco.
function corDoTexto(hexFundo) {
  const n = hexFundo.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  const luminancia = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminancia > 0.6 ? '#1a1a2e' : '#ffffff';
}

async function ler(desde, ate) {
  const sql = require('mssql');
  let pool;
  try {
    pool = await new sql.ConnectionPool(configLigacao()).connect();
    const maquinasR = await pool.request().query(`SELECT MachineNo FROM Machines WITH (NOLOCK) ORDER BY MachineNo`);
    // Um lote na fila (sem hora de início) pode ficar dias à espera — ex. uma avaria ou manutenção só
    // é retirada da fila quando for resolvida — por isso usa-se um limite bem mais largo que o "desde"
    // da janela do Gantt (só para não arrastar lixo de anos, como filas esquecidas de 2024).
    const filaDesde = new Date(Math.min(desde.getTime(), Date.now() - 30 * 24 * 3600000));
    const lotesR = await pool
      .request()
      .input('desde', sql.DateTime, desde)
      .input('ate', sql.DateTime, ate)
      .input('filaDesde', sql.DateTime, filaDesde)
      .query(`
        SELECT Machine, Dyelot, DyelotRefNo, StartTime, EndTime, Article, ColourDescript, Customer,
               State, SetTime, QueueTime, Color
        FROM Dyelots WITH (NOLOCK)
        WHERE (EndTime >= @desde OR EndTime IS NULL)
          AND (StartTime <= @ate OR StartTime IS NULL)
          AND (StartTime IS NOT NULL OR QueueTime >= @filaDesde)
        ORDER BY Machine, StartTime
      `);
    return { maquinas: maquinasR.recordset, lotes: lotesR.recordset };
  } finally {
    if (pool) pool.close().catch(() => {});
  }
}

// Máquinas que existem na base do Orgatex mas não devem aparecer no Gantt (não existem fisicamente
// ou não interessam a este setor) — pedido da Lia.
const MAQUINAS_EXCLUIDAS = new Set(['JIG4', 'MQ99', 'MQ00', 'MQ10', 'MQ11', 'RAM3', 'JET1']);

// Duração prevista por omissão (segundos), só usada quando o lote não tem SetTime nem nenhum outro lote
// recente da mesma máquina para estimar — 6h é um valor típico de um tingimento.
const DURACAO_OMISSAO_S = 6 * 3600;

// A fábrica para das 6h de sábado às 6h de segunda (confirmado nos dados: zero lotes a começar ou a
// acabar nesse intervalo). As estimativas (fila e lotes a decorrer) saltam este período — não há
// ninguém a arrancar máquinas nem lotes a avançar sozinhos durante o fecho.
function estaFechado(ms) {
  const d = new Date(ms);
  const dia = d.getDay(), hora = d.getHours() + d.getMinutes() / 60;
  if (dia === 6 && hora >= 6) return true; // sábado a partir das 6h
  if (dia === 0) return true; // domingo todo
  if (dia === 1 && hora < 6) return true; // segunda antes das 6h
  return false;
}
function proximaSegunda6h(ms) {
  const d = new Date(ms);
  d.setHours(6, 0, 0, 0);
  let dias = (1 - d.getDay() + 7) % 7;
  if (dias === 0 && d.getTime() < ms) dias = 7;
  d.setDate(d.getDate() + dias);
  return d.getTime();
}
function proximoSabado6h(ms) {
  const d = new Date(ms);
  d.setHours(6, 0, 0, 0);
  let dias = (6 - d.getDay() + 7) % 7;
  if (dias === 0 && d.getTime() <= ms) dias = 7;
  d.setDate(d.getDate() + dias);
  return d.getTime();
}
// Início ajustado: se cair dentro do fecho, empurra para a reabertura (segunda às 6h).
function inicioAjustado(ms) {
  return estaFechado(ms) ? proximaSegunda6h(ms) : ms;
}
// Avança uma duração a partir de um início (já fora do fecho), saltando qualquer fecho pelo meio.
function avancarComFecho(inicioMs, duracaoMs) {
  let t = inicioMs, restante = duracaoMs;
  while (restante > 0) {
    const proxFecho = proximoSabado6h(t);
    const disponivel = proxFecho - t;
    if (disponivel >= restante) { t += restante; restante = 0; } else { t = proximaSegunda6h(proxFecho); restante -= disponivel; }
  }
  return t;
}

function montar({ maquinas, lotes }, agora) {
  // todas as máquinas da base (mesmo sem lote agendado agora) + qualquer uma que apareça nos lotes e não esteja lá
  const nomes = new Set(maquinas.map((m) => (m.MachineNo || '').trim()).filter(Boolean));
  for (const l of lotes) if (l.Machine) nomes.add(l.Machine.trim());
  for (const m of MAQUINAS_EXCLUIDAS) nomes.delete(m);
  const listaMaquinas = [...nomes].sort((a, b) => ordemMaquina(a) - ordemMaquina(b) || a.localeCompare(b));

  const validos = lotes.filter((l) => !MAQUINAS_EXCLUIDAS.has((l.Machine || '').trim()));

  // Duração média conhecida (SetTime, em segundos) por máquina, para estimar quando um lote não tem SetTime.
  const duracoesPorMaquina = new Map();
  for (const l of validos) {
    if (!l.SetTime || l.SetTime <= 0) continue;
    const m = (l.Machine || '').trim();
    if (!duracoesPorMaquina.has(m)) duracoesPorMaquina.set(m, []);
    duracoesPorMaquina.get(m).push(l.SetTime);
  }
  function duracaoEstimadaS(maquina, setTime) {
    if (setTime && setTime > 0) return setTime;
    const lista = duracoesPorMaquina.get(maquina);
    if (lista && lista.length) return lista.reduce((a, b) => a + b, 0) / lista.length;
    return DURACAO_OMISSAO_S;
  }

  // 1) lotes com hora real de início (terminados ou a decorrer); ficam já prontos.
  // 2) lotes sem hora de início (na fila, ainda nao arrancaram): por máquina, encadeiam-se uns a seguir
  //    aos outros (pela ordem em que entraram na fila — QueueTime), a partir do fim do último lote
  //    (real ou estimado) dessa máquina.
  const prontos = [];
  const emFilaPorMaquina = new Map();
  // Registos "a decorrer" (sem hora de fim) parados há dias no Orgatex são lixo de dados (nunca foram
  // fechados), não lotes reais a decorrer — senão ficariam "esticados" até agora, parecendo um 2º lote
  // a decorrer na mesma máquina. Um tingimento real não passa disto.
  const LIMITE_A_DECORRER_MS = 48 * 3600000;
  for (const l of validos) {
    const maquina = (l.Machine || '').trim();
    if (l.StartTime) {
      if (!l.EndTime && agora.getTime() - new Date(l.StartTime).getTime() > LIMITE_A_DECORRER_MS) continue;
      prontos.push(l);
    } else {
      if (!emFilaPorMaquina.has(maquina)) emFilaPorMaquina.set(maquina, []);
      emFilaPorMaquina.get(maquina).push(l);
    }
  }

  const fimConhecidoPorMaquina = new Map(); // último fim (real ou estimado) de cada máquina, para encadear a fila
  const listaLotes = [];

  function adicionar(l, inicioMs, fimMs, estimadoInicio, estimadoFim) {
    const maquina = (l.Machine || '').trim();
    const chave = (l.Dyelot || l.DyelotRefNo || '').trim();
    const inicio = new Date(inicioMs).toISOString();
    const fim = new Date(fimMs).toISOString();
    const corDescricao = (l.ColourDescript || '').trim() || null;
    const evento = EVENTOS_ESPECIAIS[chave.toUpperCase()];
    const corBarra = evento ? evento.cor : corDoLote(corDescricao, chave, l.Color);
    let estadoLote = 'agendado';
    if (!estimadoFim && fimMs < agora.getTime()) estadoLote = 'concluido';
    else if (inicioMs <= agora.getTime()) estadoLote = 'a_decorrer';
    listaLotes.push({
      maquina,
      lote: chave,
      inicio,
      fim,
      artigo: (l.Article || '').trim() || null,
      cor: corDescricao,
      cliente: (l.Customer || '').trim() || null,
      estado: estadoLote,
      corBarra,
      corTexto: corDoTexto(corBarra),
      estimado: !!(estimadoInicio || estimadoFim),
      evento: evento ? evento.rotulo : null,
    });
    const atual = fimConhecidoPorMaquina.get(maquina);
    if (!atual || fimMs > atual) fimConhecidoPorMaquina.set(maquina, fimMs);
  }

  for (const l of prontos) {
    const maquina = (l.Machine || '').trim();
    const inicioMs = new Date(l.StartTime).getTime();
    let fimMs, estimadoFim = false;
    if (l.EndTime) {
      fimMs = new Date(l.EndTime).getTime();
    } else {
      // State 30 (a decorrer): ainda não tem hora de fim no Orgatex — estima-se pela duração prevista,
      // saltando o fecho de fim de semana. Se a estimativa já passou mas o Orgatex ainda não deu como
      // terminado, a barra vai pelo menos até agora.
      fimMs = Math.max(avancarComFecho(inicioMs, duracaoEstimadaS(maquina, l.SetTime) * 1000), agora.getTime());
      estimadoFim = true;
    }
    adicionar(l, inicioMs, fimMs, false, estimadoFim);
  }

  for (const [maquina, lista] of emFilaPorMaquina) {
    lista.sort((a, b) => (a.QueueTime ? new Date(a.QueueTime).getTime() : 0) - (b.QueueTime ? new Date(b.QueueTime).getTime() : 0) || String(a.Dyelot).localeCompare(String(b.Dyelot)));
    let cursor = inicioAjustado(Math.max(agora.getTime(), fimConhecidoPorMaquina.get(maquina) || agora.getTime()));
    for (const l of lista) {
      const duracaoMs = duracaoEstimadaS(maquina, l.SetTime) * 1000;
      const fimMs = avancarComFecho(cursor, duracaoMs);
      adicionar(l, cursor, fimMs, true, true);
      cursor = fimMs;
    }
  }

  return { atualizado: agora.toISOString(), versao: VERSAO_DADOS, maquinas: listaMaquinas, lotes: listaLotes };
}

async function atualizar() {
  if (!configurado()) {
    throw new Error(
      'Ligação ao Orgatex (ORGATEX-INTEG) não configurada: falta o ficheiro C:\\LabDataAppSecrets\\.env com ORGATEX_INTEG_SERVER, ORGATEX_INTEG_UID e ORGATEX_INTEG_PWD.'
    );
  }
  if (estado.aAtualizar) return estado.dados;
  estado.aAtualizar = true;
  estado.ultimaTentativa = new Date();
  try {
    const agora = new Date();
    const desde = new Date(agora.getTime() - 24 * 3600000); // 1 dia para trás
    const ate = new Date(agora.getTime() + 7 * 24 * 3600000); // 7 dias para a frente
    const brutos = await ler(desde, ate);
    const dados = montar(brutos, agora);
    fs.writeFileSync(CACHE, JSON.stringify(dados));
    estado.dados = dados;
    estado.ultimoErro = null;
    console.log(`[gantt-producao] atualizado: ${dados.lotes.length} lotes em ${dados.maquinas.length} máquinas`);
    return dados;
  } catch (e) {
    estado.ultimoErro = e.message;
    console.error('[gantt-producao] erro ao ler o Orgatex:', e.message);
    throw e;
  } finally {
    estado.aAtualizar = false;
  }
}

function iniciarAgendamento() {
  if (!configurado()) {
    console.log('[gantt-producao] Orgatex (ORGATEX-INTEG) não configurado: a página mostra os últimos dados guardados, se existirem.');
    return;
  }
  const verificar = () => {
    const agora = new Date();
    const velho = !!estado.dados && estado.dados.versao !== VERSAO_DADOS;
    const ultima = estado.dados ? new Date(estado.dados.atualizado) : null;
    if (estado.ultimaTentativa && agora - estado.ultimaTentativa < 60000) return;
    if (velho || !ultima || agora - ultima >= INTERVALO_MIN * 60000) atualizar().catch(() => {});
  };
  setTimeout(verificar, 5000);
  setInterval(verificar, 60 * 1000);
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/gantt-orgatex', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  if (!estado.dados) {
    return res.status(503).json({
      error: configurado()
        ? estado.ultimoErro
          ? `Ainda não foi possível ler o Orgatex: ${estado.ultimoErro}`
          : 'A ler o Orgatex pela primeira vez. Tente daqui a um minuto.'
        : 'A ligação ao Orgatex ainda não está configurada nesta máquina (ficheiro C:\\LabDataAppSecrets\\.env).',
    });
  }
  res.json({ ...estado.dados, ligacao: { configurado: configurado(), ultimoErro: estado.ultimoErro, intervaloMin: INTERVALO_MIN } });
});
app.post('/api/gantt-orgatex/atualizar', async (req, res) => {
  try {
    const dados = await atualizar();
    res.json({ ok: true, atualizado: dados.atualizado });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

if (require.main === module) {
  iniciarAgendamento();
  app.listen(PORT, HOST, () => {
    console.log(`gantt-producao a correr em http://${HOST}:${PORT}`);
  });
}

module.exports = { montar, atualizar, configurado };
