import type { AiAssistance, ContributionType, EvidenceKind } from '@/lib/rules'

export const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  contribution: 'Contribution',
  artifact_version: 'Artifact version',
  commit: 'Commit',
  url: 'Link',
  file: 'File',
}

export const EVIDENCE_HINT: Record<EvidenceKind, string> = {
  contribution: 'Pick one of your own contributions.',
  artifact_version: 'A13@v2, or A13 for the latest version.',
  commit: 'A 7–40 character hex SHA, e.g. 3f9c2ab.',
  url: 'http(s) link: a Docs revision, a draw.io export …',
  file: 'A repository path, e.g. supabase/fixture/03_queries.sql.',
}

export const CONTRIBUTION_LABEL: Record<ContributionType, string> = {
  research: 'Research',
  design: 'Design',
  code: 'Code',
  documentation: 'Documentation',
  review: 'Review',
}

export const AI_OPTION: Record<AiAssistance, { label: string; hint: string }> = {
  none: { label: 'None', hint: 'I did this without AI tools.' },
  assisted: { label: 'Assisted', hint: 'AI helped (suggestions, fixes), the work is mine.' },
  generated: { label: 'Generated', hint: 'AI produced most of it; I reviewed and adapted it.' },
}
