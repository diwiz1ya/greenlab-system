const DEFAULT_PORT_CANDIDATES = [3011, 3010, 3012];
const PASSWORD = "demo123";

function parseArgs(argv) {
  return {
    baseUrl: process.env.BASE_URL || String(
      argv.find((arg) => arg.startsWith("--base-url="))?.split("=")[1] || ""
    ).trim()
  };
}

async function detectBaseUrl(explicitBaseUrl) {
  if (explicitBaseUrl) {
    const response = await fetch(`${explicitBaseUrl}/healthz`);
    if (!response.ok) {
      throw new Error(`Live smoke failed: ${explicitBaseUrl} returned ${response.status} on /healthz`);
    }
    return explicitBaseUrl;
  }

  for (const port of DEFAULT_PORT_CANDIDATES) {
    const candidate = `http://127.0.0.1:${port}`;
    try {
      const response = await fetch(`${candidate}/healthz`);
      if (response.ok) return candidate;
    } catch {
      // try next candidate
    }
  }

  throw new Error("Live smoke failed: no running server found on 3011, 3010, or 3012.");
}

async function api(baseUrl, pathname, options = {}) {
  const { method = "GET", token = "", body } = options;
  const payloadBody = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(payloadBody !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: payloadBody
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const message = data.error || data.message || response.statusText || "Request failed";
    throw new Error(`${method} ${pathname}: ${response.status} ${message}`);
  }

  return data;
}

async function login(baseUrl, username) {
  const result = await api(baseUrl, "/api/login", {
    method: "POST",
    body: { username, password: PASSWORD }
  });
  if (!result.token) {
    throw new Error(`Login for ${username} did not return token.`);
  }
  return String(result.token);
}

async function resetDemo(baseUrl) {
  const managerToken = await login(baseUrl, "manager");
  await api(baseUrl, "/api/demo/reset", {
    method: "POST",
    token: managerToken,
    body: {}
  });
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = await detectBaseUrl(args.baseUrl);

  const health = await api(baseUrl, "/healthz");
  if (health.ok !== true) {
    throw new Error("Health check returned ok=false.");
  }

  await resetDemo(baseUrl);

  const tokens = {
    manager: await login(baseUrl, "manager"),
    sorting: await login(baseUrl, "sorting"),
    washing: await login(baseUrl, "washing"),
    drying: await login(baseUrl, "drying"),
    qc: await login(baseUrl, "qc"),
    ironing: await login(baseUrl, "ironing"),
    pickup: await login(baseUrl, "pickup")
  };

  const sortingOrders = await api(baseUrl, "/api/orders?station=sorting", { token: tokens.manager });
  const order = sortingOrders.orders?.[0];
  if (!order?.id) {
    throw new Error("No sorting order found after demo reset.");
  }

  const qrCode = "QR:BIN-001";
  const createResult = await api(baseUrl, "/api/sorting/create-baskets", {
    method: "POST",
    token: tokens.sorting,
    body: {
      orderId: Number(order.id),
      baskets: [
        {
          type: "Mixed #1",
          itemCounts: { top: 2, bottom: 1, underwear: 0, socksPairs: 1 },
          qrCode
        }
      ]
    }
  });
  if (createResult.ok !== true) {
    throw new Error("Sorting create-baskets returned ok=false.");
  }

  for (const station of ["washing", "drying", "qc", "ironing", "pickup"]) {
    const result = await api(baseUrl, "/api/scan", {
      method: "POST",
      token: tokens[station],
      body: { station, qrCode }
    });
    if (result.ok !== true) {
      throw new Error(`Scan at ${station} returned ok=false.`);
    }
  }

  const pickupWorkbench = await api(baseUrl, "/api/pickup/workbench", { token: tokens.manager });
  const readyToPlaceOrder = (pickupWorkbench.readyToPlaceOrders || []).find((entry) => entry.id === order.id);
  if (!readyToPlaceOrder) {
    throw new Error("Order did not appear in pickup ready-to-place list.");
  }

  const placementResult = await api(baseUrl, "/api/pickup/place-order", {
    method: "POST",
    token: tokens.manager,
    body: {
      orderId: Number(order.id),
      containerCount: 1,
      placements: [{ binQr: "QR:BIN-049", locationQr: "QR:LOC-A01" }]
    }
  });
  if (placementResult.ok !== true) {
    throw new Error("Pickup placement returned ok=false.");
  }

  const completeResult = await api(baseUrl, "/api/pickup/complete", {
    method: "POST",
    token: tokens.manager,
    body: { orderId: Number(order.id) }
  });
  if (completeResult.ok !== true) {
    throw new Error("Pickup complete returned ok=false.");
  }

  const finalOrder = await api(baseUrl, `/api/orders/${order.id}`, { token: tokens.manager });
  const finalBasketStations = Array.isArray(finalOrder.baskets)
    ? finalOrder.baskets.map((basket) => ({
        basket_code: basket.basket_code,
        station: basket.station,
        status: basket.status
      }))
    : [];
  const activeBasketCount = finalBasketStations.filter((basket) => basket.status !== "archived").length;
  if (finalOrder.cleancloud_status !== "Выдано") {
    throw new Error(`Expected final cleancloud_status Выдано, got ${finalOrder.cleancloud_status}`);
  }
  if (finalOrder.ready_to_place || finalOrder.ready_for_pickup) {
    throw new Error("Pickup flags were not cleared after complete pickup.");
  }
  if (activeBasketCount !== 0) {
    throw new Error(`Expected all baskets to be archived after complete pickup, got ${activeBasketCount} active.`);
  }

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    orderId: order.id,
    publicId: order.public_id,
    finalOrderStatus: finalOrder.status,
    finalCleanCloudStatus: finalOrder.cleancloud_status,
    readyForPickup: finalOrder.ready_for_pickup,
    activeBasketCount,
    basketFlow: finalBasketStations
  }, null, 2));
}

run().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
