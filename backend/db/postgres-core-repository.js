function createPostgresCoreRepository(queryable) {
  async function getDemoResetCounts() {
    const ordersResult = await queryable.query("SELECT COUNT(*)::int AS count FROM orders");
    const scansResult = await queryable.query("SELECT COUNT(*)::int AS count FROM scan_events");
    return {
      orders: ordersResult.rows[0]?.count || 0,
      scans: scansResult.rows[0]?.count || 0
    };
  }

  return {
    getDemoResetCounts
  };
}

module.exports = {
  createPostgresCoreRepository
};
