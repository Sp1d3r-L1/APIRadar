import mongoose, { Document, Schema } from 'mongoose';

export interface IRepositoryCoverage extends Document {
  repository: string;
  lastScannedAt?: Date;
  branchesSeen: number;
  filesSeen: number;
  skippedBlobs: number;
  truncatedTrees: number;
  cursorBranch: number;
  cursorFile: number;
  snapshotCompleteAt?: Date;
  alertsPermission: 'ok' | 'denied' | 'unavailable' | 'error' | 'pending';
  error?: string;
}

const schema = new Schema<IRepositoryCoverage>({
  repository: { type: String, required: true, unique: true },
  lastScannedAt: Date,
  branchesSeen: { type: Number, default: 0 },
  filesSeen: { type: Number, default: 0 },
  skippedBlobs: { type: Number, default: 0 },
  truncatedTrees: { type: Number, default: 0 },
  cursorBranch: { type: Number, default: 0 },
  cursorFile: { type: Number, default: 0 },
  snapshotCompleteAt: Date,
  alertsPermission: { type: String, default: 'pending' },
  error: String
}, { versionKey: false });

export const RepositoryCoverage = mongoose.model<IRepositoryCoverage>('RepositoryCoverage', schema);
