export const farmReplyKinds = ['ADVICE', 'TRIAL_OFFER', 'SAMPLE_REQUEST'] as const;
export type FarmReplyKind = (typeof farmReplyKinds)[number];
export type FarmResourceKind = 'GUIDE' | 'FIELD_REPORT' | 'RESEARCH';

export interface FarmGuidance {
  heading: string;
  summary: string;
  steps: string[];
  sourceIds: string[];
}

export interface FarmResource {
  id: string;
  crop: string;
  kind: FarmResourceKind;
  title: string;
  publisher: string | null;
  summary: string;
  url: string;
}

export interface FarmPerson {
  id: string;
  displayName: string | null;
}

export interface FarmCase {
  id: string;
  crop: string;
  region: string | null;
  description: string;
  openToTrials: boolean;
  createdAt: string;
  sharedAt: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  publishFix: boolean;
  grower: FarmPerson;
  researcher: FarmPerson | null;
  replies: {
    id: string;
    kind: FarmReplyKind;
    body: string;
    createdAt: string;
    author: FarmPerson;
  }[];
  guidance: FarmGuidance;
}

export interface FarmTrial {
  id: string;
  title: string;
  crop: string;
  description: string;
  author: FarmPerson;
}

export interface FarmFix {
  id: string;
  crop: string;
  resolution: string;
}

export interface FarmlineWorkspace {
  mine: FarmCase[];
  incoming: FarmCase[];
  researchers: (FarmPerson & { trialCrops: string[] })[];
  resources: FarmResource[];
  trials: FarmTrial[];
  fixes: FarmFix[];
  extensionDirectory: string;
}

const cropWords = (value: string) => value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
export function farmCropMatches(left: string, right: string) {
  const a = cropWords(left).join(' ');
  const b = cropWords(right).join(' ');
  return !!a && !!b && (` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `));
}
