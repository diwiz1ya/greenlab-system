function createScanExportService(scanRepository) {
  async function getScanExportRows(orderId) {
    return scanRepository.listExportRows(orderId);
  }

  async function getRecentScansByStation(station, limit) {
    return scanRepository.listRecentByStation(station, limit);
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    if (text.includes(",") || text.includes("\"") || text.includes("\n") || text.includes("\r")) {
      return `"${text.replaceAll("\"", "\"\"")}"`;
    }
    return text;
  }

  function scanRowsToCsv(rows) {
    const columns = [
      "id",
      "order_public_id",
      "customer_name",
      "basket_code",
      "station",
      "actor",
      "result",
      "message",
      "created_at"
    ];

    const lines = [columns.join(",")];
    for (const row of rows) {
      lines.push(columns.map((column) => csvEscape(row[column])).join(","));
    }
    return lines.join("\n");
  }

  return {
    getScanExportRows,
    getRecentScansByStation,
    scanRowsToCsv
  };
}

module.exports = {
  createScanExportService
};
