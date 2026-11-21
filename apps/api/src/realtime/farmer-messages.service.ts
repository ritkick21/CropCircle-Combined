import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { activeAccount } from '../auth/auth-session.service';
import { PrismaService } from '../prisma/prisma.service';
import { issueMatches } from '../stage5/farmer-matching';
import { notify, recordEvent, userRoom } from './outbox';
import { RealtimeAccessService } from './realtime-access.service';

const peerSelect = { id: true, displayName: true } as const;
const messageSelect = { id: true, senderId: true, body: true, createdAt: true } as const;

@Injectable()
export class FarmerMessagesService {
  constructor(
    private readonly db: PrismaService,
    private readonly access: RealtimeAccessService,
  ) {}

  async list(userId: string) {
    const items = await this.db.farmerConversation.findMany({
      where: { OR: [{ participantAId: userId }, { participantBId: userId }] },
      include: { participantA: { select: peerSelect }, participantB: { select: peerSelect } },
      orderBy: { createdAt: 'desc' },
    });
    return items.map((item) => ({
      id: item.id,
      peer: item.participantAId === userId ? item.participantB : item.participantA,
    }));
  }

  async start(userId: string, issueId: string, matchedIssueId: string) {
    return this.db.$transaction(async (tx) => {
      const source = await tx.issueReport.findFirst({ where: { id: issueId, authorId: userId } });
      if (!source) throw new ForbiddenException('Start from one of your own issue reports');
      const prediction = await tx.intelligenceJob.findFirst({
        where: {
          kind: 'SIMILARITY', status: 'COMPLETE', userId, subjectId: source.id,
          finishedAt: { gte: new Date(Date.now() - 86_400_000) },
          output: { path: ['matches'], array_contains: [{ reportId: matchedIssueId }] },
        },
        select: { id: true },
      });
      const peer = await tx.issueReport.findFirst({
        where: {
          id: matchedIssueId,
          authorId: { not: userId },
          author: activeAccount,
          ...(prediction ? {} : { OR: issueMatches(source) }),
        },
        select: { author: { select: peerSelect } },
      });
      if (!peer) throw new ForbiddenException('Matching farmer unavailable');
      const [participantAId, participantBId] = [userId, peer.author.id].sort() as [string, string];
      await tx.farmerConversation.createMany({
        data: [{ participantAId, participantBId }],
        skipDuplicates: true,
      });
      const { id } = await tx.farmerConversation.findUniqueOrThrow({
        where: { participantAId_participantBId: { participantAId, participantBId } },
        select: { id: true },
      });
      return { id, peer: peer.author };
    });
  }

  async messages(userId: string, conversationId: string) {
    await this.access.conversation(userId, conversationId);
    return this.db.farmerMessage.findMany({
      where: { conversationId },
      select: messageSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  }

  async send(userId: string, conversationId: string, clientId: string, input: string) {
    const body = input.trim();
    if (!body) throw new BadRequestException('Message is required');
    return this.db.$transaction(async (tx) => {
      const conversation = await this.access.conversation(userId, conversationId, tx);
      const recipientId =
        conversation.participantAId === userId
          ? conversation.participantBId
          : conversation.participantAId;
      const created = await tx.farmerMessage.createMany({
        data: [{ conversationId, senderId: userId, body, clientId }],
        skipDuplicates: true,
      });
      const message = await tx.farmerMessage.findUniqueOrThrow({
        where: { conversationId_senderId_clientId: { conversationId, senderId: userId, clientId } },
        select: messageSelect,
      });
      if (message.body !== body)
        throw new ConflictException('Message ID already used with different content');
      if (created.count) {
        await recordEvent(
          tx,
          { type: 'FARMER_MESSAGE_CREATED', payload: { conversationId, messageId: message.id } },
          [userRoom(userId), userRoom(recipientId)],
        );
        await notify(
          tx,
          'FARMER_MESSAGE_CREATED',
          'New farmer message',
          { kind: 'users', ids: [recipientId] },
          userId,
        );
      }
      return message;
    });
  }
}
