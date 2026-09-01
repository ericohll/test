async function logAction(conn, { user_id, action_type, target_ref, detail }) {
  await conn.execute(
    'INSERT INTO user_actions (user_id, action_type, target_ref, detail) VALUES (?, ?, ?, ?)',
    [user_id, action_type, target_ref, JSON.stringify(detail || {})]
  );
}

module.exports = { logAction };
