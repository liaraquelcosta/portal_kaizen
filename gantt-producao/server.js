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
const VERSAO_DADOS = 6;
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
  [/\bpret[oa]\b|preto|black/, '#2b2b2b'],
  [/branc[oa]|white/, '#f4f4f1'],
  [/cinz[ae]nt[oa]?|cinza|grey|gray/, '#8e8e93'],
  [/prat[ae]ad[oa]|prata|silver/, '#b9bfc7'],
  [/dourad[oa]|ouro|\bgold\b/, '#c9a227'],
  [/bege|beige/, '#d9c6a5'],
  [/castanh[oa]|marrom|camel|tabaco|brown/, '#7b4a2d'],
  [/bordeaux|bordo|vinho|grená|maroon/, '#6e1423'],
  [/vermelh[oa]|\bred\b/, '#c62828'],
  [/rosa|pink|fúchsia|fuchsia/, '#e685b5'],
  [/laranja|coral|orange/, '#e8792b'],
  [/amarel[oa]|yellow/, '#e3c23c'],
  [/lima|lima[ãa]o|\blime\b/, '#9acd32'],
  [/verde|\bgreen\b/, '#4c9a52'],
  [/marinho|navy/, '#1b2a52'],
  [/turquesa|ciano|cian|turquoise/, '#1aa6a0'],
  [/celeste|bleu ciel|ciel|sky/, '#6fb7d6'],
  [/azul|\bblue\b/, '#3b6fb0'],
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
// Paleta neutra só para quando a descrição não dá para reconhecer nenhuma cor (ex. só um código Pantone/TCX).
const PALETA_SEM_COR = ['#8C8C8C', '#6b7280', '#9aa0a6', '#78716c'];
function corDoLote(descricao, chaveFallback) {
  const t = semAcentos(descricao);
  for (const [re, hex] of CORES_NOMEADAS) {
    if (re.test(t)) return ajustarClaroEscuro(hex, t);
  }
  let h = 0;
  for (const c of String(chaveFallback)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETA_SEM_COR[h % PALETA_SEM_COR.length];
}
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
    const lotesR = await pool
      .request()
      .input('desde', sql.DateTime, desde)
      .input('ate', sql.DateTime, ate)
      .query(`
        SELECT Machine, Dyelot, DyelotRefNo, StartTime, EndTime, Article, ColourDescript, Customer,
               State, SetTime, QueueTime
        FROM Dyelots WITH (NOLOCK)
        WHERE (EndTime >= @desde OR EndTime IS NULL)
          AND (StartTime <= @ate OR StartTime IS NULL)
          AND (StartTime IS NOT NULL OR QueueTime >= @desde)
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
  for (const l of validos) {
    const maquina = (l.Machine || '').trim();
    if (l.StartTime) {
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
    const corBarra = corDoLote(corDescricao, chave);
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
      // State 30 (a decorrer): ainda não tem hora de fim no Orgatex — estima-se pela duração prevista.
      fimMs = inicioMs + duracaoEstimadaS(maquina, l.SetTime) * 1000;
      estimadoFim = true;
    }
    adicionar(l, inicioMs, fimMs, false, estimadoFim);
  }

  for (const [maquina, lista] of emFilaPorMaquina) {
    lista.sort((a, b) => (a.QueueTime || '').localeCompare(b.QueueTime || '') || String(a.Dyelot).localeCompare(String(b.Dyelot)));
    let cursor = Math.max(agora.getTime(), fimConhecidoPorMaquina.get(maquina) || agora.getTime());
    for (const l of lista) {
      const duracaoMs = duracaoEstimadaS(maquina, l.SetTime) * 1000;
      adicionar(l, cursor, cursor + duracaoMs, true, true);
      cursor += duracaoMs;
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
