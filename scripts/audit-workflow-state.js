const path = require("node:path");
const { openSqliteDatabase } = require("../backend/db/sqlite");

const DEFAULT_DB_PATH = path.join(__dirname, "..", "data", "greenlab-demo.sqlite");

function parseArgs(argv) {
  const result = {
    dbPath: process.env.GREENLAB_DB_PATH
      ? path.resolve(process.cwd(), process.env.GREENLAB_DB_PATH)
      : DEFAULT_DB_PATH,
    json: false,
    failOnIssues: false
  };

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [rawKey, rawValue = ""] = arg.slice(2).split("=");
    const key = String(rawKey || "").trim();
    const value = String(rawValue || "").trim();
    if (!key) continue;

    if (key === "db" && value) result.dbPath = path.resolve(process.cwd(), value);
    if (key === "json") result.json = true;
    if (key === "fail-on-issues") result.failOnIssues = true;
  }

  return result;
}

function loadOrders(db) {
  return db.prepare(`
    SELECT id, public_id, status, ready_to_place, ready_for_pickup
    FROM orders
    ORDER BY id ASC
  `).all();
}

function loadActiveBaskets(db) {
  return db.prepare(`
    SELECT
      b.id,
      b.order_id,
      b.basket_code,
      b.qr_code,
      b.station,
      b.status,
      o.public_id
    FROM baskets b
    JOIN orders o ON o.id = b.order_id
    WHERE b.status != 'archived'
    ORDER BY b.order_id ASC, b.id ASC
  `).all();
}

function loadActivePlacements(db) {
  return db.prepare(`
    SELECT
      p.id,
      p.order_id,
      p.slot_index,
      p.bin_qr_code,
      p.location_qr_code,
      o.public_id
    FROM pickup_order_placements p
    JOIN orders o ON o.id = p.order_id
    WHERE p.released_at IS NULL
    ORDER BY p.order_id ASC, p.slot_index ASC, p.id ASC
  `).all();
}

function loadPickupScanRows(db) {
  return db.prepare(`
    SELECT order_id, basket_id
    FROM scan_events
    WHERE station = 'pickup'
      AND result = 'ok'
      AND basket_id IS NOT NULL
    ORDER BY order_id ASC, basket_id ASC
  `).all();
}

function summarizeIssues(issues) {
  const byCode = new Map();
  for (const issue of issues) {
    byCode.set(issue.code, (byCode.get(issue.code) || 0) + 1);
  }
  return Array.from(byCode.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, count]) => ({ code, count }));
}

