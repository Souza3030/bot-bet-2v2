import crypto from "node:crypto";
import { config } from "../config";
import { PixKeyType } from "../types";

const MP_API_BASE = "https://api.mercadopago.com";

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.mercadoPago.accessToken}`,
    ...extra,
  };
}

async function mpFetch<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${MP_API_BASE}${path}`, init);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      (body as any)?.message ?? (body as any)?.error ?? `HTTP ${response.status}`;
    throw new Error(`[MercadoPago] ${path} falhou: ${message}`);
  }

  return body as T;
}

// ---------------------------------------------------------------------------
// Cobrança PIX (cash-in) — API de Pagamentos, bem estabelecida e estável.
// Docs: https://www.mercadopago.com.br/developers/pt/docs/checkout-api/payment-methods/pix
// ---------------------------------------------------------------------------

export interface CreatePixPaymentResult {
  paymentId: string;
  status: string;
  qrCode: string; // "copia e cola"
  qrCodeBase64: string; // imagem do QR em base64 (PNG)
  ticketUrl?: string;
  expiresAt: string;
}

/**
 * Cria uma cobrança PIX no Mercado Pago para o valor da aposta.
 * `externalReference` deve ser o betId, para conseguirmos correlacionar a
 * notificação do webhook com a aposta correta.
 */
export async function createPixPayment(
  amount: number,
  externalReference: string,
  payerEmail: string,
  description: string
): Promise<CreatePixPaymentResult> {
  const expirationDate = new Date(Date.now() + config.bet.paymentExpirationMs).toISOString();

  const body = {
    transaction_amount: amount,
    description,
    payment_method_id: "pix",
    external_reference: externalReference,
    date_of_expiration: expirationDate,
    notification_url: `${config.mercadoPago.webhookPublicUrl}${config.mercadoPago.webhookPath}`,
    payer: { email: payerEmail },
  };

  const data = await mpFetch<any>("/v1/payments", {
    method: "POST",
    headers: authHeaders({ "X-Idempotency-Key": crypto.randomUUID() }),
    body: JSON.stringify(body),
  });

  const txData = data.point_of_interaction?.transaction_data;

  if (!txData?.qr_code) {
    throw new Error("[MercadoPago] Resposta sem QR Code PIX (verifique se o PIX está habilitado na conta).");
  }

  return {
    paymentId: String(data.id),
    status: data.status,
    qrCode: txData.qr_code,
    qrCodeBase64: txData.qr_code_base64,
    ticketUrl: txData.ticket_url,
    expiresAt: expirationDate,
  };
}

export async function getPayment(paymentId: string): Promise<any> {
  return mpFetch<any>(`/v1/payments/${paymentId}`, {
    method: "GET",
    headers: authHeaders(),
  });
}

/**
 * Cancela uma cobrança PIX que ainda está pendente (não paga).
 * A API do Mercado Pago só aceita essa transição enquanto o pagamento está
 * com status "pending" — se o jogador já pagou entre o clique em "Sair da
 * fila" e esta chamada, o Mercado Pago recusa a mudança de status (o
 * pagamento segue "approved" normalmente) e o webhook trata o resto.
 * Por isso quem chama esta função deve tratá-la como best-effort.
 */
