CREATE TYPE "ListingMode" AS ENUM ('DONATION','FREE','SALE');
CREATE TYPE "QuantityUnit" AS ENUM ('KG','LB','BOX');
CREATE TYPE "MarketplaceRequestStatus" AS ENUM ('PENDING','ACCEPTED','REJECTED','CANCELLED','FULFILLED');
CREATE TYPE "IssueCategory" AS ENUM ('DISEASE','PEST','SOIL','NUTRIENT','IRRIGATION','WEATHER','CROP_FAILURE');
CREATE TYPE "CollaborationStatus" AS ENUM ('PENDING','ACCEPTED','REJECTED');
ALTER TABLE organizations ADD COLUMN verified_at TIMESTAMPTZ(6);

CREATE TABLE marketplace_profiles (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id),
 location_id UUID REFERENCES resource_locations(id), accepted_crops TEXT[] NOT NULL DEFAULT '{}',
 demand VARCHAR(1000), quantity_limit DECIMAL(12,2), storage_capacity DECIMAL(12,2),
 service_radius_km INTEGER, pickup BOOLEAN NOT NULL DEFAULT true, delivery BOOLEAN NOT NULL DEFAULT false,
 hours JSONB, updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
 CONSTRAINT marketplace_profile_limits CHECK ((quantity_limit IS NULL OR quantity_limit > 0) AND (storage_capacity IS NULL OR storage_capacity >= 0) AND (service_radius_km IS NULL OR service_radius_km BETWEEN 1 AND 500))
);
CREATE TABLE crop_listings (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id),
 creator_id UUID NOT NULL REFERENCES users(id), location_id UUID NOT NULL REFERENCES resource_locations(id),
 crop_name VARCHAR(120) NOT NULL, variety VARCHAR(120), quantity DECIMAL(12,2) NOT NULL,
 reserved_quantity DECIMAL(12,2) NOT NULL DEFAULT 0, unit "QuantityUnit" NOT NULL,
 harvest_date DATE NOT NULL, quality VARCHAR(500) NOT NULL, storage_conditions VARCHAR(500) NOT NULL,
 shelf_life_days INTEGER NOT NULL, image_keys TEXT[] NOT NULL DEFAULT '{}',
 pickup_availability VARCHAR(500) NOT NULL, mode "ListingMode" NOT NULL, price DECIMAL(12,2),
 expires_at TIMESTAMPTZ(6) NOT NULL, deleted_at TIMESTAMPTZ(6),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
 CONSTRAINT listing_quantity CHECK (quantity > 0 AND reserved_quantity >= 0 AND reserved_quantity <= quantity),
 CONSTRAINT listing_price CHECK ((mode = 'SALE' AND price > 0) OR (mode <> 'SALE' AND price IS NULL)),
 CONSTRAINT listing_shelf_life CHECK (shelf_life_days > 0)
);
CREATE INDEX crop_listings_crop_name_expires_at_idx ON crop_listings(crop_name,expires_at);
CREATE INDEX crop_listings_organization_id_deleted_at_idx ON crop_listings(organization_id,deleted_at);
CREATE TABLE marketplace_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), listing_id UUID NOT NULL REFERENCES crop_listings(id),
 organization_id UUID NOT NULL REFERENCES organizations(id), requester_id UUID NOT NULL REFERENCES users(id),
 quantity DECIMAL(12,2) NOT NULL CHECK (quantity > 0),
 status "MarketplaceRequestStatus" NOT NULL DEFAULT 'PENDING', pickup_at TIMESTAMPTZ(6),
 fulfilled_at TIMESTAMPTZ(6), created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX marketplace_requests_listing_id_status_idx ON marketplace_requests(listing_id,status);
CREATE INDEX marketplace_requests_organization_id_created_at_idx ON marketplace_requests(organization_id,created_at);

CREATE TABLE issue_reports (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), author_id UUID NOT NULL REFERENCES users(id),
 crop_type VARCHAR(120) NOT NULL, category "IssueCategory" NOT NULL, title VARCHAR(160) NOT NULL,
 symptoms VARCHAR(2000) NOT NULL, region VARCHAR(160) NOT NULL,
 public_lat DECIMAL(8,5), public_lng DECIMAL(8,5), observed_at DATE NOT NULL,
 treatment_history VARCHAR(2000), image_keys TEXT[] NOT NULL DEFAULT '{}', interests TEXT[] NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
 CONSTRAINT issue_public_coordinates CHECK ((public_lat IS NULL AND public_lng IS NULL) OR (public_lat BETWEEN -90 AND 90 AND public_lng BETWEEN -180 AND 180))
);
CREATE INDEX issue_reports_crop_type_category_idx ON issue_reports(crop_type,category);
CREATE TABLE research_groups (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(160) NOT NULL, description VARCHAR(1000) NOT NULL,
 crop_types TEXT[] NOT NULL DEFAULT '{}', interests TEXT[] NOT NULL DEFAULT '{}',
 creator_id UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE TABLE group_memberships (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), group_id UUID NOT NULL REFERENCES research_groups(id),
 user_id UUID NOT NULL REFERENCES users(id), role VARCHAR(16) NOT NULL DEFAULT 'MEMBER',
 joined_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(), UNIQUE(group_id,user_id),
 CONSTRAINT group_role CHECK (role IN ('OWNER','MEMBER'))
);
CREATE TABLE group_invitations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), group_id UUID NOT NULL REFERENCES research_groups(id),
 invited_id UUID NOT NULL REFERENCES users(id), invited_by_id UUID NOT NULL REFERENCES users(id),
 status "CollaborationStatus" NOT NULL DEFAULT 'PENDING', created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
 UNIQUE(group_id,invited_id)
);
CREATE TABLE group_posts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), group_id UUID NOT NULL REFERENCES research_groups(id),
 author_id UUID NOT NULL REFERENCES users(id), body VARCHAR(3000) NOT NULL,
 attachment_keys TEXT[] NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX group_posts_group_id_created_at_idx ON group_posts(group_id,created_at);
CREATE TABLE group_observations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), group_id UUID NOT NULL REFERENCES research_groups(id),
 author_id UUID NOT NULL REFERENCES users(id), title VARCHAR(160) NOT NULL,
 method VARCHAR(2000) NOT NULL, observation VARCHAR(3000) NOT NULL, observed_at DATE NOT NULL,
 attachment_keys TEXT[] NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX group_observations_group_id_observed_at_idx ON group_observations(group_id,observed_at);
