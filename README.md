# GesCon News

Vídeo diário da TV do contrato Integridade Estrutural (Support Mining).

- `tv/template.html`: a página da TV (14 slides, 1920x1080).
- `content/conteudo.json`: textos editáveis (DDS por data, aniversariantes, campanha, emergência, regras de ouro).
- `scripts/build-day.mjs`: busca os números no GesCon (`/api/tv/feed`), junta com o conteúdo e grava o vídeo do dia.
- `.github/workflows/video-diario.yml`: roda todo dia às 18h (Fortaleza) e gera o vídeo do dia seguinte. Também pode ser disparado à mão, com a data desejada.

Segredo necessário no repositório: `TV_FEED_TOKEN` (mesmo valor da variável no Railway do GesCon).

Teste local sem o GesCon: `node scripts/build-day.mjs 2026-11-24 --sem-gescon`.
