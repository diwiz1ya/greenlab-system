function getLastInsertRowId(result, label = "row") {
  const rowId = Number(result?.lastInsertRowid || 0);
  if (!Number.isInteger(rowId) || rowId <= 0) {
    throw new Error(`Failed to read inserted ${label} id.`);
  }
  return rowId;
}

module.exports = {
  getLastInsertRowId
};
