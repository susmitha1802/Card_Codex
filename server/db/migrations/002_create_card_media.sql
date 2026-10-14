CREATE TABLE IF NOT EXISTS card_media (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  media_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  card_id BIGINT UNSIGNED NOT NULL,
  storage_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mime_type VARCHAR(50) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  width INT UNSIGNED NOT NULL,
  height INT UNSIGNED NOT NULL,
  sort_order TINYINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_card_media_id (media_id),
  UNIQUE KEY uq_card_media_storage (storage_key),
  UNIQUE KEY uq_card_media_order (card_id, sort_order),
  CONSTRAINT fk_card_media_card FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
