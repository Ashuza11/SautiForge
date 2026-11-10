import type { ProjectDraft } from '../../../src/features/projects/domain/project';
import { projectDraftSchema } from '../../../src/features/projects/domain/project';
import type { SourceMetadataDraft, SourceRightsDraft } from '../../../server/src/sources/source';
import { sourceMetadataDraftSchema, sourceRightsDraftSchema } from '../../../server/src/sources/source';

export const ADMIN_CODE = 'ADMIN-01';

export type LanguageChoice = 'mashi' | 'other';

export type ProjectAnswers = {
  name: string;
  language: LanguageChoice;
  otherLanguage: string;
  otherCode: string;
};

export type SourceAnswers = {
  title: string;
  link: string;
  permissionConfirmed: boolean;
};

export const PERMISSION_TEXT = 'I have permission to use these recordings so volunteers can listen to them and write them down.';

export type Built<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

function issues(error: { issues: { path: PropertyKey[]; message: string }[] }): Record<string, string> {
  return Object.fromEntries(error.issues.map((issue) => [String(issue.path[0] ?? 'form'), issue.message]));
}

/** Everything the form does not ask is filled with a sensible default and can be edited later. */
export function buildProject(answers: ProjectAnswers): Built<ProjectDraft> {
  const mashi = answers.language === 'mashi';
  const parsed = projectDraftSchema.safeParse({
    title: answers.name,
    description: '',
    targetLanguage: mashi ? 'Shi' : answers.otherLanguage,
    languageCode: mashi ? 'shr' : answers.otherCode,
    languageVariety: mashi ? 'Mashi' : answers.otherLanguage,
    researchDomain: 'Speech recognition and synthesis',
    collectionLocation: 'Not specified',
    protocolVersion: '0.1',
    annotationProfile: 'verbatim_transcription',
    status: 'active',
  });
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors = issues(parsed.error);
  if (errors.title) errors.name = 'Give the project a name.';
  if (errors.targetLanguage) errors.otherLanguage = 'Type the name of the language.';
  if (errors.languageCode) errors.otherCode = 'Use the three-letter language code, for example shr.';
  return { ok: false, errors };
}

export function buildSource(answers: SourceAnswers): Built<SourceMetadataDraft> {
  if (!answers.permissionConfirmed) return { ok: false, errors: { permissionConfirmed: 'Tick the box to confirm you have permission.' } };
  const link = answers.link.trim();
  const parsed = sourceMetadataDraftSchema.safeParse({
    sourceType: link ? 'external_url' : 'creator_provided',
    title: answers.title,
    originalUrl: link || null,
    creator: null,
    sourceDate: null,
    durationMs: null,
    externalReference: null,
    languageVerification: 'verified_target',
    languageVerifiedBy: ADMIN_CODE,
    languageVerificationNotes: 'Confirmed by the administrator during setup.',
    speakerIdentification: 'not_assessed',
    speakerNotes: '',
  });
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors = issues(parsed.error);
  if (errors.title) errors.title = 'Say where this audio comes from, for example the name of the video or the person.';
  if (errors.originalUrl) errors.link = 'The link must start with https://';
  return { ok: false, errors };
}

/** The tick box is the administrator's own statement; it is stored as such, with the date. */
export function buildPermission(today: Date): SourceRightsDraft {
  return sourceRightsDraftSchema.parse({
    rightsHolder: 'As stated by the project administrator',
    license: null,
    permissionEvidence: `Confirmed by the administrator in SautiForge on ${today.toISOString().slice(0, 10)}: "${PERMISSION_TEXT}"`,
    attributionRequirements: null,
    authorizedUses: { internalProcessing: true, volunteerAccess: true, transcription: true, mlResearch: false, publicDistribution: false },
    decision: 'approved',
    changedBy: ADMIN_CODE,
    changeReason: 'Set up by the administrator.',
  });
}
