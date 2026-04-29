function createPostgresUserRepository(queryable) {
  async function findLoginUserByUsername(username) {
    const result = await queryable.query(
      `
        SELECT id, username, password_hash, display_name, role, allowed_stations
        FROM users
        WHERE username = $1
      `,
      [username]
    );
    return result.rows[0] || null;
  }

  async function listPasswordRows() {
    const result = await queryable.query("SELECT id, password, password_hash FROM users");
    return result.rows;
  }

  async function updatePasswordHashAndRedact(userId, redactedPassword, passwordHash) {
    const result = await queryable.query(
      `
        UPDATE users
        SET password = $1, password_hash = $2
        WHERE id = $3
      `,
      [redactedPassword, passwordHash, userId]
    );
    return { changes: result.rowCount };
  }

  async function redactPassword(userId, redactedPassword) {
    const result = await queryable.query(
      "UPDATE users SET password = $1 WHERE id = $2",
      [redactedPassword, userId]
    );
    return { changes: result.rowCount };
  }

  return {
    findLoginUserByUsername,
    listPasswordRows,
    updatePasswordHashAndRedact,
    redactPassword
  };
}

module.exports = {
  createPostgresUserRepository
};
