import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { RealtimeEventData } from '@cropcircle/shared-types';
import { ListingMode, MarketplaceRequestStatus, OrganizationRole, PlatformRole, Prisma } from '@prisma/client';
import type { MarketplaceRequest } from '@prisma/client';
import { activeOrganization, OrganizationAccessService } from '../organizations/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { mapChanged, notify, recordEvent, topic } from '../realtime/outbox';
import { ListingDto, ListingSearchDto, PickupDto, ProfileDto, RequestDto } from './stage5.dto';
import { assertMediaKeys } from './media-keys';

const managers = [OrganizationRole.OWNER, OrganizationRole.MANAGER];
const listingInclude = {
  organization: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
} as const;
const publicListing = {
  deletedAt: null,
  organization: { ...activeOrganization, verifiedAt: { not: null } },
  location: { verifiedAt: { not: null }, publishedAt: { not: null } },
} satisfies Prisma.CropListingWhereInput;

function requestPayload(request: MarketplaceRequest) {
  return { requestId: request.id, listingId: request.listingId, mode: request.mode };
}

async function requestEvent(tx: Prisma.TransactionClient, request: MarketplaceRequest, sellerId: string, actorId: string, event: RealtimeEventData, title?: string) {
  const ids = [sellerId, request.organizationId];
  await recordEvent(tx, event, ids.map(id => ({ kind: 'organization', id })));
  if (title) await notify(tx, event.type, title, { kind: 'organizations', ids }, actorId);
}

@Injectable()
export class MarketplaceService {
  constructor(private readonly db: PrismaService, private readonly access: OrganizationAccessService) {}

