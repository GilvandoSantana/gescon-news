// Sobe o vídeo do dia no YouTube (não listado) e coloca numa playlist nova com a data.
// Uso: node scripts/postar-youtube.mjs AAAA-MM-DD
// Variáveis: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN
import { readFile, stat } from "node:fs/promises";

const dia = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(dia ?? "")) { console.error("Informe a data: node scripts/postar-youtube.mjs 2026-11-24"); process.exit(1); }
const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN } = process.env;
if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) { console.error("Faltam YT_CLIENT_ID, YT_CLIENT_SECRET e YT_REFRESH_TOKEN."); process.exit(1); }

const [y, m, d] = dia.split("-");
const SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const semana = SEMANA[new Date(`${dia}T12:00:00Z`).getUTCDay()];
const titulo = `TV Integridade Estrutural · ${d}/${m}/${y}`;
const descricao = `Loop da TV do contrato Integridade Estrutural (Support Mining) para ${semana}, ${d}/${m}/${y}.`;
const arquivo = `out/tv_${dia}.mp4`;

async function token() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: YT_CLIENT_ID, client_secret: YT_CLIENT_SECRET, refresh_token: YT_REFRESH_TOKEN, grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Login no Google falhou: ${JSON.stringify(j)}`);
  return j.access_token;
}
const api = async (at, path, init = {}) => {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, {
    ...init, headers: { authorization: `Bearer ${at}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`YouTube ${path}: ${JSON.stringify(j)}`);
  return j;
};

const at = await token();

// Playlist do dia: reaproveita se já existir (nova execução do mesmo dia não duplica).
const minhas = await api(at, "playlists?part=snippet&mine=true&maxResults=50");
let playlist = minhas.items.find((p) => p.snippet.title === titulo);
if (!playlist) {
  playlist = await api(at, "playlists?part=snippet,status", {
    method: "POST",
    body: JSON.stringify({ snippet: { title: titulo, description: descricao }, status: { privacyStatus: "unlisted" } }),
  });
}
const itens = await api(at, `playlistItems?part=id&playlistId=${playlist.id}&maxResults=1`);
if (itens.items.length > 0) { console.log(`Playlist ${playlist.id} já tem o vídeo de ${dia}. Nada a fazer.`); process.exit(0); }

// Envio do vídeo (resumable).
const { size } = await stat(arquivo);
const ini = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
  method: "POST",
  headers: { authorization: `Bearer ${at}`, "content-type": "application/json; charset=UTF-8", "x-upload-content-type": "video/mp4", "x-upload-content-length": String(size) },
  body: JSON.stringify({
    snippet: { title: titulo, description: descricao, categoryId: "27" },
    status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
  }),
});
if (!ini.ok) throw new Error(`Início do envio falhou: ${ini.status} ${await ini.text()}`);
const up = await fetch(ini.headers.get("location"), { method: "PUT", headers: { "content-type": "video/mp4", "content-length": String(size) }, body: await readFile(arquivo) });
const video = await up.json();
if (!up.ok) throw new Error(`Envio falhou: ${JSON.stringify(video)}`);

await api(at, "playlistItems?part=snippet", {
  method: "POST",
  body: JSON.stringify({ snippet: { playlistId: playlist.id, resourceId: { kind: "youtube#video", videoId: video.id } } }),
});
console.log(`Vídeo https://youtu.be/${video.id}`);
console.log(`Playlist https://www.youtube.com/playlist?list=${playlist.id}`);
