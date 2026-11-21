import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformRole, Prisma } from '@prisma/client';
import { activeAccount } from '../auth/auth-session.service';
import { PrismaService } from '../prisma/prisma.service';
import { notify, recordEvent, topic, userRoom } from '../realtime/outbox';
import { issueMatches } from './farmer-matching';
import { GroupDto, InvitationDto, IssueDto, IssueSearchDto, ObservationDto, PageDto, PostDto } from './stage5.dto';
import { assertMediaKeys } from './media-keys';

@Injectable()
export class CollaborationService {
  constructor(private readonly db: PrismaService) {}
  private async farmer(userId: string, roles: PlatformRole[]) {
    if (roles.some(role => role !== PlatformRole.USER)) return;
    const farm = await this.db.organizationMembership.findFirst({ where: { userId, deletedAt: null, organization: { type: 'farm', verifiedAt: { not: null }, deletedAt: null, suspendedAt: null } }, select: { id: true } });
    if (!farm) throw new ForbiddenException('Verified farm membership or agricultural role required');
  }
  async createIssue(userId: string, roles: PlatformRole[], dto: IssueDto) {
    await this.farmer(userId, roles);
    assertMediaKeys(userId, dto.imageKeys);
    return this.db.$transaction(async tx => {
      // Serialize matching so concurrent reports can see a committed peer.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cropcircle:issue-matching'))`;
      const issue = await tx.issueReport.create({ data: { ...dto, authorId: userId, observedAt: new Date(dto.observedAt) } });
      await recordEvent(tx, { type: 'AGRICULTURAL_ISSUE_CREATED', payload: { issueId: issue.id } }, [topic('issues')]);
      await notify(tx, 'AGRICULTURAL_ISSUE_CREATED', 'New agricultural issue: ' + issue.title, { kind: 'everyone' }, userId);
      const peers = await tx.issueReport.findMany({
        where: { authorId: { not: userId }, author: activeAccount, OR: issueMatches(issue) },
        orderBy: { createdAt: 'desc' }, distinct: ['authorId'], take: 20, select: { id: true, authorId: true },
      });
      if (peers.length) {
        await notify(tx, 'FARMER_MATCH_FOUND', 'A farmer reported a similar issue', { kind: 'users', ids: peers.map(peer => peer.authorId) }, userId);
        await notify(tx, 'FARMER_MATCH_FOUND', 'Similar farmer reports found', { kind: 'users', ids: [userId] });
      }
      for (const peer of peers) {
        await recordEvent(tx, { type: 'FARMER_MATCH_FOUND', payload: { issueIds: [issue.id, peer.id] } }, [userRoom(userId), userRoom(peer.authorId)]);
      }
      return issue;
    });
  }
  async issues(query: IssueSearchDto) {
    const where: Prisma.IssueReportWhereInput = {
      ...(query.cropType ? { cropType: { contains: query.cropType, mode: 'insensitive' } } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.q ? { OR: [{ title: { contains: query.q, mode: 'insensitive' } }, { symptoms: { contains: query.q, mode: 'insensitive' } }, { region: { contains: query.q, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.issueReport.findMany({ where, select: { id: true, cropType: true, category: true, title: true, symptoms: true, region: true, observedAt: true, treatmentHistory: true, imageKeys: true, interests: true, createdAt: true, author: { select: { id: true, displayName: true } } }, orderBy: { createdAt: 'desc' }, take: query.limit, skip: query.offset }),
      this.db.issueReport.count({ where }),
    ]);
    return { items: items.map(item => ({ ...item, diagnosisStatus: 'UNVERIFIED' })), total };
  }
  async similar(issueId: string, userId: string) {
    const issue = await this.db.issueReport.findUnique({ where: { id: issueId } });
    if (!issue) throw new NotFoundException();
    const candidates = await this.db.issueReport.findMany({
      where: { authorId: { notIn: [issue.authorId, userId] }, author: activeAccount, OR: issueMatches(issue) },
      include: { author: { select: { id: true, displayName: true } } }, take: 100,
    });
    const scored = candidates.map(candidate => {
      const sameCrop = candidate.cropType.toLowerCase() === issue.cropType.toLowerCase();
      const sameCategory = candidate.category === issue.category;
      const sharedInterests = candidate.interests.filter(interest => issue.interests.includes(interest));
      const distanceKm = issue.publicLat && issue.publicLng && candidate.publicLat && candidate.publicLng ?
        haversine(Number(issue.publicLat), Number(issue.publicLng), Number(candidate.publicLat), Number(candidate.publicLng)) : null;
      return { farmer: candidate.author, reportId: candidate.id, cropType: candidate.cropType, category: candidate.category, region: candidate.region, distanceKm, sharedInterests,
        score: Number(sameCrop) * 4 + Number(sameCategory) * 3 + sharedInterests.length * 2 + (distanceKm !== null && distanceKm <= 100 ? 2 : 0) };
    });
    return scored.sort((a,b) => b.score - a.score).slice(0, 20);
  }
  async experts(query: PageDto) {
    const where: Prisma.UserWhereInput = { deletedAt: null, status: 'ACTIVE', roles: { hasSome: ['PROFESSIONAL','RESEARCHER'] }, ...(query.q ? { displayName: { contains: query.q, mode: 'insensitive' } } : {}) };
    return this.db.user.findMany({ where, select: { id: true, displayName: true, roles: true, memberships: { where: { deletedAt: null, organization: { verifiedAt: { not: null } } }, select: { organization: { select: { id: true, name: true, type: true } } } } }, take: query.limit, skip: query.offset });
  }
  async groups(query: PageDto) {
    return this.db.researchGroup.findMany({ where: query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { description: { contains: query.q, mode: 'insensitive' } }] } : {}, include: { _count: { select: { members: true } } }, take: query.limit, skip: query.offset, orderBy: { createdAt: 'desc' } });
  }
  async createGroup(userId: string, roles: PlatformRole[], dto: GroupDto) {
    await this.farmer(userId, roles);
    return this.db.researchGroup.create({ data: { ...dto, creatorId: userId, members: { create: { userId, role: 'OWNER' } } } });
  }
  private async member(userId: string, groupId: string, tx: Prisma.TransactionClient = this.db) {
    const membership = await tx.groupMembership.findUnique({ where: { groupId_userId: { groupId, userId } } });
    if (!membership) throw new ForbiddenException('Group membership required');
    return membership;
  }
  async group(userId: string, groupId: string) {
    await this.member(userId, groupId);
    const group = await this.db.researchGroup.findUnique({ where: { id: groupId }, include: {
      members: { select: { role: true, user: { select: { id: true, displayName: true } } } },
      posts: { include: { author: { select: { id: true, displayName: true } } }, orderBy: { createdAt: 'desc' }, take: 100 },
      observations: { include: { author: { select: { id: true, displayName: true } } }, orderBy: { observedAt: 'desc' }, take: 100 },
    } });
    if (!group) throw new NotFoundException();
    return group;
  }
  async join(userId: string, roles: PlatformRole[], groupId: string) {
    await this.farmer(userId, roles);
    if (!await this.db.researchGroup.findUnique({ where: { id: groupId }, select: { id: true } })) throw new NotFoundException();
    return this.db.groupMembership.upsert({ where: { groupId_userId: { groupId, userId } }, create: { groupId, userId }, update: {} });
  }
  async invite(userId: string, groupId: string, dto: InvitationDto) {
    await this.member(userId, groupId);
    if (dto.userId === userId) throw new ConflictException('Cannot invite yourself');
    return this.db.groupInvitation.upsert({ where: { groupId_invitedId: { groupId, invitedId: dto.userId } }, create: { groupId, invitedId: dto.userId, invitedById: userId }, update: { invitedById: userId, status: 'PENDING' } });
  }
  invitations(userId: string) {
    return this.db.groupInvitation.findMany({ where: { invitedId: userId, status: 'PENDING' }, include: { group: { select: { id: true, name: true } }, invitedBy: { select: { id: true, displayName: true } } } });
  }
  async invitationDecision(userId: string, id: string, accept: boolean) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM group_invitations WHERE id = ${id}::uuid FOR UPDATE`;
      const invitation = await tx.groupInvitation.findUnique({ where: { id } });
      if (!invitation || invitation.invitedId !== userId) throw new NotFoundException();
      if (invitation.status !== 'PENDING') throw new ConflictException('Invitation already handled');
      if (accept) await tx.groupMembership.upsert({ where: { groupId_userId: { groupId: invitation.groupId, userId } }, create: { groupId: invitation.groupId, userId }, update: {} });
      return tx.groupInvitation.update({ where: { id }, data: { status: accept ? 'ACCEPTED' : 'REJECTED' } });
    });
  }
  async post(userId: string, groupId: string, dto: PostDto) {
    assertMediaKeys(userId, dto.attachmentKeys);
    return this.db.$transaction(async tx => {
      await this.member(userId, groupId, tx);
      const data = { groupId, authorId: userId, ...dto };
      const [post] = await tx.groupPost.createManyAndReturn({ data: [data], skipDuplicates: true });
      if (!post) {
        const prior = await tx.groupPost.findUniqueOrThrow({ where: { groupId_authorId_clientId: { groupId, authorId: userId, clientId: dto.clientId! } } });
        if (prior.body !== dto.body || JSON.stringify(prior.attachmentKeys) !== JSON.stringify(dto.attachmentKeys ?? [])) throw new ConflictException('Post ID already used with different content');
        return prior;
      }
      await recordEvent(tx, { type: 'GROUP_MESSAGE_CREATED', payload: { groupId, messageId: post.id } }, [{ kind: 'group', id: groupId }]);
      await notify(tx, 'GROUP_MESSAGE_CREATED', 'New research group message', { kind: 'group', id: groupId }, userId);
      return post;
    });
  }
  async observe(userId: string, groupId: string, dto: ObservationDto) {
    assertMediaKeys(userId, dto.attachmentKeys);
    return this.db.$transaction(async tx => {
      await this.member(userId, groupId, tx);
      const observation = await tx.groupObservation.create({ data: { groupId, authorId: userId, ...dto, observedAt: new Date(dto.observedAt) } });
      await recordEvent(tx, { type: 'GROUP_ACTIVITY_UPDATED', payload: { groupId } }, [{ kind: 'group', id: groupId }]);
      return observation;
    });
  }
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const a = Math.sin((lat2-lat1)*rad/2)**2 + Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin((lng2-lng1)*rad/2)**2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
