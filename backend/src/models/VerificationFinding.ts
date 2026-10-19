import mongoose, { Document, Schema } from 'mongoose';

export interface IVerificationFinding extends Document {
  repository: string;
  sourceId: string;
  source: 'github-secret-scanning' | 'branch-snapshot';
  provider: string;
  path: string;
  branch?: string;
  commitSha?: string;
  encoded: boolean;
  state: string;
  validity: 'active' | 'inactive' | 'unknown';
  url: string;
  observedAt: Date;
}

const schema = new Schema<IVerificationFinding>({
  repository: { type: String, required: true, index: true },
  sourceId: { type: String, required: true },
  source: { type: String, required: true, enum: ['github-secret-scanning', 'branch-snapshot'] },
  provider: { type: String, required: true },
  path: { type: String, default: '' },
  branch: String,
  commitSha: String,
  encoded: { type: Boolean, default: false },
  state: { type: String, default: 'open' },
  validity: { type: String, enum: ['active', 'inactive', 'unknown'], default: 'unknown' },
  url: { type: String, default: '' },
  observedAt: { type: Date, default: Date.now }
}, { versionKey: false });

schema.index({ repository: 1, sourceId: 1 }, { unique: true });
schema.index({ observedAt: -1 });

export const VerificationFinding = mongoose.model<IVerificationFinding>('VerificationFinding', schema);
