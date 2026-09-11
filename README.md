# MamoBall Duo Bet Bot (2v2 — dinheiro real via PIX)

Bot de fila **apostada** Duo (2v2): em vez de pontos/patente, cada jogador
aposta dinheiro real via PIX (Mercado Pago), jogando em dupla fixa com um
parceiro convidado. Quem vencer divide o pote.

## ⚠️ Antes de colocar no ar

Os mesmos avisos do bot Solo se aplicam aqui:

- **Legal**: apostas em dinheiro real caem na Lei 14.790/2023 (Lei das
  Apostas de Quota Fixa), fiscalizada pela SPA. Fale com um advogado antes
  de rodar isso valendo.
- **Payout automático**: a API de Payout PIX do Mercado Pago normalmente
  precisa de aprovação comercial prévia. Se não estiver disponível, cada
  pagamento cai automaticamente no fluxo manual (aviso pra Staff com botão
  "Marcar como pago manualmente").

## Como funciona

1. `/apostar-dupla parceiro:@alguém valor:<R$>` — o valor é **por
   jogador** (ex: R$10 = cada um paga R$10, pote total R$40 na partida).
2. O parceiro convidado clica em **Aceitar**/**Recusar** (convite expira
   em 2 minutos por padrão). Ao aceitar, os dois ganham um botão **"Pagar
   minha aposta"**.
3. Cada um dos 2 clica no botão e preenche sua **chave PIX + tipo + CPF/CNPJ
   do titular** (pra receber se vencer) — o bot gera a cobrança PIX
   individual de cada um.
4. A dupla só entra na fila (Firestore, `duoBetQueue`) quando **os dois**
   tiverem pago. Só é pareada com outra dupla que apostou o **mesmo valor
   por jogador**.
5. Ao parear, os 4 jogadores confirmam presença (check-in, 60s). Se uma
   dupla não confirmar 100% (mesmo que só 1 dos 2 falhe), a dupla inteira é
   **reembolsada** — não dá pra jogar 2v2 faltando gente. A dupla que
   confirmou 100% volta pra fila aguardando novo adversário.
6. Com as 2 duplas confirmadas, a partida é criada normalmente (canais +
   registro de resultado + aprovação da Staff).
7. A Staff **aprova** → o pote (as 4 apostas, menos taxa da casa se
   configurada) é **dividido igualmente entre os 2 vencedores** e pago via
   PIX automático pra cada um. A Staff **anula** → as 2 duplas são
   reembolsadas por completo.

## Infraestrutura de webhook

Igual ao bot Solo: este bot sobe um servidor HTTP (Express) pra receber as
notificações de pagamento do Mercado Pago, então precisa de uma **URL
pública** (domínio com HTTPS em produção, ou um túnel ngrok/cloudflared em
desenvolvimento) configurada em `MERCADOPAGO_WEBHOOK_PUBLIC_URL`.

## Configuração

1. Copie `.env.example` para `.env` e preencha (credenciais do Discord,
   `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`,
   `MERCADOPAGO_WEBHOOK_PUBLIC_URL`, etc).
2. Copie `serviceAccountKey.example.json` para `serviceAccountKey.json`
   com as credenciais reais do Firebase.
3. `npm install`, depois `npm run deploy-commands` e `npm run dev`.

## Dados de auditoria

Cada perna individual da aposta fica registrada na coleção `duoBetLegs`
do Firestore (`teamId` liga as 2 pernas de uma mesma dupla), com status
completo: `aguardando_pagamento` → `paga_aguardando_parceiro` → `na_fila`
→ `pareada` → `em_partida` → `paga_vencedor`/`perdida`/`reembolsada`/
`pagamento_manual_pendente`.

## Família de bots apostados

- `mamoball-solo-bet-bot` — Solo (1v1), sem convite (fila individual)
- `mamoball-duo-bet-bot` — Duo (2v2), convite de 1 parceiro (este)
- Próximos passos: trio (3v3) e squad (4v4) apostados, seguindo o mesmo
  padrão de convite + pagamento individual por perna + divisão do pote
  entre os vencedores.
