import mongoose, { Document, Schema } from 'mongoose';

export interface ISecretVerificationJob extends Document {
  secretId: mongoose.Types.ObjectId;
  detectedProvider: string;
  providerFamily: string;
  attributionHints: string[];
  sourceHints: string[];
  sourceStatus: 'pending' | 'inspected' | 'unavailable' | 'skipped';
  sourceInspectedAt?: Date | null;
  sourceCount: number;
  status: 'queued' | 'completed';
  gate: 'scope_required' | 'provider_attribution_required' | 'none';
  result: 'not_checked' | 'active' | 'inactive' | 'inconclusive';
  reviewedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ISecretVerificationJob>({
  secretId: { type: Schema.Types.ObjectId, ref: 'Secret', required: true, unique: true },
  detectedProvider: { type: String, required: true, index: true },
  providerFamily: { type: String, required: true, index: true },
  attributionHints: [{ type: String }],
  sourceHints: { type: [String], default: [] },
  sourceStatus: { type: String, enum: ['pending', 'inspected', 'unavailable', 'skipped'], default: 'pending' },
  sourceInspectedAt: { type: Date, default: null },
  sourceCount: { type: Number, default: 0 },
  status: { type: String, enum: ['queued', 'completed'], default: 'queued', index: true },
  gate: { type: String, enum: ['scope_required', 'provider_attribution_required', 'none'], required: true, index: true },
  result: { type: String, enum: ['not_checked', 'active', 'inactive', 'inconclusive'], default: 'not_checked' },
  reviewedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

schema.index({ status: 1, gate: 1, createdAt: 1 });

export const SecretVerificationJob = mongoose.model<ISecretVerificationJob>('SecretVerificationJob', schema);
