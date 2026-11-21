import type { IssueReport, Prisma } from '@prisma/client';

export function issueMatches(
  issue: Pick<IssueReport, 'cropType' | 'category' | 'interests'>,
): Prisma.IssueReportWhereInput[] {
  return [
    { cropType: { equals: issue.cropType, mode: 'insensitive' } },
    { category: issue.category },
    { interests: { hasSome: issue.interests } },
  ];
}
