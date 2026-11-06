CREATE TABLE IF NOT EXISTS order_confirmation_rollout (
  order_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  confirmation_policy VARCHAR(24) NOT NULL,
  confirmation_policy_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
AS SELECT id AS order_id,
  CASE WHEN LOWER(TRIM(status))='pagado' THEN 'preapproved' ELSE 'legacy' END AS confirmation_policy,
  UTC_TIMESTAMP() AS confirmation_policy_at
FROM orders;
