import { NextResponse } from "next/server";
import { routeError } from "@/lib/api-response";
import { requireUserApi } from "@/lib/auth";
import { configuredStockProviders } from "@/lib/stock/search";
import { STOCK_PROVIDER_ENV } from "@/lib/stock/types";

/**
 * Which stock providers actually have credentials. The channel form uses
 * this to badge a provider as "kulcs hiányzik" instead of letting the user
 * enable something that would silently never return a result.
 */
export async function GET() {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    return NextResponse.json({
      configured: configuredStockProviders(),
      envVars: STOCK_PROVIDER_ENV,
    });
  } catch (err) {
    return routeError(err, "api/stock/status");
  }
}
