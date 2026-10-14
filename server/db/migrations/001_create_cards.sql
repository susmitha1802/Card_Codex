-- The foundation only: no card creation or viewing API exists yet.
-- Optional fields allow a future basic card to use just occasion/message/theme.
CREATE TABLE IF NOT EXISTS cards (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  share_token VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  occasion VARCHAR(50) NOT NULL,
  title VARCHAR(200) NULL,
  message TEXT NOT NULL,
  recipient_name VARCHAR(100) NULL,
  theme VARCHAR(50) NOT NULL,
  customization JSON NULL,
  unlock_code_hash VARCHAR(255) NULL,
  unlock_hints JSON NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY cards_share_token_unique (share_token)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
