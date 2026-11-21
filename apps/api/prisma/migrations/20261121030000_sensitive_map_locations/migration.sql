ALTER TABLE resource_locations ADD CONSTRAINT resource_locations_sensitive_public_point_check CHECK (
  category NOT IN ('FARMER', 'FOSTER_SUPPORT')
  OR (
    address_label IS NULL
    AND abs(ST_X(public_geog::geometry) - round(ST_X(public_geog::geometry)::numeric, 1)::float8) < 0.0000001
    AND abs(ST_Y(public_geog::geometry) - round(ST_Y(public_geog::geometry)::numeric, 1)::float8) < 0.0000001
  )
);
