const { parsePositiveInt, parseStation } = require("../http/validation");

function handleCoreRoutes(req, res, url, ctx) {
  const {
    db,
    readJson,
    json,
    requireAuth,
    requireManager,
    requireStationAccess,
    stationLabels,
    getStationCard,
    seedDemoData,
    getRecentScansByStation,
    getScanExportRows,
    scanRowsToCsv,
    nowIso,
    getOverview
  } = ctx;

  if (req.method === "GET" && url.pathname === "/api/stations") {
    const session = requireAuth(req, res);
    if (!session) return true;

    json(res, 200, {
      stations: Object.keys(stationLabels).map((station) => getStationCard(station, session))
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/open-station") {
    const session = requireAuth(req, res);
    if (!session) return true;

    readJson(req)
      .then((body) => {
        const station = parseStation(stationLabels, body.station);
        if (!station) {
          json(res, 400, { error: "Unknown station" });
          return;
        }

        if (!session.allowedStations.includes(station)) {
          json(res, 403, {
            error: "No access to this station",
            station,
            label: stationLabels[station],
            allowedStations: session.allowedStations
          });
          return;
        }

        json(res, 200, {
          ok: true,
          station,
          label: stationLabels[station]
        });
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/demo/reset") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireManager(session, res)) return true;

    seedDemoData({ force: true });
    json(res, 200, {
      ok: true,
      message: "Demo data reset completed.",
      orders: db.prepare("SELECT COUNT(*) AS count FROM orders").get().count,
      scans: db.prepare("SELECT COUNT(*) AS count FROM scan_events").get().count
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/scans/recent") {
    const session = requireAuth(req, res);
    if (!session) return true;

    const station = parseStation(stationLabels, url.searchParams.get("station"));
    const limitRaw = Number(url.searchParams.get("limit") || 8);
    const limit = Number.isInteger(limitRaw) ? Math.max(1, Math.min(limitRaw, 30)) : 8;

    if (!station) {
      json(res, 400, { error: "Unknown station" });
      return true;
    }
    if (!requireStationAccess(session, station, res)) return true;

    json(res, 200, {
      station,
      total: limit,
      rows: getRecentScansByStation(station, limit)
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/export/scans") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireManager(session, res)) return true;

    const format = (url.searchParams.get("format") || "json").toLowerCase();
    const orderIdRaw = url.searchParams.get("orderId");
    const orderId = orderIdRaw ? parsePositiveInt(orderIdRaw) : null;

    if (orderIdRaw && !orderId) {
      json(res, 400, { error: "Invalid orderId" });
      return true;
    }

    const rows = getScanExportRows(orderId);

    if (format === "json") {
      json(res, 200, {
        exportedAt: nowIso(),
        total: rows.length,
        orderId,
        rows
      });
      return true;
    }

    if (format === "csv") {
      const fileName = orderId ? `scan-log-order-${orderId}.csv` : "scan-log-all.csv";
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"${fileName}\"`
      });
      res.end(scanRowsToCsv(rows));
      return true;
    }

    json(res, 400, { error: "Unsupported export format" });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/overview") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireStationAccess(session, "overview", res)) return true;

    json(res, 200, getOverview());
    return true;
  }

  return false;
}

module.exports = {
  handleCoreRoutes
};
