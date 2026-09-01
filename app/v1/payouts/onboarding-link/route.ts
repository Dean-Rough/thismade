import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { authenticateRequest, requireScope } from "@/lib/api/auth";
import { apiError, ok } from "@/lib/api/envelope";
import { readIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { getConvexServiceSecret } from "@/lib/api/serviceSecret";
import { createConnectExpressAccount, createConnectOnboardingLink } from "@/lib/stripe/connect";

const ROUTE = "POST /v1/payouts/onboarding-link";

function getConvexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  }
  return new ConvexHttpClient(url);
}

export async function POST(req: Request) {
  const auth = await authenticateRequest(req);
  if (!auth.ok) {
    return apiError("unauthorized", "Missing or invalid API key.");
  }
  if (!requireScope(auth.context, "money")) {
    return apiError("forbidden_scope", "This API key lacks the 'money' scope.");
  }

  const idempotency = readIdempotencyKey(req);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return apiError("internal", "NEXT_PUBLIC_APP_URL is not configured.");
  }

  const rawBody = await req.text();
  const client = getConvexClient();

  return withIdempotency(
    client,
    auth.context.businessId,
    ROUTE,
    idempotency.key,
    rawBody,
    async () => {
      const status = await client.action(api.payoutsActions.getConnectStatus, {
        businessId: auth.context.businessId,
        secret: getConvexServiceSecret(),
      });
      if (!status) {
        return apiError("not_found", "Business not found.");
      }

      // Reuse the existing Connect account if onboarding was already started —
      // creating a second account would orphan the first and desync the flags
      // the account.updated webhook keeps in sync.
      let accountId = status.stripeConnectAccountId;
      if (!accountId) {
        const account = await createConnectExpressAccount();
        accountId = account.id;
        await client.action(api.payoutsActions.setStripeConnectAccountId, {
          businessId: auth.context.businessId,
          stripeConnectAccountId: accountId,
          secret: getConvexServiceSecret(),
        });
      }

      const link = await createConnectOnboardingLink(accountId, {
        refreshUrl: `${appUrl}/dashboard/payouts?refresh=true`,
        returnUrl: `${appUrl}/dashboard/payouts?onboarding=complete`,
      });

      return ok({ url: link.url, expiresAt: link.expiresAt });
    },
  );
}