export async function cancelPayment(paymentId: string): Promise<void> {
  await mpFetch(`/v1/payments/${paymentId}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ status: "cancelled" }),
  });
}

/**
 * Reembolsa (total) um pagamento PIX já aprovado.
 * Docs: https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api-payments/create-refund/post
 */
export async function refundPayment(paymentId: string): Promise<void> {
  await mpFetch(`/v1/payments/${paymentId}/refunds`, {
    method: "POST",
    headers: authHeaders({ "X-Idempotency-Key": crypto.randomUUID() }),
    body: JSON.stringify({}),
  });
}

// ---------------------------------------------------------------------------
// Payout PIX (cash-out) — envia dinheiro da conta do bot para a chave PIX
// do vencedor.
//
// ⚠️ IMPORTANTE: este endpoint (`/v1/transaction-intents/process`) faz parte
// da API de "Payouts" do Mercado Pago e, na maioria das contas, PRECISA de
// aprovação comercial prévia da Mercado Pago para funcionar (não é algo
// habilitado por padrão para qualquer Access Token). Em produção, o header
// `X-signature` deve ser uma assinatura criptográfica do corpo da requisição
// gerada com as chaves pública/privada cadastradas junto à Mercado Pago —
// isso normalmente é configurado durante o processo de aprovação comercial.
//
// Se sua conta ainda não tem esse recurso liberado, esta chamada vai falhar
// com 401/403 — é exatamente por isso que o fluxo de aprovação de resultado
// (staffDecisionButtons.ts) trata esse erro com um fallback manual para a
// Staff, em vez de travar o pagamento do vencedor.
// Docs: https://www.mercadopago.com.br/developers/pt/reference/online-payments/payouts/pix-transaction/post
// ---------------------------------------------------------------------------

export interface PayoutPixParams {
  amount: number;
  pixKey: string;
  pixKeyType: PixKeyType;
  ownerDocument: string;
  externalReference: string;
}

export interface PayoutPixResult {
  transactionId: string;
  status: string;
}

/**
 * Assina o corpo da requisição de payout, se as credenciais de assinatura
 * estiverem configuradas. Retorna `undefined` se não configuradas — nesse
 * caso a chamada é feita com `X-enforce-signature: false` (apenas funciona
 * em ambiente de teste/sandbox).
 */
function signPayoutBody(rawBody: string): string | undefined {
  const secret = process.env.MERCADOPAGO_PAYOUT_SIGNING_SECRET;
  if (!secret) return undefined;
  // A Mercado Pago define o esquema exato de assinatura (baseado nas chaves
  // pública/privada emitidas durante a aprovação comercial de Payouts) no
  // momento em que libera o recurso para sua conta. Ajuste esta função
  // conforme a documentação específica enviada pelo seu gerente de contas.
  return crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
}

export async function payoutPix(params: PayoutPixParams): Promise<PayoutPixResult> {
  const body = {
    external_reference: params.externalReference,
    point_of_interaction: { type: "PSP_TRANSFER" },
    seller_configuration: {
      notification_info: {
        notification_url: `${config.mercadoPago.webhookPublicUrl}${config.mercadoPago.webhookPath}`,
      },
    },
    transaction: {
      from: { accounts: [{ amount: params.amount }] },
      to: {
        accounts: [
          {
            type: "current",
            amount: params.amount,
            chave: { type: params.pixKeyType, value: params.pixKey },
            owner: {
              identification: {
                type: params.pixKeyType === "CNPJ" ? "CNPJ" : "CPF",
                number: params.ownerDocument,
              },
            },
          },
        ],
      },
      total_amount: params.amount,
    },
  };

  const rawBody = JSON.stringify(body);
  const signature = signPayoutBody(rawBody);

  const data = await mpFetch<any>("/v1/transaction-intents/process", {
    method: "POST",
    headers: authHeaders({
      "X-Idempotency-Key": params.externalReference,
      "X-signature": signature ?? "true",
      "X-enforce-signature": signature ? "true" : "false",
    }),
    body: rawBody,
  });

  return { transactionId: data.id, status: data.status };
}

// ---------------------------------------------------------------------------
// Validação de assinatura de webhook
// Docs: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
// ---------------------------------------------------------------------------

/**
 * Valida o header `x-signature` enviado pelo Mercado Pago nas notificações
 * de webhook, usando o secret configurado no painel de desenvolvedores.
 */
export function isValidWebhookSignature(
  xSignatureHeader: string | undefined,
  xRequestId: string | undefined,
  dataId: string | undefined
): boolean {
  if (!xSignatureHeader || !xRequestId || !dataId) return false;

  const parts = Object.fromEntries(
    xSignatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key?.trim(), value?.trim()];
    })
  );

  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestId};ts:${ts};`;
  const expected = crypto
    .createHmac("sha256", config.mercadoPago.webhookSecret)
    .update(manifest)
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}
