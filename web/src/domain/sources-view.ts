import {
  authorizedUsesSchema,
  sourceMetadataDraftSchema,
  sourceRightsDraftSchema,
  type AuthorizedUses,
  type Source,
  type SourceMetadataDraft,
  type SourceRightsDraft,
} from '../../../server/src/sources/source';

export type SourceForm = {
  sourceType: SourceMetadataDraft['sourceType'];
  title: string;
  originalUrl: string;
  creator: string;
  durationMinutes: string;
  languageVerification: SourceMetadataDraft['languageVerification'];
  languageVerifiedBy: string;
  languageVerificationNotes: string;
};

export type RightsForm = {
  rightsHolder: string;
  license: string;
  permissionEvidence: string;
  attributionRequirements: string;
  authorizedUses: AuthorizedUses;
  decision: SourceRightsDraft['decision'];
  changedBy: string;
  changeReason: string;
};

export const blankSourceForm: SourceForm = {
  sourceType: 'external_url',
  title: '',
  originalUrl: '',
  creator: '',
  durationMinutes: '',
  languageVerification: 'unverified',
  languageVerifiedBy: '',
  languageVerificationNotes: '',
};

/** Nothing is pre-approved: the form starts as "pending" with no use allowed. */
export const blankRightsForm: RightsForm = {
  rightsHolder: '',
  license: '',
  permissionEvidence: '',
  attributionRequirements: '',
  authorizedUses: { internalProcessing: false, volunteerAccess: false, transcription: false, mlResearch: false, publicDistribution: false },
  decision: 'pending',
  changedBy: '',
  changeReason: '',
};

export const sourceTypeLabels: Record<SourceMetadataDraft['sourceType'], string> = {
  external_url: 'A video or audio on a website',
  youtube_reference: 'A YouTube video',
  creator_provided: 'Provided to us by its creator',
  authorized_upload: 'A file we were authorised to upload',
  sautiforge_recording: 'Recorded by the community in SautiForge',
};

export const languageLabels: Record<SourceMetadataDraft['languageVerification'], string> = {
  unverified: 'Not checked yet',
  verified_target: 'A speaker confirmed it is the project language',
  mixed_target: 'Mostly the project language, some other languages',
  wrong_language: 'It is not the project language',
};

export const usageLabels: Record<keyof AuthorizedUses, string> = {
  internalProcessing: 'We may cut it into clips and process it',
  volunteerAccess: 'Volunteers may listen to the clips',
  transcription: 'Volunteers may transcribe the clips',
  mlResearch: 'It may be used to train and test speech models',
  publicDistribution: 'The finished dataset may be shared publicly',
};

export const decisionLabels: Record<SourceRightsDraft['decision'], string> = {
  pending: 'Waiting for permission',
  approved: 'Permission given',
  rejected: 'Permission refused',
  revoked: 'Permission withdrawn',
};

export const statusLabels: Record<Source['status'], string> = {
  candidate: 'Just added',
  language_unverified: 'Language not checked',
  permission_pending: 'Waiting for permission',
  approved: 'Ready to use',
  rejected: 'Not usable',
  revoked: 'Permission withdrawn',
};

const text = (value: string) => value.trim() || null;

export type Built<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

function issues(error: { issues: { path: PropertyKey[]; message: string }[] }): Record<string, string> {
  return Object.fromEntries(error.issues.map((issue) => [String(issue.path[0] ?? 'form'), issue.message]));
}

export function buildSourceDraft(form: SourceForm): Built<SourceMetadataDraft> {
  const minutes = form.durationMinutes.trim() === '' ? null : Number(form.durationMinutes);
  if (minutes !== null && (!Number.isFinite(minutes) || minutes <= 0)) {
    return { ok: false, errors: { durationMs: 'Enter the length in minutes, for example 6.7.' } };
  }
  const parsed = sourceMetadataDraftSchema.safeParse({
    sourceType: form.sourceType,
    title: form.title,
    originalUrl: text(form.originalUrl),
    creator: text(form.creator),
    sourceDate: null,
    durationMs: minutes === null ? null : Math.round(minutes * 60_000),
    externalReference: null,
    languageVerification: form.languageVerification,
    languageVerifiedBy: text(form.languageVerifiedBy),
    languageVerificationNotes: form.languageVerificationNotes,
    speakerIdentification: 'not_assessed',
    speakerNotes: '',
  });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, errors: issues(parsed.error) };
}

export function buildRightsDraft(form: RightsForm): Built<SourceRightsDraft> {
  const uses = authorizedUsesSchema.parse(form.authorizedUses);
  const parsed = sourceRightsDraftSchema.safeParse({
    rightsHolder: text(form.rightsHolder),
    license: text(form.license),
    permissionEvidence: text(form.permissionEvidence),
    attributionRequirements: text(form.attributionRequirements),
    authorizedUses: uses,
    decision: form.decision,
    changedBy: form.changedBy,
    changeReason: form.changeReason,
  });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, errors: issues(parsed.error) };
}

export function publishCommand(sourceId: string, apiUrl: string): string {
  return `python -m sautiseg publish --export <your export folder> --api ${apiUrl} --source-id ${sourceId} --dry-run`;
}
