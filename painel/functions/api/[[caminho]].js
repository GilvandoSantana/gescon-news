// API do painel GesCon News (Cloudflare Pages Functions + D1).
const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const erro = (msg, status = 400) => json({ erro: msg }, status);
const agora = () => new Date().toISOString();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const rand = (n = 32) => hex(crypto.getRandomValues(new Uint8Array(n)));
const iguais = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };

async function hashSenha(senha, salt) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 100000 }, k, 256);
  return hex(bits);
}

function cookie(req, nome) {
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|; )${nome}=([^;]*)`));
  return m ? m[1] : null;
}

async function usuarioLogado(env, req) {
  const t = cookie(req, "news_sessao");
  if (!t) return null;
  const s = await env.DB.prepare("SELECT u.id, u.usuario, u.papel, s.expira_em FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token = ?").bind(t).first();
  if (!s || s.expira_em < agora()) return null;
  return s;
}

async function abrirSessao(env, usuarioId) {
  const token = rand(32);
  const expira = new Date(Date.now() + 30 * 864e5).toISOString();
  await env.DB.prepare("INSERT INTO sessoes (token, usuario_id, expira_em) VALUES (?, ?, ?)").bind(token, usuarioId, expira).run();
  return `news_sessao=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${30 * 86400}`;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const lista = (v, max = 20) => (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean).slice(0, max);

function limparDds(b) {
  return {
    tema: String(b.tema ?? "").trim().slice(0, 300),
    pontos: lista(b.pontos, 10),
    certo: lista(b.certo, 8),
    errado: lista(b.errado, 8),
    pare: { pergunta: String(b.pare?.pergunta ?? "").trim().slice(0, 300), sub: String(b.pare?.sub ?? "").trim().slice(0, 300) },
  };
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const limparEmail = (v) => { const e = String(v ?? "").trim().toLowerCase(); return e === "" ? "" : (EMAIL.test(e) && e.length <= 254 ? e : null); };

const CHAVES = new Set(["aniversariantes", "campanha", "emergencia", "tecnicos"]);

export async function onRequest({ request, env, params }) {
  if (!env.DB) return erro("Banco D1 não configurado (binding DB).", 500);
  const url = new URL(request.url);
  const partes = [].concat(params.caminho || []);
  const rota = partes.join("/");
  const metodo = request.method;
  const corpo = async () => { try { return await request.json(); } catch { return {}; } };

  // Feed para o gerador do vídeo (chave própria, só leitura).
  if (rota === "feed" && metodo === "GET") {
    const t = request.headers.get("x-news-token") || "";
    if (!env.NEWS_TOKEN || !iguais(t, env.NEWS_TOKEN)) return erro("Não autorizado", 401);
    const dds = {};
    for (const r of (await env.DB.prepare("SELECT data, conteudo FROM dds").all()).results) dds[r.data] = JSON.parse(r.conteudo);
    const cfg = {};
    for (const r of (await env.DB.prepare("SELECT chave, valor FROM config").all()).results) cfg[r.chave] = JSON.parse(r.valor);
    const emails = (await env.DB.prepare("SELECT email FROM usuarios WHERE email IS NOT NULL AND email != ''").all()).results.map((r) => r.email);
    return json({ dds, ...cfg, emails });
  }

  if (rota === "estado" && metodo === "GET") {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM usuarios").first();
    const eu = await usuarioLogado(env, request);
    return json({ precisaCriarPrimeiro: n.n === 0, eu: eu ? { usuario: eu.usuario, papel: eu.papel } : null });
  }

  if (rota === "primeiro-acesso" && metodo === "POST") {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM usuarios").first();
    if (n.n > 0) return erro("Já existe usuário. Entre com o seu login.", 403);
    const b = await corpo();
    const usuario = String(b.usuario || "").trim().toLowerCase();
    const senha = String(b.senha || "");
    if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) return erro("Usuário: 3 a 30 letras minúsculas, números, ponto ou traço.");
    if (senha.length < 8) return erro("A senha precisa ter pelo menos 8 caracteres.");
    const salt = rand(16);
    const r = await env.DB.prepare("INSERT INTO usuarios (usuario, senha_hash, senha_salt, papel, criado_em) VALUES (?, ?, ?, 'admin', ?)").bind(usuario, await hashSenha(senha, salt), salt, agora()).run();
    return json({ ok: true }, 200, { "set-cookie": await abrirSessao(env, r.meta.last_row_id) });
  }

  if (rota === "entrar" && metodo === "POST") {
    const b = await corpo();
    const u = await env.DB.prepare("SELECT * FROM usuarios WHERE usuario = ?").bind(String(b.usuario || "").trim().toLowerCase()).first();
    const h = u ? await hashSenha(String(b.senha || ""), u.senha_salt) : "";
    if (!u || !iguais(h, u.senha_hash)) return erro("Usuário ou senha incorretos.", 401);
    return json({ ok: true }, 200, { "set-cookie": await abrirSessao(env, u.id) });
  }

  if (rota === "sair" && metodo === "POST") {
    const t = cookie(request, "news_sessao");
    if (t) await env.DB.prepare("DELETE FROM sessoes WHERE token = ?").bind(t).run();
    return json({ ok: true }, 200, { "set-cookie": "news_sessao=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });
  }

  const eu = await usuarioLogado(env, request);
  if (!eu) return erro("Entre para continuar.", 401);

  if (rota === "meu-email") {
    if (metodo === "GET") return json({ email: (await env.DB.prepare("SELECT email FROM usuarios WHERE id = ?").bind(eu.id).first())?.email || "" });
    if (metodo === "POST") {
      const e = limparEmail((await corpo()).email);
      if (e === null) return erro("E-mail inválido.");
      await env.DB.prepare("UPDATE usuarios SET email = ? WHERE id = ?").bind(e, eu.id).run();
      return json({ ok: true });
    }
  }

  if (rota === "dds" && metodo === "GET") {
    const de = url.searchParams.get("de") || "0000-00-00", ate = url.searchParams.get("ate") || "9999-99-99";
    const rs = await env.DB.prepare("SELECT data, conteudo, atualizado_por, atualizado_em FROM dds WHERE data BETWEEN ? AND ? ORDER BY data").bind(de, ate).all();
    return json(rs.results.map((r) => ({ data: r.data, ...JSON.parse(r.conteudo), atualizadoPor: r.atualizado_por, atualizadoEm: r.atualizado_em })));
  }
  if (partes[0] === "dds" && partes[1] && ISO.test(partes[1])) {
    if (metodo === "PUT") {
      const c = limparDds(await corpo());
      if (!c.tema) return erro("Informe o tema do DDS.");
      await env.DB.prepare("INSERT INTO dds (data, conteudo, atualizado_por, atualizado_em) VALUES (?, ?, ?, ?) ON CONFLICT(data) DO UPDATE SET conteudo = excluded.conteudo, atualizado_por = excluded.atualizado_por, atualizado_em = excluded.atualizado_em").bind(partes[1], JSON.stringify(c), eu.usuario, agora()).run();
      return json({ ok: true });
    }
    if (metodo === "DELETE") { await env.DB.prepare("DELETE FROM dds WHERE data = ?").bind(partes[1]).run(); return json({ ok: true }); }
  }

  if (partes[0] === "config" && CHAVES.has(partes[1])) {
    if (metodo === "GET") {
      const r = await env.DB.prepare("SELECT valor, atualizado_por, atualizado_em FROM config WHERE chave = ?").bind(partes[1]).first();
      return json(r ? { valor: JSON.parse(r.valor), atualizadoPor: r.atualizado_por, atualizadoEm: r.atualizado_em } : { valor: null });
    }
    if (metodo === "PUT") {
      const b = await corpo();
      await env.DB.prepare("INSERT INTO config (chave, valor, atualizado_por, atualizado_em) VALUES (?, ?, ?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_por = excluded.atualizado_por, atualizado_em = excluded.atualizado_em").bind(partes[1], JSON.stringify(b.valor ?? null), eu.usuario, agora()).run();
      return json({ ok: true });
    }
  }

  if (rota === "usuarios") {
    if (eu.papel !== "admin") return erro("Só o administrador gerencia usuários.", 403);
    if (metodo === "GET") return json((await env.DB.prepare("SELECT usuario, papel, email, criado_em FROM usuarios ORDER BY usuario").all()).results);
    if (metodo === "POST") {
      const b = await corpo();
      const usuario = String(b.usuario || "").trim().toLowerCase(), senha = String(b.senha || "");
      if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) return erro("Usuário: 3 a 30 letras minúsculas, números, ponto ou traço.");
      if (senha.length < 8) return erro("A senha precisa ter pelo menos 8 caracteres.");
      const email = limparEmail(b.email);
      if (email === null) return erro("E-mail inválido.");
      const salt = rand(16);
      try {
        await env.DB.prepare("INSERT INTO usuarios (usuario, senha_hash, senha_salt, papel, email, criado_em) VALUES (?, ?, ?, ?, ?, ?)").bind(usuario, await hashSenha(senha, salt), salt, b.papel === "admin" ? "admin" : "editor", email, agora()).run();
      } catch { return erro("Esse usuário já existe."); }
      return json({ ok: true });
    }
  }
  if (partes[0] === "usuarios" && partes[1] && partes[2] === "email" && metodo === "POST") {
    if (eu.papel !== "admin") return erro("Só o administrador gerencia usuários.", 403);
    const e = limparEmail((await corpo()).email);
    if (e === null) return erro("E-mail inválido.");
    await env.DB.prepare("UPDATE usuarios SET email = ? WHERE usuario = ?").bind(e, partes[1]).run();
    return json({ ok: true });
  }
  if (partes[0] === "usuarios" && partes[1] && metodo === "DELETE") {
    if (eu.papel !== "admin") return erro("Só o administrador gerencia usuários.", 403);
    if (partes[1] === eu.usuario) return erro("Você não pode apagar o próprio usuário.");
    const u = await env.DB.prepare("SELECT id FROM usuarios WHERE usuario = ?").bind(partes[1]).first();
    if (u) { await env.DB.prepare("DELETE FROM sessoes WHERE usuario_id = ?").bind(u.id).run(); await env.DB.prepare("DELETE FROM usuarios WHERE id = ?").bind(u.id).run(); }
    return json({ ok: true });
  }

  return erro("Rota não encontrada.", 404);
}
