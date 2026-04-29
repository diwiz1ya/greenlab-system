function createSqliteUserRepository(db) {
  const findLoginUserByUsernameStmt = db.prepare(`
    SELECT id, username, password_hash, display_name, role, allowed_stations
    FROM users
    WHERE username = ?
  `);
  const listPasswordRowsStmt = db.prepare("SELECT id, password, password_hash FROM users");
  const updateHashAndRedactStmt = db.prepare(`
    UPDATE users
    SET password = ?, password_hash = ?
    WHERE id = ?
  `);
  const redactPasswordStmt = db.prepare("UPDATE users SET password = ? WHERE id = ?");

  function findLoginUserByUsername(username) {
    return findLoginUserByUsernameStmt.get(username);
  }

  function listPasswordRows() {
    return listPasswordRowsStmt.all();
  }

  function updatePasswordHashAndRedact(userId, redactedPassword, passwordHash) {
    return updateHashAndRedactStmt.run(redactedPassword, passwordHash, userId);
  }

  function redactPassword(userId, redactedPassword) {
    return redactPasswordStmt.run(redactedPassword, userId);
  }

  return {
    findLoginUserByUsername,
    listPasswordRows,
    updatePasswordHashAndRedact,
    redactPassword
  };
}

module.exports = {
  createSqliteUserRepository
};
