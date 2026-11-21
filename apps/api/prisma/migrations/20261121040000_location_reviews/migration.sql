CREATE TABLE resource_location_reviews (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES resource_locations(id) ON DELETE RESTRICT,
  reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason VARCHAR(1000) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT resource_location_reviews_reason_check CHECK (length(btrim(reason)) >= 10)
);
CREATE INDEX resource_location_reviews_location_id_created_at_idx ON resource_location_reviews(location_id, created_at);
CREATE INDEX resource_location_reviews_reviewer_id_idx ON resource_location_reviews(reviewer_id);
