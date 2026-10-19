import mongoose, { Document, Schema } from 'mongoose';

export interface IRepositoryCoverage extends Document {
  repository: string;
  lastScannedAt?: Date;
  branchesSeen: number;
  filesSeen: number;
  skippedBlobs: number;
  skippedLarge: number;
  skippedBinary: number;
  truncatedTrees: number;
  snapshotHeads: Array<{ name: string; sha: string }>;
  cursorBranch: number;
  cursorFile: number;
  snapshotCompleteAt?: Date;
  historyHeads: Array<{ name: string; sha: string }>;
  historyCursorBranch: number;
  historyCursorPage: number;
  historyCursorIndex: number;
  commitsSeen: number;
  missingPatches: number;
  historyCompleteAt?: Date;
  historyError?: string;
  alertsPermission: 'ok' | 'denied' | 'unavailable' | 'error' | 'pending';
  error?: string;
}

const schema = new Schema<IRepositoryCoverage>({
  repository: { type: String, required: true, unique: true },
  lastScannedAt: Date,
  branchesSeen: { type: Number, default: 0 },
  filesSeen: { type: Number, default: 0 },
  skippedBlobs: { type: Number, default: 0 },
  skippedLarge: { type: Number, default: 0 },
  skippedBinary: { type: Number, default: 0 },
  truncatedTrees: { type: Number, default: 0 },
  snapshotHeads: [{ name: String, sha: String }],
  cursorBranch: { type: Number, default: 0 },
  cursorFile: { type: Number, default: 0 },
  snapshotCompleteAt: Date,
  historyHeads: [{ name: String, sha: String }],
  historyCursorBranch: { type: Number, default: 0 },
  historyCursorPage: { type: Number, default: 1 },
  historyCursorIndex: { type: Number, default: 0 },
  commitsSeen: { type: Number, default: 0 },
  missingPatches: { type: Number, default: 0 },
  historyCompleteAt: Date,
  historyError: String,
  alertsPermission: { type: String, default: 'pending' },
  error: String
}, { versionKey: false });

export const RepositoryCoverage = mongoose.model<IRepositoryCoverage>('RepositoryCoverage', schema);
