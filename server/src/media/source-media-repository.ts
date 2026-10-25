import type { SourceMedia } from './source-media';

export interface SourceMediaRepository {
  listForSource(sourceId: string): Promise<SourceMedia[]>;
  getById(id: string): Promise<SourceMedia | null>;
  createWhenAuthorized(media: SourceMedia): Promise<SourceMedia | null>;
  updateVerification(input: {
    id: string;
    expectedStatus: 'upload_pending';
    status: 'verified' | 'verification_failed';
    verificationError: string | null;
    verifiedAt: string | null;
    updatedAt: string;
  }): Promise<SourceMedia | null>;
}
