import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ResourceCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { mapChanged } from '../realtime/outbox';
import {
  CreateLocationDto,
  LocationQueryDto,
  MarkerQueryDto,
  UpdateLocationDto,
} from './locations.dto';

type LocationRow = {
  id: string;
  organizationId: string;
  organizationName: string;
  category: ResourceCategory;
  name: string;
  description: string | null;
  addressLabel: string | null;
  lng: number;
  lat: number;
  acceptedCrops: string[];
  capacityKg: number | null;
  hours: unknown;
  available: boolean;
  distanceMeters: number | null;
};

const projection = Prisma.sql`l.id, l.organization_id AS "organizationId", o.name AS "organizationName", l.category, l.name, l.description, l.address_label AS "addressLabel", ST_X(l.public_geog::geometry) AS lng, ST_Y(l.public_geog::geometry) AS lat, l.accepted_crops AS "acceptedCrops", l.capacity_kg::float8 AS "capacityKg", l.hours, l.available`;

@Injectable()
export class LocationsService {
  constructor(private readonly db: PrismaService) {}

  private conditions(query: LocationQueryDto, userId: string, includeOwned = false): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = [Prisma.sql`o.deleted_at IS NULL AND o.suspended_at IS NULL`];
    const visible = Prisma.sql`l.verified_at IS NOT NULL AND l.published_at IS NOT NULL`;
    conditions.push(
      includeOwned
        ? Prisma.sql`(${visible} OR EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = l.organization_id AND m.user_id = ${userId}::uuid AND m.deleted_at IS NULL))`
        : visible,
    );
    if (query.q)
      conditions.push(
        Prisma.sql`(l.name ILIKE ${`%${query.q}%`} OR o.name ILIKE ${`%${query.q}%`} OR l.address_label ILIKE ${`%${query.q}%`})`,
      );
    if (query.category)
      conditions.push(Prisma.sql`l.category = ${query.category}::"ResourceCategory"`);
    if (query.crop) conditions.push(Prisma.sql`${query.crop} ILIKE ANY(l.accepted_crops)`);
    if (query.available !== undefined)
      conditions.push(Prisma.sql`l.available = ${query.available}`);
    if (query.lat !== undefined && query.lng !== undefined && query.radiusKm !== undefined)
      conditions.push(
        Prisma.sql`ST_DWithin(l.public_geog, ST_SetSRID(ST_MakePoint(${query.lng}, ${query.lat}),4326)::geography, ${query.radiusKm * 1000})`,
      );
    return conditions;
  }

  private validateGeo(query: LocationQueryDto, required = false): void {
    const count = [query.lat, query.lng, query.radiusKm].filter((v) => v !== undefined).length;
    if ((required && count !== 3) || (count !== 0 && count !== 3))
      throw new BadRequestException('lat, lng and radiusKm must be supplied together');
  }

  async list(query: LocationQueryDto, userId: string, nearby = false) {
    this.validateGeo(query, nearby);
    const conditions = this.conditions(query, userId);
    const point =
      query.lat === undefined
        ? Prisma.sql`NULL::geography`
        : Prisma.sql`ST_SetSRID(ST_MakePoint(${query.lng}, ${query.lat}),4326)::geography`;
    const where = Prisma.join(conditions, ' AND ');
    const [items, total] = await Promise.all([
      this.db.$queryRaw<LocationRow[]>(
        Prisma.sql`SELECT ${projection}, CASE WHEN ${point} IS NULL THEN NULL ELSE ST_Distance(l.public_geog, ${point}) END AS "distanceMeters" FROM resource_locations l JOIN organizations o ON o.id = l.organization_id WHERE ${where} ORDER BY ${nearby ? Prisma.sql`"distanceMeters" ASC,` : Prisma.empty} l.name ASC, l.id ASC LIMIT ${query.limit} OFFSET ${query.offset}`,
      ),
      this.db.$queryRaw<{ count: bigint }[]>(
        Prisma.sql`SELECT count(*) AS count FROM resource_locations l JOIN organizations o ON o.id = l.organization_id WHERE ${where}`,
      ),
    ]);
    return { items, total: Number(total[0]?.count ?? 0), limit: query.limit, offset: query.offset };
  }

  async get(id: string, userId: string) {
    const where = Prisma.join(
      [Prisma.sql`l.id = ${id}::uuid`, ...this.conditions(new LocationQueryDto(), userId, true)],
      ' AND ',
    );
    const rows = await this.db.$queryRaw<LocationRow[]>(
      Prisma.sql`SELECT ${projection}, NULL::float8 AS "distanceMeters" FROM resource_locations l JOIN organizations o ON o.id = l.organization_id WHERE ${where}`,
    );
    if (!rows[0]) throw new NotFoundException('Location unavailable');
    return rows[0];
  }

  async mine(userId: string) {
    return this.db.$queryRaw<LocationRow[]>(
      Prisma.sql`SELECT ${projection}, NULL::float8 AS "distanceMeters" FROM resource_locations l JOIN organizations o ON o.id = l.organization_id JOIN organization_memberships m ON m.organization_id = o.id AND m.user_id = ${userId}::uuid AND m.deleted_at IS NULL WHERE o.deleted_at IS NULL AND o.suspended_at IS NULL ORDER BY l.name, l.id LIMIT 500`,
    );
  }
  async pending() {
    return this.db.$queryRaw<LocationRow[]>(
      Prisma.sql`SELECT ${projection}, NULL::float8 AS "distanceMeters" FROM resource_locations l JOIN organizations o ON o.id = l.organization_id WHERE l.published_at IS NULL AND o.deleted_at IS NULL AND o.suspended_at IS NULL ORDER BY l.created_at ASC LIMIT 500`,
    );
  }

  async markers(query: MarkerQueryDto, userId: string) {
    if (query.west === query.east || query.south >= query.north)
      throw new BadRequestException('Invalid bounds');
    const bounds = query.west < query.east
      ? Prisma.sql`l.public_geog::geometry && ST_MakeEnvelope(${query.west}, ${query.south}, ${query.east}, ${query.north}, 4326)`
      : Prisma.sql`(l.public_geog::geometry && ST_MakeEnvelope(${query.west}, ${query.south}, 180, ${query.north}, 4326) OR l.public_geog::geometry && ST_MakeEnvelope(-180, ${query.south}, ${query.east}, ${query.north}, 4326))`;
    const where = Prisma.join(
      [
        ...this.conditions(query, userId),
        bounds,
      ],
      ' AND ',
    );
    const [items, count] = await Promise.all([
      this.db.$queryRaw<Pick<LocationRow, 'id' | 'name' | 'category' | 'lng' | 'lat' | 'available'>[]>(
        Prisma.sql`SELECT l.id, l.name, l.category, ST_X(l.public_geog::geometry) AS lng, ST_Y(l.public_geog::geometry) AS lat, l.available FROM resource_locations l JOIN organizations o ON o.id = l.organization_id WHERE ${where} ORDER BY l.id LIMIT ${query.limit} OFFSET ${query.offset}`,
      ),
      this.db.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*) AS count FROM resource_locations l JOIN organizations o ON o.id = l.organization_id WHERE ${where}`),
    ]);
    return { items, total: Number(count[0]?.count ?? 0), limit: query.limit, offset: query.offset };
  }

  filters() {
    return { categories: Object.values(ResourceCategory), maxRadiusKm: 500 };
  }

  async create(organizationId: string, userId: string, input: CreateLocationDto) {
    await this.requireManager(organizationId, userId);
    this.validateHours(input.hours);
    const sensitive =
      input.category === ResourceCategory.FARMER ||
      input.category === ResourceCategory.FOSTER_SUPPORT;
    const publicLng = sensitive ? Math.round(input.lng * 10) / 10 : input.lng;
    const publicLat = sensitive ? Math.round(input.lat * 10) / 10 : input.lat;
    const rows = await this.db.$queryRaw<
      { id: string }[]
    >`INSERT INTO resource_locations (organization_id, category, name, description, address_label, public_geog, accepted_crops, capacity_kg, available, hours) VALUES (${organizationId}::uuid, ${input.category}::"ResourceCategory", ${input.name}, ${input.description ?? null}, ${sensitive ? null : (input.addressLabel ?? null)}, ST_SetSRID(ST_MakePoint(${publicLng}, ${publicLat}),4326)::geography, ${input.acceptedCrops ?? []}::text[], ${input.capacityKg ?? null}, ${input.available ?? true}, ${JSON.stringify(input.hours ?? {})}::jsonb) RETURNING id`;
    if (!rows[0]) throw new BadRequestException('Location could not be created');
    return { id: rows[0].id, status: 'pending_review' };
  }

  async update(id: string, userId: string, input: UpdateLocationDto) {
    const location = await this.db.resourceLocation.findUnique({
      where: { id },
      select: { organizationId: true, category: true, name: true, addressLabel: true },
    });
    if (!location) throw new NotFoundException('Location unavailable');
    await this.requireManager(location.organizationId, userId);
    this.validateHours(input.hours);
    if ((input.lat === undefined) !== (input.lng === undefined))
      throw new BadRequestException('lat and lng must be supplied together');
    const sensitive =
      location.category === ResourceCategory.FARMER ||
      location.category === ResourceCategory.FOSTER_SUPPORT;
    const effectiveAddress = sensitive ? null : input.addressLabel;
    const changedPublicIdentity =
      (input.name !== undefined && input.name !== location.name) ||
      (input.addressLabel !== undefined && effectiveAddress !== location.addressLabel) ||
      input.lng !== undefined;
    const updates: Prisma.Sql[] = [Prisma.sql`updated_at = now()`];
    if (input.name !== undefined) updates.push(Prisma.sql`name = ${input.name}`);
    if (input.description !== undefined)
      updates.push(Prisma.sql`description = ${input.description}`);
    if (input.addressLabel !== undefined)
      updates.push(Prisma.sql`address_label = ${sensitive ? null : input.addressLabel}`);
    if (input.lng !== undefined && input.lat !== undefined) {
      const lng = sensitive ? Math.round(input.lng * 10) / 10 : input.lng;
      const lat = sensitive ? Math.round(input.lat * 10) / 10 : input.lat;
      updates.push(
        Prisma.sql`public_geog = ST_SetSRID(ST_MakePoint(${lng}, ${lat}),4326)::geography`,
      );
    }
    if (input.acceptedCrops !== undefined)
      updates.push(Prisma.sql`accepted_crops = ${input.acceptedCrops}::text[]`);
    if (input.capacityKg !== undefined) updates.push(Prisma.sql`capacity_kg = ${input.capacityKg}`);
    if (input.available !== undefined) updates.push(Prisma.sql`available = ${input.available}`);
    if (input.hours !== undefined)
      updates.push(Prisma.sql`hours = ${JSON.stringify(input.hours)}::jsonb`);
    if (changedPublicIdentity)
      updates.push(Prisma.sql`verified_at = NULL`, Prisma.sql`published_at = NULL`);
    await this.db.$transaction(async tx => {
      const [before] = await tx.$queryRaw<{ published: boolean }[]>`SELECT (l.verified_at IS NOT NULL AND l.published_at IS NOT NULL AND o.deleted_at IS NULL AND o.suspended_at IS NULL) AS published FROM resource_locations l JOIN organizations o ON o.id = l.organization_id WHERE l.id = ${id}::uuid FOR UPDATE OF l`;
      await tx.$executeRaw(
        Prisma.sql`UPDATE resource_locations SET ${Prisma.join(updates, ', ')} WHERE id = ${id}::uuid`,
      );
      if (before?.published) await mapChanged(tx, 'resources');
    });
    return { id, status: changedPublicIdentity ? 'pending_review' : 'updated' };
  }

  private async requireManager(organizationId: string, userId: string): Promise<void> {
    const membership = await this.db.organizationMembership.findFirst({
      where: {
        organizationId,
        userId,
        deletedAt: null,
        role: { in: ['OWNER', 'MANAGER'] },
        organization: { deletedAt: null, suspendedAt: null },
      },
      select: { id: true },
    });
    if (!membership) throw new ForbiddenException();
  }

  private validateHours(hours?: Record<string, string>): void {
    if (hours === undefined) return;
    const days = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    for (const [day, value] of Object.entries(hours)) {
      if (
        !days.has(day) ||
        typeof value !== 'string' ||
        !/^(closed|(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
      )
        throw new BadRequestException('Invalid hours');
    }
  }

  async publish(id: string, reviewerId: string, reason: string) {
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`UPDATE resource_locations l SET verified_at = now(), published_at = now(), updated_at = now() FROM organizations o WHERE l.id = ${id}::uuid AND o.id = l.organization_id AND o.deleted_at IS NULL AND o.suspended_at IS NULL AND l.published_at IS NULL RETURNING l.id`;
      if (!rows[0]) throw new NotFoundException('Pending location unavailable');
      await tx.resourceLocationReview.create({ data: { locationId: id, reviewerId, reason: reason.trim() } });
      await mapChanged(tx, 'resources');
      return { id, status: 'published' };
    });
  }
}
