CREATE INDEX resource_locations_published_viewport_gist
  ON resource_locations USING GIST ((public_geog::geometry))
  WHERE verified_at IS NOT NULL AND published_at IS NOT NULL;

CREATE INDEX intelligence_jobs_expired_lease_idx
  ON intelligence_jobs (lease_until) WHERE status = 'RUNNING';

CREATE INDEX crop_listings_creator_id_idx ON crop_listings (creator_id);
