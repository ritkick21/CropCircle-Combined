import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FarmReplyKind, PlatformRole, Prisma } from '@prisma/client';
import type { Identity } from '../auth/auth-session.service';
import { activeAccount } from '../auth/auth-session.service';
import { PrismaService } from '../prisma/prisma.service';
import { notify } from '../realtime/outbox';
import type {
  CreateFarmCaseDto,
  CreateFarmResourceDto,
  CreateFarmTrialDto,
  ReplyFarmCaseDto,
  ShareFarmCaseDto,
  SolveFarmCaseDto,
} from './farmline.dto';
import { extensionDirectory, guidanceFor, referenceLibrary } from './guidance';

const person = { id: true, displayName: true } as const;
const closeCase = 'This case is no longer open';
const caseSelection = {
  id: true,
  crop: true,
  region: true,
  description: true,
  openToTrials: true,
  createdAt: true,
  sharedAt: true,
  resolvedAt: true,
  resolution: true,
  publishFix: true,
  grower: { select: person },
  researcher: { select: person },
  replies: {
    select: { id: true, kind: true, body: true, createdAt: true, author: { select: person } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.FarmCaseSelect;

const reviewers: PlatformRole[] = [PlatformRole.RESEARCHER, PlatformRole.PROFESSIONAL];
const hasResearchRole = (user: Identity['user']) =>
  user.roles.some((role) => reviewers.includes(role));
const researcherFilter = {
  ...activeAccount,
  roles: { hasSome: reviewers },
} satisfies Prisma.UserWhereInput;

function reviewedBy(id: string): Prisma.FarmCaseWhereInput {
  return {
    growerId: { not: id },
    grower: activeAccount,
    sharedAt: { not: null },
    OR: [{ researcherId: id }, { researcherId: null }],
  };
}

function presentCase(item: Prisma.FarmCaseGetPayload<{ select: typeof caseSelection }>) {
  return { ...item, guidance: guidanceFor(item.crop, item.description) };
}

@Injectable()
export class FarmlineService {
  constructor(private readonly db: PrismaService) {}

  async workspace(user: Identity['user']) {
    const page = { select: caseSelection, orderBy: { activityAt: 'desc' }, take: 40 } as const;
    const [mine, incoming, researchers, resources, trials, fixes] = await Promise.all([
      this.db.farmCase.findMany({ ...page, where: { growerId: user.id } }),
      hasResearchRole(user)
        ? this.db.farmCase.findMany({
            ...page,
            where: {
              ...reviewedBy(user.id),
              AND: [{ OR: [{ resolvedAt: null }, { replies: { some: { authorId: user.id } } }] }],
            },
          })
        : [],
      this.db.user.findMany({
        where: { ...researcherFilter, id: { not: user.id } },
        select: {
          ...person,
          farmTrials: { select: { crop: true }, orderBy: { createdAt: 'desc' }, take: 10 },
        },
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        take: 100,
      }),
      this.db.farmResource.findMany({
        where: { author: activeAccount },
        orderBy: { createdAt: 'desc' },
        take: 80,
      }),
      this.db.farmTrial.findMany({
        where: { author: researcherFilter },
        select: {
          id: true,
          crop: true,
          title: true,
          description: true,
          author: { select: person },
        },
        orderBy: { createdAt: 'desc' },
        take: 80,
      }),
      this.db.farmCase.findMany({
        where: { publishFix: true, resolution: { not: null }, grower: activeAccount },
        select: { id: true, crop: true, resolution: true },
        orderBy: { resolvedAt: 'desc' },
        take: 80,
      }),
    ]);
    return {
      mine: mine.map(presentCase),
      incoming: incoming.map(presentCase),
      researchers: researchers.map(({ farmTrials, ...researcher }) => ({
        ...researcher,
        trialCrops: [...new Set(farmTrials.map(({ crop }) => crop))],
      })),
      resources: [
        ...referenceLibrary,
        ...resources.map(({ id, crop, kind, title, summary, url }) => ({
          id,
          crop,
          kind,
          title,
          summary,
          url,
          publisher: null,
        })),
      ],
      trials,
      fixes,
      extensionDirectory,
    };
  }

  async create(userId: string, dto: CreateFarmCaseDto) {
    const record = await this.db.farmCase.create({
      data: { ...dto, region: dto.region || null, growerId: userId },
      select: caseSelection,
    });
    return presentCase(record);
  }

  async share(userId: string, id: string, dto: ShareFarmCaseDto) {
    const researcherId = dto.researcherId ?? null;
    return this.db.$transaction(async (tx) => {
      const item = await tx.farmCase.findFirst({ where: { id, growerId: userId } });
      if (!item) throw new NotFoundException();
      if (item.sharedAt && item.researcherId === researcherId) return;
      if (item.resolvedAt || item.sharedAt)
        throw new ConflictException('This case has already been shared or resolved');
      const audience = await tx.user.findMany({
        where: { ...researcherFilter, id: researcherId ?? { not: userId } },
        select: { id: true },
      });
      if (researcherId && (researcherId === userId || audience.length === 0)) {
        throw new NotFoundException('Researcher is unavailable');
      }
      const now = new Date();
      const changed = await tx.farmCase.updateMany({
        where: { id, sharedAt: null, resolvedAt: null },
        data: { sharedAt: now, researcherId, activityAt: now },
      });
      if (!changed.count)
        throw new ConflictException('This case has already been shared or resolved');
      await notify(
        tx,
        'FARM_CASE_SHARED',
        'A crop case is ready for review in FarmLine',
        { kind: 'users', ids: audience.map((x) => x.id) },
        userId,
      );
    });
  }

  async reply(user: Identity['user'], id: string, dto: ReplyFarmCaseDto) {
    if (!hasResearchRole(user)) throw new ForbiddenException();
    return this.db.$transaction(async (tx) => {
      const item = await tx.farmCase.findFirst({ where: { id, ...reviewedBy(user.id) } });
      if (!item) throw new NotFoundException();
      if (dto.kind === FarmReplyKind.TRIAL_OFFER && !item.openToTrials) {
        throw new ForbiddenException('The grower has not opted into trial offers');
      }
      const changed = await tx.farmCase.updateMany({
        where: { id, resolvedAt: null },
        data: { activityAt: new Date() },
      });
      if (!changed.count) throw new ConflictException(closeCase);
      await tx.farmReply.create({ data: { ...dto, caseId: id, authorId: user.id } });
      await notify(
        tx,
        'FARM_CASE_REPLIED',
        'A researcher replied to your crop case in FarmLine',
        { kind: 'users', ids: [item.growerId] },
        user.id,
      );
    });
  }

  async solve(userId: string, id: string, dto: SolveFarmCaseDto) {
    const now = new Date();
    const changed = await this.db.farmCase.updateMany({
      where: { id, growerId: userId, resolvedAt: null },
      data: { ...dto, resolvedAt: now, activityAt: now },
    });
    if (changed.count) return;
    const item = await this.db.farmCase.findFirst({
      where: { id, growerId: userId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException();
    throw new ConflictException(closeCase);
  }

  async addTrial(userId: string, dto: CreateFarmTrialDto) {
    await this.db.farmTrial.create({ data: { ...dto, authorId: userId } });
  }

  async removeTrial(userId: string, id: string) {
    const changed = await this.db.farmTrial.deleteMany({ where: { id, authorId: userId } });
    if (!changed.count) throw new NotFoundException();
  }

  async addResource(userId: string, dto: CreateFarmResourceDto) {
    try {
      await this.db.farmResource.create({ data: { ...dto, authorId: userId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This address is already in the library');
      }
      throw error;
    }
  }
}
