// Avisa por e-mail (Gmail SMTP) que o vídeo do dia foi postado, ou que algo falhou.
// Uso: node scripts/avisar-email.mjs ok|erro AAAA-MM-DD
// Variáveis: SMTP_USER, SMTP_PASS (senha de app), NEWS_URL, NEWS_TOKEN, RUN_URL
import { readFile } from "node:fs/promises";
import nodemailer from "nodemailer";

const [modo, dia] = process.argv.slice(2);
const { SMTP_USER, SMTP_PASS, NEWS_URL, NEWS_TOKEN, RUN_URL } = process.env;
if (!SMTP_USER || !SMTP_PASS) {
  const falta = [!SMTP_USER && "SMTP_USER (e-mail remetente)", !SMTP_PASS && "SMTP_PASS (senha de app)"].filter(Boolean).join(" e ");
  console.log(`E-mail não configurado: falta ${falta} em Settings > Secrets > Actions; nada enviado.`);
  process.exit(0);
}

const [y, m, d] = (dia || "").split("-");
const data = y ? `${d}/${m}/${y}` : "";
const transporte = nodemailer.createTransport({ service: "gmail", auth: { user: SMTP_USER, pass: SMTP_PASS } });

try {
  if (modo === "ok") {
    let emails = [];
    try {
      const r = await fetch(`${NEWS_URL.replace(/\/$/, "")}/api/feed`, { headers: { "x-news-token": NEWS_TOKEN } });
      if (r.ok) emails = (await r.json()).emails ?? [];
    } catch (e) { console.warn(`Painel indisponível: ${e.message}`); }
    if (!emails.length) emails = [SMTP_USER];
    let link = "", playlist = "";
    try { ({ video: link, playlist } = JSON.parse(await readFile("out/youtube.json", "utf8"))); } catch {}
    await transporte.sendMail({
      from: `GesCon News <${SMTP_USER}>`,
      to: SMTP_USER,
      bcc: emails,
      subject: `Vídeo da TV de ${data} já está no YouTube`,
      text: `O vídeo da TV do contrato Integridade Estrutural para ${data} já foi postado.\n\nVídeo: ${link}\nPlaylist: ${playlist}\n\nGesCon News (aviso automático).`,
    });
    console.log(`Aviso enviado para ${emails.length} pessoa(s).`);
  } else {
    await transporte.sendMail({
      from: `GesCon News <${SMTP_USER}>`,
      to: SMTP_USER,
      subject: `FALHOU: vídeo da TV de ${data}`,
      text: `A geração ou a postagem do vídeo de ${data} falhou.\nVeja o motivo: ${RUN_URL}\n\nGesCon News (aviso automático).`,
    });
    console.log("Aviso de falha enviado.");
  }
} catch (e) { console.error(`Não consegui enviar o e-mail: ${e.message}`); process.exit(0); }