  private async verifiedOrganization(userId: string, organizationId: string, roles: OrganizationRole[] = []) {
    await this.access.require(userId, organizationId, roles);
    const org = await this.db.organization.findUnique({ where: { id: organizationId }, select: { verifiedAt: true } });
    if (!org?.verifiedAt) throw new ForbiddenException('Organization must be verified');
  }
  private async publicLocation(organizationId: string, locationId: string) {
    const location = await this.db.resourceLocation.findFirst({
      where: { id: locationId, organizationId, verifiedAt: { not: null }, publishedAt: { not: null } },
      select: { id: true },
    });
    if (!location) throw new BadRequestException('Choose a verified, published pickup location owned by your organization');
  }
  async verifyOrganization(id: string) {
    return this.db.organization.update({ where: { id }, data: { verifiedAt: new Date() }, select: { id: true, name: true, verifiedAt: true } });
  }
  pendingOrganizations() {
    return this.db.organization.findMany({ where: { verifiedAt: null, deletedAt: null, suspendedAt: null }, select: { id: true, name: true, type: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: 100 });
  }
  async upsertProfile(userId: string, organizationId: string, dto: ProfileDto) {
    await this.verifiedOrganization(userId, organizationId, managers);
    if (dto.locationId) await this.publicLocation(organizationId, dto.locationId);
    return this.db.$transaction(async tx => {
      const profile = await tx.marketplaceProfile.upsert({ where: { organizationId }, create: { ...dto, organizationId }, update: dto });
      if (profile.locationId) await mapChanged(tx, 'recipients');
      return profile;
    });
  }
  async recipients(query: ListingSearchDto) {
    const where: Prisma.MarketplaceProfileWhereInput = {
      organization: { verifiedAt: { not: null }, deletedAt: null, suspendedAt: null },
      ...(query.q ? { OR: [{ organization: { name: { contains: query.q, mode: 'insensitive' } } }, { acceptedCrops: { has: query.q } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.marketplaceProfile.findMany({ where, select: { id: true, organizationId: true, locationId: true, acceptedCrops: true, demand: true, quantityLimit: true, storageCapacity: true, serviceRadiusKm: true, pickup: true, delivery: true, hours: true, coldStorage: true, acceptsSales: true, organization: { select: { name: true } }, location: { select: { id: true, name: true } } }, take: query.limit, skip: query.offset }),
      this.db.marketplaceProfile.count({ where }),
    ]);
    return { items, total };
  }
  async recipientMarkers(query: ListingSearchDto) {
    const coordinates = [query.lng, query.lat, query.radiusKm].filter(value => value !== undefined).length;
    if (coordinates !== 0 && coordinates !== 3) throw new BadRequestException('lng, lat and radiusKm must be supplied together');
    const conditions: Prisma.Sql[] = [Prisma.sql`o.verified_at IS NOT NULL AND o.deleted_at IS NULL AND o.suspended_at IS NULL AND l.verified_at IS NOT NULL AND l.published_at IS NOT NULL`];
    if (query.q) conditions.push(Prisma.sql`(${query.q} ILIKE ANY(p.accepted_crops) OR o.name ILIKE ${`%${query.q}%`})`);
    if (coordinates === 3) conditions.push(Prisma.sql`ST_DWithin(l.public_geog, ST_SetSRID(ST_MakePoint(${query.lng},${query.lat}),4326)::geography, ${query.radiusKm! * 1000})`);
    const where = Prisma.join(conditions, ' AND ');
    return this.db.$queryRaw<{ id: string; organizationName: string; demand: string | null; acceptedCrops: string[]; lng: number; lat: number }[]>(Prisma.sql`SELECT p.id, o.name AS "organizationName", p.demand, p.accepted_crops AS "acceptedCrops", ST_X(l.public_geog::geometry) AS lng, ST_Y(l.public_geog::geometry) AS lat FROM marketplace_profiles p JOIN organizations o ON o.id = p.organization_id JOIN resource_locations l ON l.id = p.location_id WHERE ${where} ORDER BY o.name LIMIT ${Math.min(query.limit,100)} OFFSET ${query.offset}`);
  }
  async create(userId: string, roles: PlatformRole[], dto: ListingDto) {
    if (!roles.includes(PlatformRole.FARMER) && !roles.includes(PlatformRole.ADMIN)) {
      const farm = await this.db.organization.findUnique({ where: { id: dto.organizationId }, select: { type: true } });
      if (farm?.type !== 'farm') throw new ForbiddenException('Farm organization required');
    }
    await this.verifiedOrganization(userId, dto.organizationId, managers);
    await this.publicLocation(dto.organizationId, dto.locationId);
    this.checkListing(dto);
    assertMediaKeys(userId, dto.imageKeys);
    return this.db.$transaction(async tx => {
      const listing = await tx.cropListing.create({ data: { ...dto, creatorId: userId, harvestDate: new Date(dto.harvestDate), expiresAt: new Date(dto.expiresAt) }, include: listingInclude });
      await tx.intelligenceJob.create({ data: { kind: 'RECOMMENDATION', organizationId: listing.organizationId, subjectId: listing.id } });
      await recordEvent(tx, { type: 'LISTING_CREATED', payload: { listingId: listing.id } }, [topic('marketplace')]);
      await mapChanged(tx, 'produce');
      await notify(tx, 'LISTING_CREATED', `New crop listing: ${listing.cropName}`, { kind: 'everyone' }, userId);
      return listing;
    });
  }
  private checkListing(dto: ListingDto) {
    if ((dto.mode === ListingMode.SALE) !== (dto.price !== undefined)) throw new BadRequestException('Price is required only for sale listings');
    if (new Date(dto.expiresAt) <= new Date()) throw new BadRequestException('Expiry must be in the future');
    if (dto.pickupFrom && dto.pickupUntil && new Date(dto.pickupFrom) >= new Date(dto.pickupUntil)) {
      throw new BadRequestException('Pickup window must end after it starts');
    }
    if (dto.pickupFrom && new Date(dto.pickupFrom) >= new Date(dto.expiresAt)) {
      throw new BadRequestException('Pickup window must start before the listing expires');
    }
    if (dto.imageKeys?.length && dto.imageKeys.length > 8) throw new BadRequestException('Maximum 8 images');
  }
  async update(userId: string, id: string, dto: ListingDto) {
    const listing = await this.db.cropListing.findUnique({ where: { id }, select: { organizationId: true, imageKeys: true } });
    if (!listing) throw new NotFoundException();
    if (listing.organizationId !== dto.organizationId) throw new BadRequestException('Organization cannot change');
    await this.verifiedOrganization(userId, listing.organizationId, managers);
    await this.publicLocation(listing.organizationId, dto.locationId);
    this.checkListing(dto);
    assertMediaKeys(userId, dto.imageKeys, listing.imageKeys);
    return this.db.$transaction(async tx => {
      const changed = await tx.cropListing.updateMany({ where: { id, deletedAt: null, reservedQuantity: { lte: dto.quantity } }, data: { ...dto, harvestDate: new Date(dto.harvestDate), expiresAt: new Date(dto.expiresAt) } });
      if (!changed.count) throw new ConflictException('Quantity is below current reservations or listing is deleted');
      await tx.intelligenceJob.create({ data: { kind: 'RECOMMENDATION', organizationId: listing.organizationId, subjectId: id } });
      await recordEvent(tx, { type: 'LISTING_UPDATED', payload: { listingId: id } }, [topic('marketplace')]);
      await mapChanged(tx, 'produce');
      return tx.cropListing.findUniqueOrThrow({ where: { id }, include: listingInclude });
    });
  }
  async remove(userId: string, id: string) {
    const listing = await this.db.cropListing.findUnique({ where: { id }, select: { organizationId: true } });
    if (!listing) throw new NotFoundException();
    await this.verifiedOrganization(userId, listing.organizationId, managers);
    await this.db.$transaction(async tx => {
      const changed = await tx.cropListing.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
      if (!changed.count) return;
      await recordEvent(tx, { type: 'LISTING_UPDATED', payload: { listingId: id } }, [{ kind: 'organization', id: listing.organizationId }]);
      await mapChanged(tx, 'produce');
    });
    return { deleted: true };
  }
  async list(query: ListingSearchDto) {
    const coordinates = [query.lng, query.lat, query.radiusKm].filter((value) => value !== undefined).length;
    if (coordinates !== 0 && coordinates !== 3) throw new BadRequestException('lng, lat and radiusKm must be supplied together');
    const availableIds = coordinates === 3 ? await this.db.$queryRaw<{ id: string }[]>`SELECT c.id FROM crop_listings c JOIN resource_locations l ON l.id = c.location_id WHERE c.quantity > c.reserved_quantity AND ST_DWithin(l.public_geog, ST_SetSRID(ST_MakePoint(${query.lng},${query.lat}),4326)::geography, ${query.radiusKm! * 1000})` : await this.db.$queryRaw<{ id: string }[]>`SELECT id FROM crop_listings WHERE quantity > reserved_quantity`;
    const where: Prisma.CropListingWhereInput = {
      ...publicListing, expiresAt: { gt: new Date() }, quantity: { gt: 0 },
      ...(query.q ? { OR: [{ cropName: { contains: query.q, mode: 'insensitive' } }, { variety: { contains: query.q, mode: 'insensitive' } }] } : {}),
      ...(query.mode ? { mode: query.mode } : {}),
      id: { in: availableIds.map(({ id }) => id) },
    };
    const [items, total] = await Promise.all([
      this.db.cropListing.findMany({ where, include: listingInclude, orderBy: { createdAt: 'desc' }, take: query.limit, skip: query.offset }),
      this.db.cropListing.count({ where }),
    ]);
    return { items: items.map(item => ({ ...item, availableQuantity: item.quantity.minus(item.reservedQuantity) })), total };
  }
  async mine(userId: string) {
    return this.db.cropListing.findMany({ where: { organization: { ...activeOrganization, memberships: { some: { userId, deletedAt: null } } } }, include: listingInclude, orderBy: { createdAt: 'desc' } });
  }
  async get(id: string) {
    const listing = await this.db.cropListing.findFirst({ where: { id, ...publicListing, expiresAt: { gt: new Date() } }, include: listingInclude });
    if (!listing) throw new NotFoundException();
    return { ...listing, availableQuantity: listing.quantity.minus(listing.reservedQuantity) };
  }
  async markers(query: ListingSearchDto) {
    const result = await this.list({ ...query, limit: Math.min(query.limit, 100) });
    const ids = result.items.map(item => item.id);
    if (!ids.length) return { items: [], total: result.total };
    const points = await this.db.$queryRaw<{ id: string; lng: number; lat: number }[]>`SELECT c.id, ST_X(l.public_geog::geometry) AS lng, ST_Y(l.public_geog::geometry) AS lat FROM crop_listings c JOIN resource_locations l ON l.id = c.location_id WHERE c.id = ANY(${ids}::uuid[])`;
    const positions = new Map(points.map(point => [point.id, point]));
    return { items: result.items.map(item => ({ ...item, ...positions.get(item.id) })), total: result.total };
  }
  async request(userId: string, listingId: string, dto: RequestDto) {
    await this.verifiedOrganization(userId, dto.organizationId);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM crop_listings WHERE id = ${listingId}::uuid FOR UPDATE`;
      if (dto.clientId) {
        const prior = await tx.marketplaceRequest.findUnique({ where: { listingId_requesterId_clientId: { listingId, requesterId: userId, clientId: dto.clientId } } });
        if (prior) {
          if (prior.organizationId !== dto.organizationId || !prior.quantity.equals(new Prisma.Decimal(dto.quantity).toDecimalPlaces(2))) throw new ConflictException('Request ID already used with different details');
          return prior;
        }
      }
      const listing = await tx.cropListing.findFirst({ where: { id: listingId, ...publicListing, expiresAt: { gt: new Date() } } });
      if (!listing) throw new NotFoundException();
      if (listing.organizationId === dto.organizationId) throw new BadRequestException('Cannot request your own listing');
      if (listing.quantity.minus(listing.reservedQuantity).lt(dto.quantity)) throw new ConflictException('Insufficient available quantity');
      if (listing.mode === ListingMode.SALE && !listing.price) throw new BadRequestException('Sale price unavailable');
      const request = await tx.marketplaceRequest.create({ data: { ...dto, listingId, requesterId: userId, mode: listing.mode } });
      const sale = request.mode === ListingMode.SALE;
      await requestEvent(tx, request, listing.organizationId, userId, { type: sale ? 'PURCHASE_REQUESTED' : 'DONATION_REQUESTED', payload: requestPayload(request) }, sale ? 'New purchase request' : 'New donation request');
      return request;
    });
  }
  async requests(userId: string) {
    const organization = { ...activeOrganization, memberships: { some: { userId, deletedAt: null } } };
    const items = await this.db.marketplaceRequest.findMany({ where: { OR: [{ organization }, { listing: { organization } }] }, include: { listing: { select: { id: true, cropName: true, unit: true, organizationId: true, organization: { select: { name: true } } } }, organization: { select: { name: true } } }, orderBy: { createdAt: 'desc' } });
    return items.map(item => ({ ...item, listing: { ...item.listing, mode: item.mode } }));
  }
  async transition(userId: string, id: string, action: 'accept'|'reject'|'cancel'|'fulfill', pickup?: PickupDto) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM marketplace_requests WHERE id = ${id}::uuid FOR UPDATE`;
      const request = await tx.marketplaceRequest.findUnique({ where: { id }, include: { listing: true } });
      if (!request) throw new NotFoundException();
      const sellerAction = action === 'accept' || action === 'reject' || action === 'fulfill';
      const sellerId = request.listing.organizationId;
      const payload = requestPayload(request);
      const sale = request.mode === ListingMode.SALE;
      await this.access.require(userId, sellerAction ? sellerId : request.organizationId, managers, tx);
      if (action === 'accept') {
        if (request.status !== MarketplaceRequestStatus.PENDING) throw new ConflictException('Request already handled');
        if (!pickup || new Date(pickup.pickupAt) <= new Date()) throw new BadRequestException('Future pickup time required');
        // A conditional UPDATE takes the listing row lock and compares the latest committed balance.
        const changed = await tx.$queryRaw<{ id: string }[]>`UPDATE crop_listings SET reserved_quantity = reserved_quantity + ${request.quantity}, updated_at = now() WHERE id = ${request.listingId}::uuid AND deleted_at IS NULL AND expires_at > now() AND quantity - reserved_quantity >= ${request.quantity} RETURNING id`;
        if (!changed.length) throw new ConflictException('Insufficient available quantity or listing unavailable');
        const updated = await tx.marketplaceRequest.update({ where: { id }, data: { status: 'ACCEPTED', pickupAt: new Date(pickup.pickupAt) } });
        await requestEvent(tx, request, sellerId, userId, { type: sale ? 'PURCHASE_ACCEPTED' : 'DONATION_ACCEPTED', payload }, sale ? 'Purchase request accepted' : 'Donation request accepted');
        await requestEvent(tx, request, sellerId, userId, { type: 'LISTING_RESERVED', payload }, 'Produce reservation confirmed');
        await requestEvent(tx, request, sellerId, userId, { type: 'PICKUP_SCHEDULED', payload: { ...payload, pickupAt: updated.pickupAt!.toISOString() } }, 'Produce pickup scheduled');
        await mapChanged(tx, 'produce');
        return updated;
      }
      if (action === 'reject' && request.status === 'PENDING') {
        const updated = await tx.marketplaceRequest.update({ where: { id }, data: { status: 'REJECTED' } });
        await requestEvent(tx, request, sellerId, userId, { type: sale ? 'PURCHASE_DECLINED' : 'DONATION_DECLINED', payload }, sale ? 'Purchase request declined' : 'Donation request declined');
        return updated;
      }
      if (action === 'cancel' && ['PENDING','ACCEPTED'].includes(request.status)) {
        if (request.status === 'ACCEPTED') {
          await tx.cropListing.update({ where: { id: request.listingId }, data: { reservedQuantity: { decrement: request.quantity } } });
          await mapChanged(tx, 'produce');
        }
        const updated = await tx.marketplaceRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
        await requestEvent(tx, request, sellerId, userId, { type: 'REQUEST_CANCELLED', payload }, 'Produce request cancelled');
        return updated;
      }
      if (action === 'fulfill' && request.status === 'ACCEPTED') {
        await tx.cropListing.update({ where: { id: request.listingId }, data: { quantity: { decrement: request.quantity }, reservedQuantity: { decrement: request.quantity } } });
        const updated = await tx.marketplaceRequest.update({ where: { id }, data: { status: 'FULFILLED', fulfilledAt: new Date() } });
        await requestEvent(tx, request, sellerId, userId, { type: 'LISTING_FULFILLED', payload }, 'Produce pickup fulfilled');
        await mapChanged(tx, 'produce');
        return updated;
      }
      throw new ConflictException('Invalid request transition');
    });
  }
}
