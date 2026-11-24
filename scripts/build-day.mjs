// Monta o vídeo do dia da TV.
// Uso: node scripts/build-day.mjs AAAA-MM-DD [--sem-gescon]
// Variáveis: GESCON_URL (padrão: o site do GesCon), TV_FEED_TOKEN (chave da rota /api/tv/feed).
import { readFile, writeFile, mkdir, rm, readdir, rename } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const dia = process.argv[2];
const semGescon = process.argv.includes("--sem-gescon");
if (!/^\d{4}-\d{2}-\d{2}$/.test(dia ?? "")) { console.error("Informe a data: node scripts/build-day.mjs 2026-11-24"); process.exit(1); }

const GESCON = process.env.GESCON_URL || "https://gestao-treinamentos-lom.up.railway.app";
const conteudo = JSON.parse(await readFile("content/conteudo.json", "utf8"));

async function buscarFeed() {
  const token = process.env.TV_FEED_TOKEN;
  if (!token) throw new Error("TV_FEED_TOKEN não definido.");
  const r = await fetch(`${GESCON}/api/tv/feed`, { headers: { "x-tv-token": token } });
  if (!r.ok) throw new Error(`GesCon respondeu ${r.status} em /api/tv/feed`);
  return r.json();
}

const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const NOMES_CURTOS = { "bloqueio e etiquetagem": "Bloqueio", "trabalho em altura": "Altura" };
const curto = (n) => NOMES_CURTOS[n.trim().toLowerCase()] ?? n;
const mesNome = (ym) => ["", "janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"][Number(ym.slice(5, 7))];

const dados = { ...conteudo };

// Conteúdo editado no painel (DDS, aniversariantes, campanha, emergência, técnicos). Se o painel não responder, usa o conteudo.json.
if (process.env.NEWS_URL && process.env.NEWS_TOKEN) {
  try {
    const r = await fetch(`${process.env.NEWS_URL.replace(/\/$/, "")}/api/feed`, { headers: { "x-news-token": process.env.NEWS_TOKEN } });
    if (!r.ok) throw new Error(`painel respondeu ${r.status}`);
    const p = await r.json();
    dados.dds = { ...conteudo.dds, ...(p.dds || {}) };
    for (const k of ["aniversariantes", "campanha", "emergencia", "tecnicos", "pare", "metaDias", "ultimoAcidente", "recordeDias", "inicioContrato"]) if (p[k] != null) dados[k] = p[k];
    console.log("Painel: conteúdo mesclado.");
  } catch (e) { console.warn(`Painel indisponível (${e.message}); usando conteudo.json.`); }
}
if (!semGescon) {
  const f = await buscarFeed();
  dados.indicadoresMes = `Indicadores · ${mesNome(f.hoje).replace(/^./, (c) => c.toUpperCase())}`;
  dados.indicadores = [
    { nome: "Treinamentos válidos", valor: f.treinamentos.validos, meta: f.treinamentos.total, sufixo: "" },
    { nome: "Desvios e RQAs no mês", valor: f.rqa.registrosNoMes, meta: f.rqa.metaDoMes, sufixo: "" },
    { nome: "Colaboradores com RQA no mês", valor: f.rqa.colaboradoresQueRegistraram, meta: f.rqa.colaboradoresAtivos, sufixo: "" },
    { nome: "Entregas de EPI no mês", valor: f.epi?.entregasNoMes ?? 0, meta: null, sufixo: "" },
  ];
  dados.graficoA = {
    titulo: "Desvios e RQAs por mês (mês atual em andamento)",
    labels: f.rqa.porMes.map((m) => MESES[Number(m.month.slice(5, 7)) - 1]),
    valores: f.rqa.porMes.map((m) => m.total),
  };
  const tipos = [...f.treinamentos.porTipo.map((t) => ({ n: curto(t.nome), v: t.colaboradores })), { n: "ASO", v: f.treinamentos.aso }]
    .sort((a, b) => b.v - a.v).slice(0, 6);
  dados.graficoB = { titulo: "Colaboradores por treinamento", labels: tipos.map((t) => t.n), valores: tipos.map((t) => t.v) };
}

await mkdir("out", { recursive: true });
await writeFile(`out/dados-${dia}.json`, JSON.stringify(dados, null, 2));

// Grava a página rodando o loop uma vez.
const tmp = `out/tmp-${dia}`;
await rm(tmp, { recursive: true, force: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ["--no-sandbox"] });
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 }, locale: "pt-BR",
  recordVideo: { dir: tmp, size: { width: 1920, height: 1080 } },
});
await ctx.addInitScript((d) => { window.__NEWS_DATA__ = d; }, dados);
const page = await ctx.newPage();
await page.goto(`file://${process.cwd()}/tv/template.html?dia=${dia}`);
await page.waitForTimeout(500);
await page.evaluate("show(0)");
const duracao = await page.evaluate(() => [...document.querySelectorAll(".slide")].reduce((s, e) => s + Number(e.dataset.dur || 0), 0));
console.log(`Loop de ${duracao}s`);
await page.waitForTimeout((duracao + 1) * 1000);
await ctx.close(); await browser.close();

const webm = (await readdir(tmp)).find((f) => f.endsWith(".webm"));
const saida = `out/tv_${dia}.mp4`;
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "1", "-t", String(duracao), "-i", `${tmp}/${webm}`,
  "-c:v", "libx264", "-preset", "medium", "-crf", "27", "-pix_fmt", "yuv420p", "-r", "25", "-movflags", "+faststart", "-an", saida]);
await rm(tmp, { recursive: true, force: true });
console.log(`Pronto: ${saida}`);
