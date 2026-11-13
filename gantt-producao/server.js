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
const VERSAO_DADOS = 2;
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

// Cor fixa por lote (hash do nº de lote), só para distinguir barras vizinhas — não tem significado.
const PALETA = ['#4C72B0', '#DD8452', '#55A868', '#C44E52', '#8172B2', '#937860', '#DA8BC3', '#8C8C8C', '#CCB974', '#64B5CD', '#2E7D32', '#AD1457'];
function corDoLote(chave) {
  let h = 0;
  for (const c of String(chave)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETA[h % PALETA.length];
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
        SELECT Machine, Dyelot, DyelotRefNo, StartTime, EndTime, Article, ColourDescript, Customer
        FROM Dyelots WITH (NOLOCK)
        WHERE EndTime >= @desde AND StartTime <= @ate
        ORDER BY Machine, StartTime
      `);
    return { maquinas: maquinasR.recordset, lotes: lotesR.recordset };
  } finally {
    if (pool) pool.close().catch(() => {});
  }
}

function montar({ maquinas, lotes }, agora) {
  // todas as máquinas da base (mesmo sem lote agendado agora) + qualquer uma que apareça nos lotes e não esteja lá
  const nomes = new Set(maquinas.map((m) => (m.MachineNo || '').trim()).filter(Boolean));
  for (const l of lotes) if (l.Machine) nomes.add(l.Machine.trim());
  const listaMaquinas = [...nomes].sort((a, b) => ordemMaquina(a) - ordemMaquina(b) || a.localeCompare(b));

  const listaLotes = lotes
    .filter((l) => l.StartTime && l.EndTime)
    .map((l) => {
      const chave = (l.Dyelot || l.DyelotRefNo || '').trim();
      const inicio = new Date(l.StartTime).toISOString();
      const fim = new Date(l.EndTime).toISOString();
      let estadoLote = 'agendado';
      if (new Date(fim) < agora) estadoLote = 'concluido';
      else if (new Date(inicio) <= agora) estadoLote = 'a_decorrer';
      return {
        maquina: (l.Machine || '').trim(),
        lote: chave,
        inicio,
        fim,
        artigo: (l.Article || '').trim() || null,
        cor: (l.ColourDescript || '').trim() || null,
        cliente: (l.Customer || '').trim() || null,
        estado: estadoLote,
        corBarra: corDoLote(chave),
      };
    });
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

iniciarAgendamento();
app.listen(PORT, HOST, () => {
  console.log(`gantt-producao a correr em http://${HOST}:${PORT}`);
});
