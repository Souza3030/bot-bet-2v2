import express, { Request, Response } from "express";
import { config } from "../config";
import { isValidWebhookSignature, getPayment } from "./mercadoPago";

export type PaymentNotificationHandler = (paymentId: string, status: string) => void;

/**
 * Sobe um pequeno servidor HTTP para receber as notificações (IPN) do
 * Mercado Pago sempre que o status de um pagamento muda (ex: PIX pago).
 *
 * IMPORTANTE: `config.mercadoPago.webhookPublicUrl` precisa ser uma URL
 * PÚBLICA e alcançável pela internet (seu domínio com HTTPS, ou um túnel
 * como ngrok/cloudflared em desenvolvimento). O Mercado Pago não consegue
 * notificar `localhost`.
 */
export function startWebhookServer(onPaymentNotification: PaymentNotificationHandler): void {
  const app = express();
  app.use(express.json());

  app.post(config.mercadoPago.webhookPath, async (req: Request, res: Response) => {
    // Responde 200 rapidamente sempre que possível — o Mercado Pago
    // reenvia notificações que não recebem 2xx, então erros de negócio
    // (pagamento não encontrado, etc.) são apenas logados, não retornam erro.
    try {
      const dataId =
        (req.query["data.id"] as string | undefined) ?? req.body?.data?.id?.toString();
      const type = (req.query.type as string | undefined) ?? req.body?.type;

      const xSignature = req.header("x-signature");
      const xRequestId = req.header("x-request-id");

      if (!isValidWebhookSignature(xSignature, xRequestId, dataId)) {
        console.warn("[Webhook] Assinatura inválida, ignorando notificação.");
        res.sendStatus(401);
        return;
      }

      res.sendStatus(200);

      if (type !== "payment" || !dataId) {
        return; // Notificação de outro tipo (ex: payout) — não tratada aqui.
      }

      const payment = await getPayment(dataId);
      onPaymentNotification(dataId, payment.status);
    } catch (error) {
      console.error("[Webhook] Erro ao processar notificação do Mercado Pago:", error);
      if (!res.headersSent) res.sendStatus(500);
    }
  });

  app.get("/health", (_req, res) => res.send("ok"));

  app.listen(config.mercadoPago.webhookPort, () => {
    console.log(
      `[Webhook] Servidor do Mercado Pago escutando na porta ${config.mercadoPago.webhookPort} ` +
        `(esperado publicamente em ${config.mercadoPago.webhookPublicUrl}${config.mercadoPago.webhookPath})`
    );
  });
}
