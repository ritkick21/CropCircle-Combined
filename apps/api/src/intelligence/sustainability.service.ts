import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PlatformRole, Prisma } from '@prisma/client';
import type { Identity } from '../auth/auth-session.service';
import {
  activeOrganization,
  OrganizationAccessService,
} from '../organizations/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import type { DashboardQuery } from './intelligence.dto';

const kg = Prisma.sql`q.quantity * CASE c.unit WHEN 'KG' THEN 1 WHEN 'LB' THEN 0.45359237 END`;
type Fulfillment = { mode: 'DONATION' | 'SALE'; fulfilled: number; requests: number };
type Demand = { crop: string; pendingKg: number; pendingBoxes: number; pendingRequests: number };
type Destination = {
  id: string;
  name: string;
  kg: number;
  boxes: number;
  lng: number;
  lat: number;
};
type Totals = {
  redistributedKg: number;
  redistributedBoxes: number;
  activeListings: number;
  fulfilledRequests: number;
};

export const jobSummary = {
  id: true,
  kind: true,
  status: true,
  subjectId: true,
  organizationId: true,
  output: true,
  modelVersion: true,
  createdAt: true,
  finishedAt: true,
  error: true,
} satisfies Prisma.IntelligenceJobSelect;

@Injectable()
export class SustainabilityService {
  constructor(
    private readonly db: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async dashboard(identity: Identity, query: DashboardQuery) {
    const userId = identity.user.id;
    const admin = query.scope === 'admin';
    const orgId = query.organizationId;
    if (admin && !identity.user.roles.includes(PlatformRole.ADMIN)) throw new ForbiddenException();
    if (query.scope === 'organization') {
      if (!orgId) throw new BadRequestException('Select an organization');
      await this.access.require(userId, orgId);
    }
    const listingScope = admin
      ? Prisma.sql`TRUE`
      : orgId && query.scope === 'organization'
        ? Prisma.sql`c.organization_id = ${orgId}::uuid`
        : Prisma.sql`c.creator_id = ${userId}::uuid`;
    const requestScope =
      orgId && query.scope === 'organization'
        ? Prisma.sql`(${listingScope} OR q.organization_id = ${orgId}::uuid)`
        : listingScope;
    const issueWhere: Prisma.IssueReportWhereInput = admin
      ? {}
      : orgId && query.scope === 'organization'
        ? { author: { memberships: { some: { organizationId: orgId, deletedAt: null } } } }
        : { authorId: userId };
    const member: Prisma.UserWhereInput =
      orgId && query.scope === 'organization'
        ? { memberships: { some: { organizationId: orgId, deletedAt: null } } }
        : { id: userId };
    const conversationWhere: Prisma.FarmerConversationWhereInput = admin
      ? {}
      : { OR: [{ participantA: member }, { participantB: member }] };
    const authJobs: Prisma.IntelligenceJobWhereInput =
      orgId && query.scope === 'organization'
        ? {
            OR: [
              { userId, organizationId: { in: [orgId] } },
              { userId, organizationId: null },
              { kind: 'RECOMMENDATION', organizationId: orgId },
            ],
          }
        : { userId, organizationId: null };
    const ownListings = admin
      ? {}
      : orgId && query.scope === 'organization'
        ? { organizationId: orgId }
        : { creatorId: userId };

    const [
      [
        totals = {
          redistributedKg: 0,
          redistributedBoxes: 0,
          activeListings: 0,
          fulfilledRequests: 0,
        },
      ],
      fulfillment,
      demand,
      destinations,
      issues,
      conversations,
      groupPosts,
      listings,
      predictions,
    ] = await Promise.all([
      this.db.$queryRaw<Totals[]>`
        SELECT coalesce(sum(${kg}), 0)::float8 AS "redistributedKg",
               coalesce(sum(q.quantity) FILTER (WHERE c.unit = 'BOX'), 0)::float8 AS "redistributedBoxes",
               count(*)::int AS "fulfilledRequests",
               (SELECT count(*)::int FROM crop_listings c
                JOIN organizations listing_org ON listing_org.id = c.organization_id
                JOIN resource_locations pickup ON pickup.id = c.location_id
                WHERE ${listingScope} AND c.deleted_at IS NULL AND c.expires_at > now()
                  AND c.harvest_date + c.shelf_life_days > (now() AT TIME ZONE 'UTC')::date
                  AND c.quantity > c.reserved_quantity AND listing_org.deleted_at IS NULL
                  AND listing_org.suspended_at IS NULL AND listing_org.verified_at IS NOT NULL
                  AND pickup.available AND pickup.verified_at IS NOT NULL AND pickup.published_at IS NOT NULL) AS "activeListings"
        FROM marketplace_requests q JOIN crop_listings c ON c.id = q.listing_id
        WHERE q.status = 'FULFILLED' AND ${requestScope}`,
      this.db.$queryRaw<Fulfillment[]>`
        SELECT CASE WHEN q.mode = 'SALE' THEN 'SALE' ELSE 'DONATION' END AS mode,
               count(*)::int AS requests, count(*) FILTER (WHERE q.status = 'FULFILLED')::int AS fulfilled
        FROM marketplace_requests q JOIN crop_listings c ON c.id = q.listing_id
        WHERE ${requestScope} GROUP BY 1`,
      this.db.$queryRaw<Demand[]>`
        SELECT lower(trim(c.crop_name)) AS crop, coalesce(sum(${kg}), 0)::float8 AS "pendingKg",
               coalesce(sum(q.quantity) FILTER (WHERE c.unit = 'BOX'), 0)::float8 AS "pendingBoxes",
               count(*)::int AS "pendingRequests"
        FROM marketplace_requests q JOIN crop_listings c ON c.id = q.listing_id
        WHERE ${requestScope} AND q.status = 'PENDING' AND c.deleted_at IS NULL AND c.expires_at > now()
        GROUP BY 1 ORDER BY 4 DESC, 1 LIMIT 20`,
      this.db.$queryRaw<Destination[]>`
        SELECT r.id, r.name, coalesce(sum(${kg}), 0)::float8 AS kg,
               coalesce(sum(q.quantity) FILTER (WHERE c.unit = 'BOX'), 0)::float8 AS boxes,
               ST_X(r.public_geog::geometry) AS lng, ST_Y(r.public_geog::geometry) AS lat
        FROM marketplace_requests q JOIN crop_listings c ON c.id = q.listing_id
        JOIN marketplace_profiles p ON p.organization_id = q.organization_id
        JOIN resource_locations r ON r.id = p.location_id AND r.organization_id = q.organization_id
        JOIN organizations o ON o.id = r.organization_id
        WHERE ${requestScope} AND q.status = 'FULFILLED' AND r.verified_at IS NOT NULL
          AND r.published_at IS NOT NULL AND o.deleted_at IS NULL AND o.suspended_at IS NULL
        GROUP BY r.id ORDER BY kg DESC, boxes DESC LIMIT 20`,
      this.db.issueReport.count({ where: issueWhere }),
      this.db.farmerConversation.count({ where: conversationWhere }),
      this.db.groupPost.count({ where: admin ? {} : { author: member } }),
      this.db.cropListing.findMany({
        where: {
          ...ownListings,
          deletedAt: null,
          expiresAt: { gt: new Date() },
          organization: activeOrganization,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, cropName: true, unit: true, organization: { select: { name: true } } },
      }),
      this.db.intelligenceJob.findMany({
        where: admin
          ? { kind: { in: ['RECOMMENDATION', 'SURPLUS', 'DEMAND', 'CLASSIFY', 'SIMILARITY'] } }
          : authJobs,
        select: admin
          ? { ...jobSummary, output: false, error: false, subjectId: false, organizationId: false }
          : jobSummary,
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
    ]);

    const estimateFactor = 0.5;
    return {
      totals,
      fulfillment,
      demand,
      destinations,
      collaboration: { issues, conversations, groupPosts },
      wasteEstimate: {
        kg: Math.round(totals.redistributedKg * estimateFactor * 100) / 100,
        factor: estimateFactor,
      },
      listings,
      predictions,
    };
  }

  activity() {
    return this.db.intelligenceJob
      .groupBy({
        by: ['kind', 'status', 'modelVersion'],
        where: { createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } },
        _count: { _all: true },
        orderBy: [{ kind: 'asc' }, { status: 'asc' }],
      })
      .then((rows) =>
        rows.map((row) => ({
          kind: row.kind,
          status: row.status,
          version: row.modelVersion,
          count: row._count._all,
        })),
      );
  }
}