function runAudit(db) {
  const orders = loadOrders(db);
  const activeBaskets = loadActiveBaskets(db);
  const activePlacements = loadActivePlacements(db);
  const pickupScanRows = loadPickupScanRows(db);

  const issues = [];
  const orderById = new Map(orders.map((order) => [Number(order.id), order]));
  const basketsByOrderId = new Map();
  const placementsByOrderId = new Map();
  const pickupScansByOrderId = new Map();

  function addIssue(code, detail) {
    issues.push({ code, ...detail });
  }

  for (const basket of activeBaskets) {
    const orderId = Number(basket.order_id);
    if (!basketsByOrderId.has(orderId)) basketsByOrderId.set(orderId, []);
    basketsByOrderId.get(orderId).push(basket);
    if (basket.station !== basket.status) {
      addIssue("basket_status_station_mismatch", {
        orderId,
        publicId: basket.public_id,
        basketCode: basket.basket_code,
        detail: `${basket.basket_code}: ${basket.station} != ${basket.status}`
      });
    }
  }

  for (const placement of activePlacements) {
    const orderId = Number(placement.order_id);
    if (!placementsByOrderId.has(orderId)) placementsByOrderId.set(orderId, []);
    placementsByOrderId.get(orderId).push(placement);
  }

  for (const row of pickupScanRows) {
    const orderId = Number(row.order_id);
    if (!pickupScansByOrderId.has(orderId)) pickupScansByOrderId.set(orderId, new Set());
    pickupScansByOrderId.get(orderId).add(Number(row.basket_id));
  }

  const globalBinOwners = new Map();
  const globalLocationOwners = new Map();
  for (const placement of activePlacements) {
    const orderId = Number(placement.order_id);
    const publicId = String(placement.public_id || "");
    const binKey = String(placement.bin_qr_code || "").trim().toUpperCase();
    const locationKey = String(placement.location_qr_code || "").trim().toUpperCase();
    if (binKey) {
      if (globalBinOwners.has(binKey) && globalBinOwners.get(binKey) !== publicId) {
        addIssue("pickup_bin_reused_globally", {
          orderId,
          publicId,
          detail: `${binKey} already assigned to ${globalBinOwners.get(binKey)}`
        });
      } else {
        globalBinOwners.set(binKey, publicId);
      }
    }
    if (locationKey) {
      if (globalLocationOwners.has(locationKey) && globalLocationOwners.get(locationKey) !== publicId) {
        addIssue("pickup_location_reused_globally", {
          orderId,
          publicId,
          detail: `${locationKey} already assigned to ${globalLocationOwners.get(locationKey)}`
        });
      } else {
        globalLocationOwners.set(locationKey, publicId);
      }
    }
  }

  for (const order of orders) {
    const orderId = Number(order.id);
    const publicId = String(order.public_id || "");
    const readyToPlace = Boolean(order.ready_to_place);
    const readyForPickup = Boolean(order.ready_for_pickup);
    const baskets = basketsByOrderId.get(orderId) || [];
    const placements = placementsByOrderId.get(orderId) || [];
    const pickupScanSet = pickupScansByOrderId.get(orderId) || new Set();
    const basketsOutsidePickup = baskets.filter((basket) => basket.station !== "pickup" || basket.status !== "pickup");
    const hasPickupSignals = readyToPlace || readyForPickup || placements.length > 0;

    if ((readyToPlace || readyForPickup) && baskets.length === 0) {
      addIssue("pickup_flags_without_active_baskets", {
        orderId,
        publicId,
        detail: `status=${order.status}, ready_to_place=${Number(readyToPlace)}, ready_for_pickup=${Number(readyForPickup)}`
      });
    }

    if (hasPickupSignals && order.status !== "pickup") {
      addIssue("pickup_signals_outside_pickup_status", {
        orderId,
        publicId,
        detail: `status=${order.status}, ready_to_place=${Number(readyToPlace)}, ready_for_pickup=${Number(readyForPickup)}, placements=${placements.length}`
      });
    }

    if ((readyToPlace || readyForPickup) && basketsOutsidePickup.length) {
      addIssue("pickup_flags_with_baskets_outside_pickup", {
        orderId,
        publicId,
        detail: basketsOutsidePickup.map((basket) => `${basket.basket_code}:${basket.station}/${basket.status}`).join(", ")
      });
    }

    if (placements.length > 2) {
      addIssue("pickup_too_many_active_placements", {
        orderId,
        publicId,
        detail: `placements=${placements.length}`
      });
    }

    const slotKeys = new Set();
    const binKeys = new Set();
    const locationKeys = new Set();
    for (const placement of placements) {
      const slotKey = Number(placement.slot_index || 0);
      const binKey = String(placement.bin_qr_code || "").trim().toUpperCase();
      const locationKey = String(placement.location_qr_code || "").trim().toUpperCase();

      if (slotKeys.has(slotKey)) {
        addIssue("pickup_duplicate_slot_per_order", {
          orderId,
          publicId,
          detail: `slot=${slotKey}`
        });
      } else {
        slotKeys.add(slotKey);
      }

      if (binKey && binKeys.has(binKey)) {
        addIssue("pickup_duplicate_bin_per_order", {
          orderId,
          publicId,
          detail: `bin=${binKey}`
        });
      } else if (binKey) {
        binKeys.add(binKey);
      }

      if (locationKey && locationKeys.has(locationKey)) {
        addIssue("pickup_duplicate_location_per_order", {
          orderId,
          publicId,
          detail: `location=${locationKey}`
        });
      } else if (locationKey) {
        locationKeys.add(locationKey);
      }
    }

    if (readyToPlace && placements.length > 0) {
      addIssue("pickup_ready_to_place_with_active_placement", {
        orderId,
        publicId,
        detail: `placements=${placements.length}`
      });
    }

    if (readyForPickup && placements.length === 0) {
      addIssue("pickup_ready_for_pickup_without_placement", {
        orderId,
        publicId,
        detail: "ready_for_pickup=1 but no active placement"
      });
    }

    if (readyForPickup && baskets.length > 0 && pickupScanSet.size < baskets.length) {
      addIssue("pickup_ready_for_pickup_before_full_scan", {
        orderId,
        publicId,
        detail: `scanned=${pickupScanSet.size}/${baskets.length}`
      });
    }

    if (order.status === "pickup" && !readyToPlace && !readyForPickup && baskets.length > 0 && pickupScanSet.size > 0 && placements.length > 0) {
      addIssue("pickup_has_scan_and_placement_but_flags_cleared", {
        orderId,
        publicId,
        detail: `scanned=${pickupScanSet.size}/${baskets.length}, placements=${placements.length}`
      });
    }
  }

  return {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    totals: {
      orders: orders.length,
      activeBaskets: activeBaskets.length,
      activePlacements: activePlacements.length,
      issues: issues.length
    },
    summary: summarizeIssues(issues),
    issues
  };
}

function printHumanReport(report, dbPath) {
  console.log(`Workflow audit: ${report.ok ? "OK" : "ISSUES FOUND"}`);
  console.log(`DB: ${dbPath}`);
  console.log(`Checked orders: ${report.totals.orders}`);
  console.log(`Active baskets: ${report.totals.activeBaskets}`);
  console.log(`Active placements: ${report.totals.activePlacements}`);
  console.log(`Issues: ${report.totals.issues}`);

  if (!report.issues.length) {
    return;
  }

  console.log("");
  console.log("Summary by code:");
  for (const item of report.summary) {
    console.log(`- ${item.code}: ${item.count}`);
  }

  console.log("");
  console.log("Details:");
  for (const issue of report.issues) {
    const orderLabel = issue.publicId ? `${issue.publicId}` : `order:${issue.orderId}`;
    const basketSuffix = issue.basketCode ? ` / ${issue.basketCode}` : "";
    console.log(`- [${issue.code}] ${orderLabel}${basketSuffix} -> ${issue.detail}`);
  }
}

function run() {
  const config = parseArgs(process.argv.slice(2));
  const db = openSqliteDatabase({
    dbPath: config.dbPath,
    readOnly: true,
    applySchema: false
  });

  try {
    const report = runAudit(db);
    if (config.json) {
      console.log(JSON.stringify({
        dbPath: config.dbPath,
        ...report
      }, null, 2));
    } else {
      printHumanReport(report, config.dbPath);
    }

    if (config.failOnIssues && !report.ok) {
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

run();
